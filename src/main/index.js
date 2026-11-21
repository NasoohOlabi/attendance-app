import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, safeStorage, session } from "electron";
import electronUpdater from "electron-updater";
import { createBoutyClient } from "../bouty.mjs";
import { createBoutyCredentials, createBoutyQueue, createBoutyRosterCache, parseBoutyMapping } from "../bouty-storage.mjs";
import { createBoutySync } from "../bouty-sync.mjs";
import { applyBoutyProfile, boutySourceLinks, boutyStudentChoices, migrateBoutyPrintLinks, normalizeBoutySourceId } from "../bouty-resolve.mjs";
import { legacyUserDataPath, loadConfig, scannerExeInResources, updateChannelPreferencePath } from "../config.mjs";
import { appLogFile, startAppLog } from "../log.mjs";
import { updaterChannel, updaterErrorDetails, updaterInfoDetails, updaterShouldOffer } from "../update.mjs";
import { appendScanTrace, beginScanAttempt, mergeCapturedFiles, planScanRetry, runIdentify, SCAN_OUTAGE_MESSAGE, SCAN_RETRY_PAUSE_MS } from "../scan.mjs";
import { createHash } from "node:crypto";
import {
  attendanceStamp, boutyProfileId, canonicalPrintStudentId, captureScreen, clearFingerprints, clockFromStamp,
  dropPrintEnrollment, fuzzyStudents, loadIndex, outboxDay, pendingPath, personOnList,
  planBatchFiles, planStudentPrintDelete, putStudent, saveIndex, studentsWithPrints,
  enrollmentTemplateFile, studentKey, studentTemplateNames, templatePath, writeLog,
} from "../store.mjs";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
startAppLog();

const UPDATE_CHECK_ERROR = "Update check failed.";
const UPDATE_DOWNLOAD_ERROR = "Update download failed.";

protocol.registerSchemesAsPrivileged([
  { scheme: "print", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let allowedImage = "";
let batchImages = [];
let batchTokens = [];

let win = null;
let currentConfig = null;
let cached = {};
let pending = null;
let batch = [];
let collecting = false;
let pause = false;
let savedScreen = null;
let generation = 0;
let identifyPromise = null;
let loopDone = Promise.resolve();
let appRunning = true;
let quitRequested = false;
let printsEpoch = 0;
let lock = Promise.resolve();
let scannerReady = true;
let scanFailStreak = 0;
let updateProgressLog = -1;
let updateDownloadAttempts = 0;
let updateRetryTimer = null;

const updateState = {
  enabled: app.isPackaged,
  status: app.isPackaged ? "idle" : "unavailable",
  version: "",
  progress: 0,
  error: "",
};
let boutyCredentials = null;
let boutySync = null;
let boutyEnabled = false;
let boutySettings = { mapping: [], days: {}, presentStatusId: 1, absentStatusId: 2 };
let boutyMessage = "";
let boutyContext = null;
let boutySession = null;
let boutyQueue = null;
let boutyOwner = null;
let boutySigningOut = false;
let present = [];
let boutyLookupTail = Promise.resolve();
let boutyAccountVersion = 0;
const boutyNames = new Map();
let rosterCache;
let roster = null;
let rosterRefresh = null;

function accountKey(username) {
  return createHash("sha256").update(username.trim().toLowerCase()).digest("hex");
}

function serialBouty(fn) {
  const run = boutyLookupTail.then(fn);
  boutyLookupTail = run.catch(() => {});
  return run;
}

function withBoutyLookup(fn) {
  const version = boutyAccountVersion;
  return serialBouty(async () => {
    if (version !== boutyAccountVersion || boutySigningOut) throw new Error("Bouty account changed.");
    const account = await boutyCredentials?.read();
    if (!account || !boutySession) throw new Error("Bouty: sign in to look up students.");
    await boutySession.client.login(account.username, account.password);
    const result = await boutySession.run(fn);
    if (boutySigningOut) throw new Error("Bouty account changed.");
    return result;
  });
}

function refreshRoster() {
  const owner = boutyOwner;
  const version = boutyAccountVersion;
  if (!owner || boutySigningOut) return Promise.reject(new Error("Bouty: sign in to look up students."));
  if (rosterRefresh?.version === version) return rosterRefresh.promise;
  const promise = (async () => {
    const students = new Map();
    for (let page = 1; ; page += 1) {
      if (version !== boutyAccountVersion || boutySigningOut) throw new Error("Bouty account changed.");
      const result = await withBoutyLookup((api) => api.rosterProfiles(page));
      for (const profile of result.students) {
        if (students.has(profile.id)) throw new Error("Bouty roster changed during refresh.");
        students.set(profile.id, profile);
      }
      if (!result.hasNext) break;
      if (!result.students.length) throw new Error("Bouty roster changed during refresh.");
    }
    return serialBouty(async () => {
      if (version !== boutyAccountVersion || boutySigningOut) throw new Error("Bouty account changed.");
      const snapshot = [...students.values()];
      await rosterCache.save(owner, snapshot);
      await exclusive(async () => {
        if (version !== boutyAccountVersion || boutySigningOut) throw new Error("Bouty account changed.");
        if (currentConfig) await ensureRoster(currentConfig, snapshot);
      });
      roster = snapshot;
      cached = {};
      await publishAttendance();
      return snapshot;
    });
  })().finally(() => {
    if (rosterRefresh?.promise === promise) rosterRefresh = null;
  });
  rosterRefresh = { version, promise };
  return promise;
}

function loadBoutyProfile(student, at) {
  const id = canonicalPrintStudentId(student.studentId);
  if (!id) return;
  const key = normalizeBoutySourceId(id);
  const link = boutySourceLinks(roster).get(key);
  const profileId = boutyProfileId(link || id);
  const saved = roster?.find((profile) => profile.id === profileId);
  const show = (profile) => {
      boutyNames.set(id, profile.studentName);
      const match = applyBoutyProfile(state.lastMatch, at, id, profile, "bouty");
      if (match) publish({ lastMatch: match, present: shownPresent() });
  };
  if (saved) show(saved);
  if (!net.isOnline() && saved) return;
  void withBoutyLookup((api) => api.student({ studentId: link || id, studentName: student.studentName || "", studentNumber: saved?.studentNumber }))
    .then(show).catch(() => {
      if (saved) return;
      if (!boutyEnabled || state.lastMatch?.at !== at || canonicalPrintStudentId(state.lastMatch?.studentId) !== id) return;
      publish({ lastMatch: { ...state.lastMatch, profileStatus: "Bouty student information is unavailable." } });
    });
}

function boutyPublic() {
  return { enabled: boutyEnabled, message: boutyMessage, ...boutySettings };
}

function publishBouty(message = boutyMessage) {
  boutyMessage = message;
  publish({ bouty: boutyPublic() });
}

async function setupBouty() {
  const dir = path.join(homedir(), "Masjid", "v1", "config");
  const file = path.join(dir, "bouty-settings.json");
  boutyCredentials = createBoutyCredentials({ file: path.join(dir, "bouty-account.enc"), encryption: safeStorage });
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    parseBoutyMapping(saved.mapping);
    boutySettings = saved;
  } catch (err) {
    if (err.code !== "ENOENT") publishBouty("Bouty settings could not be read.");
  }
  rosterCache = createBoutyRosterCache(path.join(dir, "bouty-roster.enc"), safeStorage);
  boutyQueue = createBoutyQueue(path.join(dir, "bouty-outbox.json"));
  try {
    const account = await boutyCredentials.read();
    if (account) {
      boutyOwner = accountKey(account.username);
      await boutyQueue.claimLegacy(boutyOwner);
      roster = await rosterCache.read(boutyOwner);
      boutyEnabled = true;
    }
  } catch {
    try { await access(path.join(dir, "bouty-account.enc")); boutyEnabled = true; } catch { boutyEnabled = false; }
    publishBouty("Bouty account could not be opened.");
  }
  const browserSession = session.fromPartition("bouty-students");
  const api = createBoutyClient((url, options) => browserSession.fetch(url, options));
  let active = false;
  const clearCookies = () => browserSession.clearStorageData({ storages: ["cookies"] });
  boutySession = {
    async signIn(username, password) {
      active = false;
      await clearCookies();
      await api.login(username, password);
      active = true;
    },
    async signOut() {
      try { if (active) await api.logout(); }
      catch { /* Local sign-out still works offline. */ }
      finally { active = false; await clearCookies(); }
    },
    async run(fn) {
      try { return await fn(boutySession.client); }
      catch (error) {
        if (error?.code !== "BOUTY_SESSION_EXPIRED") throw error;
        active = false;
        const account = await boutyCredentials.read();
        if (!account || boutySigningOut) throw error;
        await boutySession.signIn(account.username, account.password);
        return fn(boutySession.client);
      }
    },
    client: {
      ...api,
      async login(username, password) {
        if (!active) await boutySession.signIn(username, password);
      },
    },
  };
  boutySync = createBoutySync({
    queue: boutyQueue,
    credentials: boutyCredentials,
    withSession: (run) => serialBouty(async () => {
      if (!boutySigningOut && boutyEnabled) await boutySession.run(run);
    }),
    accountKey: () => boutyOwner,
    sourceLinks: () => boutySourceLinks(roster),
    settings: async () => boutySettings,
    studentName: async (id) => {
      const index = await loadIndex(currentConfig?.fingerprintDir || path.join(homedir(), "Masjid", "v1", "fingerprints"));
      return Object.values(index.students).find((student) => canonicalPrintStudentId(student.studentId) === id)?.studentName || "";
    },
    onStatus: publishBouty,
  });
  return { file };
}

let state = {
  appVersion: app.getVersion(),
  phase: "ready",
  headline: "Place a finger",
  detail: "Listening",
  trace: [],
  lastMatch: null,
  scanImage: "",
  scanImages: [],
  error: "",
  fingerprintDir: "",
  config: null,
  canCloseSettings: false,
  enroll: null,
  present: null,
  dashboard: [],
  update: updateState,
};

function publishUpdate(patch) {
  Object.assign(updateState, patch);
  publish({ update: { ...updateState } });
}

function configureAutoUpdater() {
  const configuredChannel = currentConfig?.updateChannel;
  const logicalChannel = updaterChannel({ configuredChannel, currentVersion: app.getVersion() });
  // Leave the feed on latest.yml. Assigning channel makes electron-updater
  // allow a downgrade and request stable.yml, which these releases do not publish.
  autoUpdater.allowPrerelease = logicalChannel === "nightly";
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
  console.info("updater configured", {
    currentVersion: app.getVersion(),
    configuredChannel,
    channel: logicalChannel,
    feedFile: "latest.yml",
    allowPrerelease: autoUpdater.allowPrerelease,
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  configureAutoUpdater();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    console.info("updater checking", { allowPrerelease: autoUpdater.allowPrerelease, feedFile: "latest.yml" });
    publishUpdate({ status: "checking", error: "" });
  });
  autoUpdater.on("update-available", (info) => {
    const channel = updaterChannel({ configuredChannel: currentConfig?.updateChannel, currentVersion: app.getVersion() });
    if (!updaterShouldOffer({ currentVersion: app.getVersion(), nextVersion: info.version, channel })) {
      console.info("updater ignored older feed", updaterInfoDetails(info));
      publishUpdate({ status: "up-to-date", version: "", progress: 0, error: "" });
      return;
    }
    updateProgressLog = -1;
    console.info("updater update available", updaterInfoDetails(info));
    publishUpdate({ status: "available", version: info.version, progress: 0, error: "" });
  });
  autoUpdater.on("update-not-available", (info) => {
    console.info("updater up to date", updaterInfoDetails(info));
    publishUpdate({ status: "up-to-date", progress: 0, error: "" });
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    if (percent === 0 || percent >= 100 || percent >= updateProgressLog + 25) {
      updateProgressLog = percent;
      console.info("updater download progress", { percent });
    }
    publishUpdate({ status: "downloading", progress: percent, error: "" });
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.info("updater update downloaded", updaterInfoDetails(info));
    publishUpdate({ status: "downloaded", version: info.version, progress: 100, error: "" });
  });
  autoUpdater.on("error", (error) => {
    console.error("updater event failed", updaterErrorDetails(error));
    publishUpdate({ status: "error", error: UPDATE_CHECK_ERROR });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) return { ok: false, error: "Updates are available in installed builds." };
  try {
    console.info("updater check requested", { currentVersion: app.getVersion(), channel: autoUpdater.channel });
    publishUpdate({ status: "checking", error: "" });
    await autoUpdater.checkForUpdates();
    console.info("updater check completed", { status: updateState.status, version: updateState.version || "" });
    return { ok: true };
  } catch (error) {
    console.error("updater check failed", updaterErrorDetails(error));
    publishUpdate({ status: "error", error: UPDATE_CHECK_ERROR });
    return { ok: false, error: UPDATE_CHECK_ERROR };
  }
}

async function downloadUpdateWithRetry() {
  try {
    updateProgressLog = -1;
    publishUpdate({ status: "downloading", progress: 0, error: "" });
    console.info("updater download requested", { version: updateState.version || "", feedFile: "latest.yml", attempt: updateDownloadAttempts + 1 });
    await autoUpdater.downloadUpdate();
    console.info("updater download completed", { status: updateState.status, version: updateState.version || "" });
    return { ok: true };
  } catch (error) {
    updateDownloadAttempts += 1;
    console.error("updater download failed", { ...updaterErrorDetails(error), attempt: updateDownloadAttempts });
    if (updateDownloadAttempts < 5) {
      publishUpdate({ status: "downloading", error: "Download interrupted. Retrying…" });
      clearTimeout(updateRetryTimer);
      updateRetryTimer = setTimeout(() => {
        updateRetryTimer = null;
        void downloadUpdateWithRetry();
      }, 10000);
      return { ok: true, retrying: true };
    }
    publishUpdate({ status: "error", error: UPDATE_DOWNLOAD_ERROR });
    return { ok: false, error: UPDATE_DOWNLOAD_ERROR };
  }
}

async function updateAction() {
  if (!app.isPackaged) return { ok: false, error: "Updates are available in installed builds." };
  if (updateState.status === "downloaded") {
    quitRequested = true;
    autoUpdater.quitAndInstall();
    return { ok: true };
  }
  if (updateState.status === "available") {
    updateDownloadAttempts = 0;
    return downloadUpdateWithRetry();
  }
  return checkForUpdates();
}

function configOptions() {
  if (!app.isPackaged) return {};
  const bundled = scannerExeInResources(process.resourcesPath);
  return { cwd: app.getPath("userData"), scannerDefault: bundled, scannerFallback: bundled };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exclusive(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => {},
    () => {},
  );
  return run;
}

function publish(patch, gen) {
  if (gen !== undefined && gen !== generation) return;
  state = { ...state, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send("state", state);
}

function publicConfig(config) {
  return { zk4500Cli: config.zk4500Cli, fingerprintDir: config.fingerprintDir, updateChannel: config.updateChannel };
}

async function writeConfigFile(config, patch) {
  let file = {};
  try {
    file = JSON.parse((await readFile(config.configPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const next = { ...file, ...patch };
  delete next.private_key;
  delete next.driveFolderId;
  delete next.driveSync;
  await mkdir(path.dirname(config.configPath), { recursive: true });
  const temp = `${config.configPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, config.configPath);
}

async function applyUpdateChannelPreference(config) {
  try {
    const saved = JSON.parse(await readFile(updateChannelPreferencePath(app.getPath("appData")), "utf8"));
    if (saved.channel === "nightly" || saved.channel === "stable") config.updateChannel = saved.channel;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("update channel preference failed", error.message);
  }
  return config;
}

async function saveUpdateChannelPreference(channel) {
  const file = updateChannelPreferencePath(app.getPath("appData"));
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ channel })}\n`, "utf8");
  await rename(temp, file);
}

function lastMatchOf(student, at) {
  return { studentName: "", studentId: student?.studentId || "", at, fields: [],
    profileStatus: "Loading Bouty student information…" };
}

function shownPresent() {
  return present.map((person) => ({ ...person, name: boutyNames.get(person.studentId) || person.name }));
}

async function publishAttendance() {
  const owner = boutyOwner;
  const records = owner ? await boutyQueue.attendance() : [];
  if (owner !== boutyOwner) return;
  const days = new Map();
  const links = boutySourceLinks(roster);
  for (const record of records) {
    if (record.owner !== owner) continue;
    const day = outboxDay(record.at);
    if (!days.has(day)) days.set(day, new Map());
    const students = days.get(day);
    const studentId = links.get(normalizeBoutySourceId(record.studentId)) || record.studentId;
    if (record.kind === "absent") students.delete(studentId);
    else students.set(studentId, {
      studentId,
      name: record.studentName || record.studentId,
      time: clockFromStamp(attendanceStamp(new Date(record.at))),
    });
  }
  present = [...(days.get(outboxDay(new Date()))?.values() || [])];
  const dashboard = [...days].slice(-14).map(([label, students]) => ({ label, count: students.size }));
  publish({ present: shownPresent(), dashboard });
}

async function acceptPresent(student, at = new Date().toISOString()) {
  const originalId = canonicalPrintStudentId(student?.studentId);
  const id = boutySourceLinks(roster).get(normalizeBoutySourceId(originalId)) || originalId;
  if (!id) return { op: "missing-id" };
  const owner = boutyOwner;
  if (!owner || boutySigningOut) throw new Error("Bouty: sign in to record attendance.");
  await publishAttendance();
  if (owner !== boutyOwner || boutySigningOut) throw new Error("Bouty: sign in to record attendance.");
  if (present.some((person) => person.studentId === id)) return { op: "already-present" };
  await boutySync.enqueue(id, "present", at, boutyNames.get(id) || student.studentName);
  await publishAttendance();
  void boutySync.sync();
  return { op: "update" };
}

async function acceptAbsent(input) {
  if (!boutyEnabled || !boutyOwner || boutySigningOut) return { ok: false, error: "Bouty: sign in to record attendance." };
  const person = personOnList(shownPresent(), input);
  if (!person) return { ok: false, error: "That student is not on today's list." };
  await boutySync.enqueue(person.studentId, "absent", new Date().toISOString(), person.name);
  await publishAttendance();
  void boutySync.sync();
  return { ok: true };
}

function markDetail(plan) {
  if (plan.op === "update") return "Attendance queued for Bouty.";
  if (plan.op === "already-present") return "Already here today.";
  if (plan.op === "missing-id") return "This student has no Marif id.";
  return plan.error || "";
}

function showPending(gen, reason = "") {
  cached = {};
  publish({ phase: "pending", headline: "New fingerprint", detail: reason || "Search Bouty for the student.", error: "", canCloseSettings: true, enroll: null }, gen);
}

async function restorePending(config, gen) {
  const index = await loadIndex(config.fingerprintDir);
  try {
    await access(pendingPath(config.fingerprintDir));
  } catch {
    pending = null;
    if (index.pending) {
      index.pending = null;
      await saveIndex(config.fingerprintDir, index);
    }
    return;
  }
  pending = { capturedAt: index.pending?.capturedAt || new Date().toISOString() };
  publish({ phase: "pending", headline: "New fingerprint", detail: "Choose who this print belongs to.", canCloseSettings: true, enroll: null }, gen);
}

function scanImageUrl() {
  return allowedImage ? `print://scan/finger.jpg?t=${Date.now()}` : "";
}

function batchImageUrls() {
  return batchImages.map((_, index) => `print://scan/${index}.jpg?t=${batchTokens[index]}`);
}

/** One kept print stays the single picture. Two or more become the gallery. */
function publishedImages(fallback = "") {
  const urls = batchImageUrls();
  if (urls.length > 1) return { scanImage: urls.at(-1), scanImages: urls };
  if (urls.length === 1) return { scanImage: urls[0], scanImages: [] };
  return { scanImage: fallback, scanImages: [] };
}

function clearBatchImages() {
  batchImages = [];
  batchTokens = [];
}

/** Serves a stored scan only. The URL picks a slot; it never names a filesystem path. */
function printFile(raw) {
  let name = "";
  try {
    name = path.basename(new URL(raw).pathname);
  } catch {
    return "";
  }
  if (name === "finger.jpg") return allowedImage;
  const slot = /^(\d+)\.jpg$/.exec(name);
  if (!slot) return "";
  return batchImages[Number(slot[1])] || "";
}

async function keepScanImage(source) {
  if (!source) {
    allowedImage = "";
    return "";
  }
  const dest = path.join(app.getPath("userData"), "last-scan.jpg");
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(source, dest);
  allowedImage = dest;
  return scanImageUrl();
}

async function rememberBatchImage(source) {
  if (!source) return;
  const dir = path.join(app.getPath("userData"), "batch-scans");
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${batchImages.length}.jpg`);
  await copyFile(source, dest);
  batchImages.push(dest);
  batchTokens.push(Date.now());
}

function pushTrace(event, gen) {
  const trace = appendScanTrace(state.trace || [], event);
  const text = trace.at(-1) || "";
  if (text && text !== (state.trace || []).at(-1)) console.log(text);
  publish({ trace }, gen);
}

function noteScannerLine(line, gen) {
  if (line === "finger=detected") pushTrace({ type: "finger" }, gen);
  else if (line === "capture_success=True") pushTrace({ type: "captured" }, gen);
  else if (line.startsWith("image=")) pushTrace({ type: "image" }, gen);
  else if (line === "init=0") pushTrace({ type: "ready" }, gen);
  else if (line.startsWith("init=")) pushTrace({ type: "init", code: line.slice(5) }, gen);
  else if (line.startsWith("sensor_count=") && line !== "sensor_count=1") {
    pushTrace({ type: "init", code: `sensors ${line.slice(13)}` }, gen);
  }
}

function applyScanPlan(plan, gen) {
  scanFailStreak = plan.streak;
  if (plan.showError) {
    publish({ error: plan.message, headline: "Place a finger", detail: "Listening" }, gen);
    return;
  }
  if (state.error === SCAN_OUTAGE_MESSAGE) publish({ error: "" }, gen);
}

async function handleCapture(config, result, body, gen, scanImage) {
  if (!result.ok || result.timedOut || !body?.length) {
    if (!collecting) {
      allowedImage = "";
      publish({ scanImage: "", scanImages: [] }, gen);
    }
    const plan = planScanRetry({
      ok: result.ok && body?.length,
      timedOut: result.timedOut,
      exitCode: result.ok ? 1 : result.exitCode,
      streak: scanFailStreak,
    });
    applyScanPlan(plan, gen);
    if (plan.retryNow) console.log(`scanner retry ${plan.streak}`);
    return;
  }
  scanFailStreak = 0;
  if (collecting && body?.length) {
    batch.push(body);
    if (scanImage && allowedImage) {
      try {
        await rememberBatchImage(allowedImage);
      } catch (err) {
        console.error(err.message);
      }
    }
    const count = batch.length;
    const onPicker = Boolean(pending);
    publish(
      {
        phase: onPicker ? "pending" : "ready",
        headline: onPicker ? "New fingerprint" : "Place a finger",
        detail: onPicker ? chooseDetail(count) : keptDetail(count),
        enroll: enrollView(),
        ...publishedImages(scanImage),
        error: "",
      },
      gen,
    );
    return;
  }
  const index = await loadIndex(config.fingerprintDir);
  const decision = captureScreen(index.students, result);
  const who = decision.student?.studentId || "";
  pushTrace(
    {
      type: "result",
      matched: Boolean(decision.attendance),
      name: who,
      score: decision.score ?? result.matchScore ?? 0,
      threshold: decision.threshold ?? result.matchThreshold ?? "",
    },
    gen,
  );
  console.log(
    `score ${decision.score ?? result.matchScore ?? ""} threshold ${decision.threshold ?? result.matchThreshold ?? ""} attendance=${decision.attendance} picker=${decision.picker}`,
  );
  if (decision.attendance) {
    const student = decision.student;
    const who = student.studentId;
    console.log(`matched ${who || student.templateFile}`);
    const plan = await acceptPresent(student).catch((error) => ({ error: error.message }));
    const extra = markDetail(plan);
    const detail = [`Matched ${who}`, extra].filter(Boolean).join(" ");
    const matchedAt = new Date().toISOString();
    publish(
      {
        phase: pause ? state.phase : "ready",
        headline: pause ? state.headline : "Place a finger",
        detail: pause ? state.detail : detail,
        lastMatch: lastMatchOf(student, matchedAt),
        scanImage,
        scanImages: [],
        error: plan.error || (plan.op === "missing-id" ? extra : ""),
        present: shownPresent(),
      },
      gen,
    );
    if (boutyEnabled) loadBoutyProfile(student, matchedAt);
    return;
  }
  if (!decision.picker) {
    allowedImage = "";
    publish({ scanImage: "", scanImages: [] }, gen);
    return;
  }
  await writeFile(pendingPath(config.fingerprintDir), body);
  index.pending = { capturedAt: new Date().toISOString() };
  await saveIndex(config.fingerprintDir, index);
  pending = { capturedAt: index.pending.capturedAt };
  pause = false;
  console.log("new fingerprint, waiting for a student");
  publish(
    { phase: "pending", headline: "New fingerprint", detail: decision.reason || "Loading students…", scanImage, scanImages: [], error: "", enroll: null },
    gen,
  );
  showPending(gen, decision.reason);
}

async function oneScan(config, gen) {
  const epoch = printsEpoch;
  const started = beginScanAttempt({ streak: scanFailStreak });
  scanFailStreak = started.streak;
  if (state.error === SCAN_OUTAGE_MESSAGE) publish({ error: "" }, gen);
  const outDir = await mkdtemp(path.join(tmpdir(), "attendance-scan-"));
  const startedAt = Date.now();
  let result = { ok: false, error: "Scanner did not run.", timedOut: false };
  let body = null;
  let scanImage = "";
  pushTrace({ type: "started", command: "identify", timeoutSeconds: config.scanTimeoutSeconds }, gen);
  let fingerDown = false;
  const waiting = setInterval(() => {
    if (gen !== generation || fingerDown) return;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    pushTrace({ type: "waiting", elapsedSeconds, fingerDown }, gen);
  }, 1000);
  try {
    identifyPromise = runIdentify({
      exe: config.zk4500Cli,
      timeoutSeconds: config.scanTimeoutSeconds,
      outDir,
      prefix: "scan",
      matchDir: path.join(config.fingerprintDir, "templates"),
      onLine: (line) => {
        if (line === "finger=detected") fingerDown = true;
        noteScannerLine(line, gen);
      },
    });
    result = await identifyPromise;
    let names = [];
    try {
      names = await readdir(outDir);
    } catch {
      names = [];
    }
    result = mergeCapturedFiles(result, names.map((name) => path.join(outDir, name)));
    if (result.ok && result.templatePath) body = await readFile(result.templatePath);
    if (result.ok && result.imagePath) {
      try {
        scanImage = await keepScanImage(result.imagePath);
      } catch (err) {
        console.error(err.message);
      }
    }
  } catch (err) {
    result = { ok: false, timedOut: false, exitCode: 1, error: err.message };
  } finally {
    clearInterval(waiting);
    identifyPromise = null;
    await rm(outDir, { recursive: true, force: true });
  }
  if (gen !== generation || !appRunning) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  if (result.killed) pushTrace({ type: "killed", elapsedSeconds }, gen);
  else if (!result.ok) pushTrace({ type: "exited", exitCode: result.exitCode, timedOut: Boolean(result.timedOut), elapsedSeconds }, gen);
  await exclusive(async () => {
    if (gen !== generation || epoch !== printsEpoch) return;
    if (pending && !collecting) return;
    await handleCapture(config, result, body, gen, scanImage);
  });
  pushTrace({ type: "next" }, gen);
  if (gen === generation && appRunning) await sleep(SCAN_RETRY_PAUSE_MS);
}

async function runLoop(config, gen) {
  await exclusive(async () => {
    if (gen === generation) await restorePending(config, gen);
  });
  while (appRunning && gen === generation) {
    try {
      if (pause || pending || !scannerReady) await sleep(300);
      else await oneScan(config, gen);
    } catch (err) {
      publish({ error: err.message }, gen);
      await sleep(2000);
    }
  }
}

async function ensureRoster(config, profiles = roster) {
  try {
    const index = await loadIndex(config.fingerprintDir);
    if (migrateBoutyPrintLinks(index, profiles)) await saveIndex(config.fingerprintDir, index);
    else await writeLog(config.fingerprintDir, index);
  } catch (err) {
    console.error(err);
  }
}

async function startLoop() {
  const previous = loopDone;
  const inflight = identifyPromise;
  const gen = ++generation;
  const dropGallery = batchImages.length > 0;
  batch = [];
  collecting = false;
  clearBatchImages();
  if (inflight) await inflight.catch(() => {});
  await previous.catch(() => {});
  if (gen !== generation) return;

  let config;
  try {
    config = await applyUpdateChannelPreference(loadConfig(configOptions()));
  } catch (err) {
    publish({
      phase: "ready",
      headline: "Place a finger",
      detail: err.message,
      error: err.message,
      canCloseSettings: true,
      enroll: null,
      scanImages: [],
      ...(dropGallery ? { scanImage: "" } : {}),
    });
    return;
  }
  currentConfig = config;
  await exclusive(() => ensureRoster(config));
  publish({
    phase: "ready",
    headline: "Place a finger",
    detail: "Listening",
    fingerprintDir: config.fingerprintDir,
    config: publicConfig(config),
    present: shownPresent(),
    canCloseSettings: true,
    error: "",
    enroll: null,
    scanImages: [],
    ...(dropGallery ? { scanImage: "" } : {}),
  });
  console.log("scanner screen");
  scannerReady = true;
  try {
    await access(config.zk4500Cli);
  } catch {
    scannerReady = false;
    publish({ detail: `Scanner CLI not found at ${config.zk4500Cli}` });
  }
  loopDone = runLoop(config, gen).catch((err) => {
    publish({ error: err.message }, gen);
  });
}

function keptDetail(count) {
  return `${count} scan${count === 1 ? "" : "s"} kept. Place another finger.`;
}

function chooseDetail(count) {
  if (count === 1) return "Choose who this scan belongs to.";
  return `Choose who these ${count} scans belong to.`;
}

function enrollView() {
  if (!collecting || batch.length < 1) return null;
  return { count: batch.length };
}

async function listTemplateNames(config) {
  try {
    return await readdir(path.join(config.fingerprintDir, "templates"));
  } catch {
    return [];
  }
}

/** Write each body to the next free template name. Older prints for this student stay. */
async function writeBatch(config, student, bodies) {
  const primary = enrollmentTemplateFile(student);
  const files = planBatchFiles(primary, await listTemplateNames(config), bodies.length);
  for (let i = 0; i < files.length; i += 1) {
    await writeFile(templatePath(config.fingerprintDir, files[i]), bodies[i]);
  }
  const draft = {
    studentId: student.studentId || "",
    studentName: student.studentName || "",
    rowNumber: student.rowNumber,
    templateFile: primary,
    capturedAt: new Date().toISOString(),
  };
  const index = await loadIndex(config.fingerprintDir);
  putStudent(index, draft);
  index.pending = null;
  await saveIndex(config.fingerprintDir, index);
  await writeLog(config.fingerprintDir, index);
  return { draft };
}

async function addMoreScans() {
  if (!currentConfig) throw new Error("The app is still starting.");
  const config = currentConfig;
  if (!collecting) {
    let body;
    try {
      body = await readFile(pendingPath(config.fingerprintDir));
    } catch {
      throw new Error("No fingerprint is waiting.");
    }
    if (!body.length) throw new Error("The saved print is empty.");
    // ponytail: batch stays in memory for this session; a restart drops unassigned scans
    batch = [body];
    collecting = true;
    clearBatchImages();
    if (allowedImage) {
      try {
        await rememberBatchImage(allowedImage);
      } catch (err) {
        console.error(err.message);
      }
    }
  }
  if (!batch.length) throw new Error("No fingerprint is waiting.");
  const index = await loadIndex(config.fingerprintDir);
  index.pending = null;
  await saveIndex(config.fingerprintDir, index);
  await rm(pendingPath(config.fingerprintDir), { force: true });
  pending = null;
  publish({
    phase: "ready",
    headline: "Place a finger",
    detail: keptDetail(batch.length),
    error: "",
    enroll: enrollView(),
    ...publishedImages(state.scanImage),
  });
}

async function rescanCapture() {
  if (!currentConfig) throw new Error("The app is still starting.");
  const config = currentConfig;
  pending = null;
  const index = await loadIndex(config.fingerprintDir);
  index.pending = null;
  await saveIndex(config.fingerprintDir, index);
  await rm(pendingPath(config.fingerprintDir), { force: true });
  allowedImage = "";
  if (collecting) {
    batch.pop();
    batchImages.pop();
    batchTokens.pop();
  }
  if (!batch.length) collecting = false;
  publish({
    phase: "ready",
    headline: "Place a finger",
    detail: collecting ? keptDetail(batch.length) : "Listening",
    ...publishedImages(""),
    error: "",
    enroll: enrollView(),
  });
}

async function discardScans() {
  if (!currentConfig) throw new Error("The app is still starting.");
  const config = currentConfig;
  pending = null;
  batch = [];
  collecting = false;
  allowedImage = "";
  clearBatchImages();
  const index = await loadIndex(config.fingerprintDir);
  index.pending = null;
  await saveIndex(config.fingerprintDir, index);
  await rm(pendingPath(config.fingerprintDir), { force: true });
  publish({
    phase: "ready",
    headline: "Place a finger",
    detail: "Listening",
    error: "",
    enroll: null,
    scanImage: "",
    scanImages: [],
    canCloseSettings: true,
  });
}

async function finishEnroll() {
  if (!collecting || batch.length < 1) {
    collecting = false;
    batch = [];
    clearBatchImages();
    pending = null;
    publish({
      phase: "ready",
      headline: "Place a finger",
      detail: "Listening",
      enroll: null,
      error: "",
      scanImage: "",
      scanImages: [],
    });
    return;
  }
  pending = { batch: true };
  publish({
    phase: "pending",
    headline: "New fingerprint",
    detail: chooseDetail(batch.length),
    error: "",
    enroll: enrollView(),
    canCloseSettings: true,
  });
}

async function assignStudent(key) {
  if (!currentConfig) throw new Error("The app is still starting.");
  const student = cached[key];
  if (!student) throw new Error("Choose a student from the list.");
  const config = currentConfig;
  const batchSave = collecting && batch.length > 0;
  if (!batchSave && !pending) throw new Error("No fingerprint is waiting.");
  let savedBodies = [];
  if (batchSave) {
    savedBodies = batch.slice();
  } else {
    const uploadBody = await readFile(pendingPath(config.fingerprintDir));
    if (!uploadBody.length) throw new Error("The saved print is empty.");
    savedBodies = [uploadBody];
  }
  const savedCount = savedBodies.length;

  publish({
    phase: "linking",
    detail: savedCount > 1 ? "Saving these scans…" : "Saving this print…",
    error: "",
    enroll: null,
  });
  const saved = await writeBatch(config, student, savedBodies);
  const draft = saved.draft;
  if (batchSave) {
    batch = [];
    collecting = false;
  }
  const index = await loadIndex(config.fingerprintDir);
  index.pending = null;
  await saveIndex(config.fingerprintDir, index);
  await rm(pendingPath(config.fingerprintDir), { force: true });
  pending = null;
  const cacheKey = student.rowNumber ? String(student.rowNumber) : studentKey(draft);
  cached[cacheKey] = { ...cached[cacheKey], ...draft };

  const linked = {
    phase: "ready",
    headline: "Place a finger",
    lastMatch: lastMatchOf(draft, draft.capturedAt),
  };
  const plan = await acceptPresent(draft).catch((error) => ({ error: error.message }));
  const extra = markDetail(plan) || "Saved on this computer.";
  const who = draft.studentId;
  const detail = batchSave
    ? `Saved ${savedCount} scan${savedCount === 1 ? "" : "s"}. ${extra}`
    : `Linked ${who}. ${extra}`;
  const hadGallery = batchImages.length > 1;
  clearBatchImages();
  publish({
    ...linked,
    detail,
    error: "",
    enroll: null,
    scanImages: [],
    present: shownPresent(),
    ...(hadGallery ? { scanImage: scanImageUrl() } : {}),
  });
  if (boutyEnabled) loadBoutyProfile(draft, draft.capturedAt);
  console.log(`linked ${who} file=${draft.templateFile} scans=${savedCount}`);
}

function watchWindow(win) {
  win.webContents.on("console-message", (event, level, message) => {
    const rank = event && (typeof event.level === "number" || typeof event.level === "string") ? event.level : level;
    const text = event && typeof event.message === "string" ? event.message : message;
    const bad = rank === 2 || rank === 3 || rank === "warning" || rank === "error";
    if (bad && text) console.error(`renderer ${text}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`window failed to load ${code} ${description} ${url}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`renderer gone ${details?.reason || "unknown"}`);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 900,
    minHeight: 680,
    show: false,
    backgroundColor: "#efeae2",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#efeae2",
      symbolColor: "#221e19",
      height: 48,
    },
    title: "Masjid Attendance",
    // Packaged builds leave this unset so Windows uses the icon in the exe.
    // ../../build/icon.png exists only in the dev tree, not inside app.asar.
    icon: app.isPackaged ? undefined : path.join(mainDir, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(mainDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  watchWindow(win);
  if (process.env.ELECTRON_RENDERER_URL) {
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
  win.once("ready-to-show", () => {
    win.show();
    console.log("attendance window open");
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(mainDir, "../renderer/index.html"));
  }
  win.webContents.send("state", state);
}

async function printRoster(config) {
  const index = await loadIndex(config.fingerprintDir);
  const names = await listTemplateNames(config);
  return { students: studentsWithPrints(index.students, names) };
}

function publishPrintsDeleted() {
  publish({
    phase: "prints",
    headline: "Fingerprints",
    detail: "Prints deleted.",
    error: "",
    canCloseSettings: true,
  });
}

async function forgetLocalPrint(config, student, files) {
  printsEpoch += 1;
  const id = canonicalPrintStudentId(student.studentId);
  for (const file of files) await rm(templatePath(config.fingerprintDir, file), { force: true });
  const index = await loadIndex(config.fingerprintDir);
  await saveIndex(config.fingerprintDir, dropPrintEnrollment(index, student, files));
  for (const cachedStudent of Object.values(cached)) {
    const sameId = id && canonicalPrintStudentId(cachedStudent.studentId) === id;
    const sameName =
      !id &&
      !String(student.key || "").startsWith("file:") &&
      !canonicalPrintStudentId(cachedStudent.studentId) &&
      student.studentName &&
      String(cachedStudent.studentName || "").trim().toLowerCase() === student.studentName.trim().toLowerCase();
    const pointed = files.some((file) => file.toLowerCase() === String(cachedStudent.templateFile || "").toLowerCase());
    if (sameId || sameName || pointed) {
      cachedStudent.templateFile = "";
      cachedStudent.capturedAt = "";
    }
  }
}

async function deleteStudentPrints(key) {
  if (!currentConfig?.fingerprintDir) throw new Error("The app is still starting.");
  const config = currentConfig;
  const student = (await printRoster(config)).students.find((item) => item.key === String(key || ""));
  if (!student) throw new Error("Choose a student from the list.");
  const plan = planStudentPrintDelete(student, [], await listTemplateNames(config));
  await forgetLocalPrint(config, student, plan.localFiles);
  publishPrintsDeleted();
}

async function finishLocalPrintWipe(config) {
  printsEpoch += 1;
  pending = null;
  batch = [];
  collecting = false;
  clearBatchImages();
  allowedImage = "";
  const removed = await clearFingerprints(config.fingerprintDir);
  for (const student of Object.values(cached)) {
    student.templateFile = "";
    student.capturedAt = "";
  }
  console.log(`cleared fingerprints removed=${removed}`);
  publish({
    phase: "config",
    detail: "All fingerprints deleted.",
    error: "",
    lastMatch: null,
    enroll: null,
    scanImage: "",
    scanImages: [],
    canCloseSettings: true,
  });
}

function rememberScreen() {
  if (state.phase === "config" || state.phase === "prints" || state.phase === "linking") return;
  savedScreen = { phase: state.phase, headline: state.headline, detail: state.detail };
}

function resetBoutyView() {
  boutyAccountVersion += 1;
  boutyNames.clear();
  cached = {};
  publish({ lastMatch: null });
}

function registerIpc() {
  ipcMain.handle("saveBouty", (_event, input) => serialBouty(async () => {
    try {
      if (!boutyContext) throw new Error("Bouty is still starting.");
      const settings = JSON.parse(String(input?.settings || ""));
      parseBoutyMapping(settings.mapping);
      if (!settings.days || Array.isArray(settings.days) || typeof settings.days !== "object" ||
          !Number.isSafeInteger(settings.presentStatusId) || settings.presentStatusId < 1 ||
          !Number.isSafeInteger(settings.absentStatusId) || settings.absentStatusId < 1 ||
          Object.entries(settings.days).some(([date, id]) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(id) || id < 1)) {
        throw new Error("Invalid Bouty settings.");
      }
      if (input?.password) {
        if (boutyEnabled) throw new Error("Sign out before using a different Bouty account.");
        await boutySession.signIn(input.username, input.password);
        try { await boutyCredentials.save({ username: input.username, password: input.password }); }
        catch (error) { await boutySession.signOut(); throw error; }
        boutyOwner = accountKey(input.username);
        boutyEnabled = true;
        resetBoutyView();
        roster = await rosterCache.read(boutyOwner);
        await publishAttendance();
      } else if (!boutyEnabled) throw new Error("Enter the Bouty username and password.");
      const temporary = `${boutyContext.file}.tmp`;
      await mkdir(path.dirname(boutyContext.file), { recursive: true });
      await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 });
      await rename(temporary, boutyContext.file);
      boutySettings = settings;
      publishBouty("");
      void boutySync.sync();
      if (!roster) void refreshRoster().catch(() => {});
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  }));
  ipcMain.handle("signOutBouty", async () => {
    if (boutySigningOut) return { ok: false, error: "Bouty is signing out." };
    boutySigningOut = true;
    try {
      return await serialBouty(async () => {
        await boutyCredentials.clear();
        await rosterCache.clear().catch(() => {});
        roster = null;
        boutyOwner = null;
        boutyEnabled = false;
        resetBoutyView();
        await publishAttendance();
        publishBouty("");
        await boutySession.signOut();
        return { ok: true };
      });
    } catch (error) { return { ok: false, error: error.message }; }
    finally { boutySigningOut = false; }
  });
  ipcMain.handle("getState", () => state);
  ipcMain.handle("updateAction", () => updateAction());
  ipcMain.handle("boutyRoster", async (_event, { query, page = 1, refresh } = {}) => {
    if (!boutyOwner || boutySigningOut) return { error: "Bouty: sign in to look up students." };
    let notice = "";
    const version = boutyAccountVersion;
    try {
      if (refresh || !roster) await refreshRoster();
    } catch {
      notice = "Showing saved Bouty students.";
    }
    if (version !== boutyAccountVersion || boutySigningOut) return { error: "Bouty account changed." };
    if (!roster) return { error: "Connect to Bouty to save the student list for offline use." };
    const text = String(query || "").trim().slice(0, 120);
    const students = roster.map(({ id, rosterName, studentName, studentNumber }) =>
      ({ id, studentName: rosterName || studentName, studentNumber, studentId: studentNumber }));
    const filtered = text ? fuzzyStudents(students, text) : students;
    const number = Number.isSafeInteger(page) && page > 0 ? page : 1;
    return { students: filtered.slice((number - 1) * 15, number * 15), hasNext: filtered.length > number * 15, notice };
  });
  ipcMain.handle("boutyStudent", async (_event, { id, studentNumber } = {}) => {
    const config = currentConfig;
    const version = boutyAccountVersion;
    if (!config || !boutyOwner || boutySigningOut) return { error: "Bouty: sign in to look up students." };
    const saved = roster?.find((entry) => entry.id === Number(id));
    try {
      const profile = net.isOnline() || !saved
        ? await withBoutyLookup((api) => api.studentById(id, String(studentNumber || "").slice(0, 32))).catch((error) => {
          if (!saved) throw error;
          return saved;
        })
        : saved;
      if (version !== boutyAccountVersion || boutySigningOut) return { error: "Bouty account changed." };
      const studentId = `bouty:${profile.id}`;
      boutyNames.set(studentId, profile.studentName);
      return { studentName: profile.studentName, studentId, studentNumber: profile.studentNumber || String(profile.id), fields: profile.fields };
    } catch (error) {
      return { error: error?.message?.startsWith("Bouty") ? error.message : "Bouty student information is unavailable." };
    }
  });
  ipcMain.handle("filter", async (_event, query) => {
    const config = currentConfig;
    const version = boutyAccountVersion;
    if (!config || !boutyOwner || boutySigningOut) return { students: [], error: "Bouty: sign in to look up students." };
    try {
      const profiles = roster ?? await refreshRoster();
      const index = await loadIndex(config.fingerprintDir);
      const names = await listTemplateNames(config);
      if (version !== boutyAccountVersion || boutySigningOut || currentConfig !== config) return { students: [] };
      const choices = boutyStudentChoices(profiles, index.students);
      const text = String(query || "").trim().slice(0, 120);
      const numbers = new Map(profiles.map((profile) => [profile.id, profile.studentNumber]));
      const matches = fuzzyStudents(choices, text);
      const found = new Set(matches);
      for (const student of choices) {
        if (text && numbers.get(student.siteId) === text && !found.has(student)) matches.unshift(student);
      }
      return { students: matches.map((student) => {
        const key = `bouty:${student.siteId}`;
        cached[key] = student;
        const printCount = studentTemplateNames(student, names).length;
        return { key, studentId: numbers.get(student.siteId) || String(student.siteId), studentName: student.studentName, printCount };
      }) };
    } catch {
      return { students: [], error: "Connect to Bouty to save the student list for offline use." };
    }
  });
  ipcMain.handle("assign", async (_event, key) => {
    try {
      await exclusive(() => assignStudent(key));
      return { ok: true };
    } catch (err) {
      publish({
        phase: pending ? "pending" : state.phase,
        detail: err.message,
        error: err.message,
      });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("rescan", async () => {
    try {
      await exclusive(() => rescanCapture());
      return { ok: true };
    } catch (err) {
      publish({ error: err.message });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("discardScans", async () => {
    try {
      await exclusive(() => discardScans());
      return { ok: true };
    } catch (err) {
      publish({ error: err.message });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("addMoreScans", async () => {
    try {
      await exclusive(() => addMoreScans());
      return { ok: true };
    } catch (err) {
      publish({
        phase: pending ? "pending" : state.phase,
        detail: err.message,
        error: err.message,
      });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("finishEnroll", async () => {
    await exclusive(() => finishEnroll());
    return { ok: true };
  });
  ipcMain.handle("openSettings", () => {
    if (state.phase === "linking") return;
    rememberScreen();
    pause = true;
    publish({
      phase: "config",
      headline: "Setup",
      detail: "Bouty account and scanner.",
      error: "",
      canCloseSettings: true,
    });
  });
  ipcMain.handle("closeSettings", () => {
    if (!currentConfig) return;
    pause = false;
    if (pending) {
      publish({
        phase: "pending",
        headline: "New fingerprint",
        detail: collecting ? chooseDetail(batch.length) : "Choose who this print belongs to.",
        error: "",
        enroll: enrollView(),
      });
      return;
    }
    const next = savedScreen || { phase: "ready", headline: "Place a finger", detail: "Listening" };
    publish({
      phase: next.phase === "config" || next.phase === "prints" || next.phase === "linking" ? "ready" : next.phase,
      headline: next.headline || "Place a finger",
      detail: next.detail || "Listening",
      error: "",
    });
  });
  ipcMain.handle("openPrints", () => {
    if (state.phase === "linking") return;
    rememberScreen();
    pause = true;
    publish({
      phase: "prints",
      headline: "Fingerprints",
      detail: "Remove one student's fingerprints from this computer.",
      error: "",
      canCloseSettings: true,
    });
  });
  ipcMain.handle("closePrints", () => {
    if (!currentConfig) return;
    pause = false;
    if (pending) {
      publish({
        phase: "pending",
        headline: "New fingerprint",
        detail: collecting ? chooseDetail(batch.length) : "Choose who this print belongs to.",
        error: "",
        enroll: enrollView(),
      });
      return;
    }
    const next = savedScreen || { phase: "ready", headline: "Place a finger", detail: "Listening" };
    publish({
      phase: next.phase === "config" || next.phase === "prints" || next.phase === "linking" ? "ready" : next.phase,
      headline: next.headline || "Place a finger",
      detail: next.detail || "Listening",
      error: "",
    });
  });
  ipcMain.handle("listPrints", async (_event, query) => {
    if (!currentConfig?.fingerprintDir) return [];
    try {
      const roster = await printRoster(currentConfig);
      return fuzzyStudents(roster.students, query).map((student) => ({
        key: student.key,
        studentId: student.studentId,
        studentName: student.studentName,
        count: student.count,
      }));
    } catch (err) {
      console.error(err.message);
      return [];
    }
  });
  ipcMain.handle("deleteStudentPrints", async (_event, key) => {
    try {
      await exclusive(() => deleteStudentPrints(key));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("saveConfig", async (_event, input) => {
    try {
      const prev = loadConfig(configOptions());
      await writeConfigFile(prev, {
        zk4500Cli: String(input?.zk4500Cli || "").trim() || prev.zk4500Cli,
        scanTimeoutSeconds: prev.scanTimeoutSeconds,
        syncIntervalSeconds: prev.syncIntervalSeconds,
        updateChannel: input?.updateChannel === "nightly" ? "nightly" : "stable",
      });
      await saveUpdateChannelPreference(input?.updateChannel === "nightly" ? "nightly" : "stable");
      pause = false;
      await startLoop();
      if (app.isPackaged) {
        configureAutoUpdater();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("markPresent", async (_event, student) => {
    const at = new Date().toISOString();
    try {
      const result = await exclusive(() => acceptPresent(student, at));
      if (result?.op === "missing-id") return { ok: false, error: "This student has no Bouty ID." };
      const match = lastMatchOf(student, at);
      publish({ lastMatch: { ...match, studentName: student.studentName || match.studentName,
        fields: student.fields || match.fields, profileStatus: "" } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("undoAttendance", async (_event, input) => {
    try { return await exclusive(() => acceptAbsent(input)); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("clearFingerprints", async () => {
    if (!currentConfig?.fingerprintDir) return { ok: false, error: "The app is still starting." };
    try {
      await exclusive(() => finishLocalPrintWipe(currentConfig));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("pickFile", async (_event, kind) => {
    const filters =
      kind === "exe"
        ? [{ name: "Executable", extensions: ["exe"] }]
        : [{ name: "JSON", extensions: ["json"] }];
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
    if (result.canceled || !result.filePaths[0]) return "";
    return result.filePaths[0];
  });
}

app.setPath("userData", legacyUserDataPath(app.getPath("appData")));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(async () => {
    try {
      protocol.handle("print", (request) => {
        const file = printFile(request.url);
        if (!file) return new Response("Not found", { status: 404 });
        return net.fetch(pathToFileURL(file).href);
      });
      app.setAppUserModelId("com.masjid.attendance");
      Menu.setApplicationMenu(null);
      registerIpc();
      updateState.version = app.getVersion();
      state.appVersion = app.getVersion();
      setupAutoUpdater();
      boutyContext = await setupBouty();
      publishBouty();
      await createWindow();
      await startLoop();
      await publishAttendance();
      if (boutyOwner && !roster) void refreshRoster().catch(() => {});
      if (app.isPackaged) setTimeout(() => checkForUpdates(), 5000);
      void boutySync.sync();
      setInterval(() => {
        void boutySync.sync();
        if (boutyOwner && !roster && net.isOnline()) void refreshRoster().catch(() => {});
        void publishAttendance().catch((error) => publishBouty(error.message));
      }, (currentConfig?.syncIntervalSeconds || 60) * 1000).unref();
    } catch (err) {
      console.error(err);
      publish({
        phase: "ready",
        headline: "Place a finger",
        detail: err.message,
        error: err.message,
        canCloseSettings: true,
      });
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitRequested) return;
    event.preventDefault();
    quitRequested = true;
    appRunning = false;
    generation += 1;
    Promise.allSettled([identifyPromise, loopDone, boutyLookupTail]).then(() => app.quit());
  });
}
