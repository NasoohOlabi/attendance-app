import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol } from "electron";
import { legacyUserDataPath, loadConfig, scannerExeInResources } from "../config.mjs";
import { appLogFile, startAppLog } from "../log.mjs";
import {
  createGoogle,
  explainApiFailure,
  isSheetPermissionError,
  appendSheetRow,
  clearSheetBelowHeader,
  deleteSheetRows,
  ensureDateColumn,
  getDateHeader,
  getSheetGrid,
  writeAttendanceCell,
  writeSheetCell,
  writeSheetValues,
} from "../google.mjs";
import { appendScanTrace, beginScanAttempt, mergeCapturedFiles, planScanRetry, runIdentify, SCAN_OUTAGE_MESSAGE, SCAN_RETRY_PAUSE_MS } from "../scan.mjs";
import {
  captureScreen,
  findDateColumn,
  fuzzyStudents,
  clearFingerprints,
  loadIndex,
  mergeStudents,
  attendanceLogRow,
  attendanceStamp,
  attachLogTimes,
  canonicalStudentId,
  clocksFromAppLog,
  clockFromStamp,
  columnLetter,
  FINGERPRINT_HEADER,
  fingerprintFiles,
  fingerprintHeaderMissing,
  fingerprintSheetRow,
  logLayout,
  matchingLogRow,
  planClearRow,
  stampFromClock,
  withScanTimes,
  parseAttendanceGrid,
  presentToday,
  pendingPath,
  planAttendance,
  putStudent,
  readStudents,
  saveIndex,
  sheetProblem,
  studentKey,
  planBatchFiles,
  templateFileForStudent,
  templatePath,
  writeLog,
} from "../store.mjs";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
startAppLog();

protocol.registerSchemesAsPrivileged([
  { scheme: "print", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let allowedImage = "";
let batchImages = [];
let batchTokens = [];

let win = null;
let client = null;
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
let printsEpoch = 0;
let lock = Promise.resolve();
let sheetDenied = false;
let sheetReported = false;
let scannerReady = true;
let scanFailStreak = 0;

let state = {
  phase: "ready",
  headline: "Place a finger",
  detail: "Listening",
  trace: [],
  lastMatch: null,
  scanImage: "",
  scanImages: [],
  error: "",
  syncNote: "",
  fingerprintDir: "",
  config: null,
  canCloseSettings: false,
  enroll: null,
  present: null,
};

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
  return {
    serviceAccountJson: config.serviceAccountJson || "",
    spreadsheetId: config.spreadsheetId || "",
    sheetGid: config.sheetGid,
    zk4500Cli: config.zk4500Cli || "",
    fingerprintDir: config.fingerprintDir,
    scanTimeoutSeconds: config.scanTimeoutSeconds,
    syncIntervalSeconds: config.syncIntervalSeconds,
  };
}

async function accountEmail(config) {
  try {
    const parsed = JSON.parse(await readFile(config.serviceAccountJson, "utf8"));
    return parsed.client_email || "";
  } catch {
    return "";
  }
}

async function failureNote(config, err) {
  return explainApiFailure(err?.message || "", await accountEmail(config));
}

async function writeConfigFile(config, patch) {
  let file = {};
  try {
    file = JSON.parse(await readFile(config.configPath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const next = { ...file, ...patch };
  delete next.private_key;
  delete next.driveFolderId;
  delete next.driveSync;
  await mkdir(path.dirname(config.configPath), { recursive: true });
  await writeFile(config.configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function cacheStudents(students) {
  cached = {};
  for (const student of Object.values(students || {})) {
    if (!student) continue;
    if (!String(student.studentId || "").trim() && !String(student.studentName || "").trim()) continue;
    cached[studentKey(student)] = student;
  }
}

function cacheFromSheet(merged, rows) {
  cached = {};
  const duplicates = new Set((merged.duplicates || []).map((id) => String(id).trim().toLowerCase()));
  for (const sheet of readStudents(rows)) {
    const local = duplicates.has(String(sheet.studentId).trim().toLowerCase()) ? {} : merged.students[studentKey(sheet)] || {};
    cached[String(sheet.rowNumber)] = {
      studentId: sheet.studentId || "",
      studentName: sheet.studentName || "",
      rowNumber: sheet.rowNumber,
      templateFile: local.templateFile || "",
      capturedAt: local.capturedAt || "",
    };
  }
}

function viewStudent(student) {
  return {
    key: student.rowNumber ? String(student.rowNumber) : studentKey(student),
    studentId: student.studentId || "",
    studentName: student.studentName || "",
    hasPrint: Boolean(student.templateFile),
  };
}

function reportSheet(title, rows) {
  if (sheetReported) return;
  sheetReported = true;
  const grid = parseAttendanceGrid(rows);
  const today = findDateColumn(grid.header, new Date());
  const dateText = (grid.header || [])
    .map((cell) => String(cell).trim())
    .filter((cell) => /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{1,2}\/\d{1,2}$/i.test(cell) || /^\d{1,2}\/\d{1,2}$/.test(cell))
    .join(" | ");
  const names = grid.students.slice(0, 5).map((student) => student.studentName).join(" | ");
  console.log(
    `sheet tab ${JSON.stringify(title)} headerRow ${grid.headerRowNumber} summaryRow ${grid.summaryRowNumber} today ${today ? today.header : "missing"} dates ${dateText} names ${names} duplicates ${grid.duplicates.length}`,
  );
}

async function reloadStudents(config) {
  const { title, rows } = await getSheetGrid(client, config.spreadsheetId, config.sheetGid);
  reportSheet(title, rows);
  const problem = sheetProblem(rows);
  if (problem) throw new Error(problem);
  const index = await loadIndex(config.fingerprintDir);
  const merged = mergeStudents(index, rows);
  await saveIndex(config.fingerprintDir, merged);
  cacheFromSheet(merged, rows);
  publish({ present: await timesFor(config, presentToday(rows, new Date())) });
  return { merged, rows, title };
}

let scanTimes = { day: "", rows: {} };
let namedClocks = {};

function scanTimesPath() {
  return path.join(homedir(), "Masjid", "scan-times.json");
}

async function loadScanTimes() {
  const day = attendanceStamp(new Date()).split(" ")[0];
  scanTimes = { day, rows: {} };
  try {
    const saved = JSON.parse(await readFile(scanTimesPath(), "utf8"));
    if (saved?.day === day && saved.rows) scanTimes = { day, rows: saved.rows };
  } catch {
    // No remembered scans yet today.
  }
  try {
    namedClocks = clocksFromAppLog(await readFile(appLogFile(), "utf8"));
  } catch {
    namedClocks = {};
  }
}

function rememberClock(rowNumber, clock) {
  const row = Number(rowNumber);
  const text = String(clock || "").trim();
  if (!row || !/^\d{2}:\d{2}$/.test(text)) return;
  const day = attendanceStamp(new Date()).split(" ")[0];
  if (scanTimes.day !== day) scanTimes = { day, rows: {} };
  scanTimes.rows[row] = text;
  mkdir(path.dirname(scanTimesPath()), { recursive: true })
    .then(() => writeFile(scanTimesPath(), JSON.stringify(scanTimes)))
    .catch((err) => console.error(err.message));
}

function rememberScan(rowNumber, date) {
  rememberClock(rowNumber, clockFromStamp(attendanceStamp(date)));
}

function forgetScan(rowNumber) {
  delete scanTimes.rows[Number(rowNumber)];
  writeFile(scanTimesPath(), JSON.stringify(scanTimes)).catch((err) => console.error(err.message));
}

async function timesFor(config, people) {
  let timed = people.map((item) => ({ ...item, time: "", logRow: 0 }));
  if (config.logSpreadsheetId) {
    try {
      const log = await getSheetGrid(client, config.logSpreadsheetId, config.logSheetGid);
      timed = attachLogTimes(people, log.rows, new Date());
    } catch (err) {
      console.error(err.message);
    }
  }
  const day = attendanceStamp(new Date()).split(" ")[0];
  const rows = scanTimes.day === day ? scanTimes.rows : {};
  return withScanTimes(timed, rows, namedClocks);
}

async function publishPresent(config) {
  if (!client || sheetDenied) return;
  const { rows } = await getSheetGrid(client, config.spreadsheetId, config.sheetGid);
  publish({ present: await timesFor(config, presentToday(rows, new Date())) });
}

async function markAttendance(config, student, present) {
  if (!client || sheetDenied) return { op: "skipped" };
  const today = new Date();
  const [{ title, rows }, layout] = await Promise.all([
    getSheetGrid(client, config.spreadsheetId, config.sheetGid),
    getDateHeader(client, config.spreadsheetId, config.sheetGid),
  ]);
  const plan = planAttendance(rows, student.studentId, today, present, layout);
  if (plan.insert) await ensureDateColumn(client, config.spreadsheetId, config.sheetGid, today);
  if (plan.op !== "update") return plan;
  await writeAttendanceCell(client, config.spreadsheetId, title, plan.a1, plan.value);
  if (plan.value === "حاضر") rememberScan(plan.rowNumber, today);
  if (plan.value === "حاضر" && config.logSpreadsheetId) {
    try {
      const log = await getSheetGrid(client, config.logSpreadsheetId, config.logSheetGid);
      await appendSheetRow(
        client,
        config.logSpreadsheetId,
        config.logSheetGid,
        attendanceLogRow(student.studentId, today, log.rows[0] || ["الطالب", "حضور"], student.studentName),
      );
    } catch (err) {
      console.error(err.message);
      plan.logError = err.message;
    }
  }
  return plan;
}

function markDetail(plan) {
  if (plan.op === "update" && plan.value === "حاضر") {
    return plan.logError ? "Marked present. The time log was not written." : "Marked present.";
  }
  if (plan.op === "missing-date") return "Today's date column is missing, so the sheet was not changed.";
  if (plan.op === "duplicate") return "That id is on the sheet more than once, so no cell was changed.";
  if (plan.op === "missing-id") return "That student has no id, so no cell was changed.";
  if (plan.op === "missing-student") return "That student is not on the sheet. No row was added.";
  return "";
}

function templateText(body) {
  return Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
}

/** Append one fingerprints-tab row per print. A failed write leaves the local file in place. */
async function appendFingerprints(config, studentId, bodies, when = new Date()) {
  const id = canonicalStudentId(studentId);
  const texts = (bodies || []).map(templateText).filter((text) => text.trim());
  if (!id || !texts.length || !config.logSpreadsheetId) return;
  const gid = config.fingerprintSheetGid;
  const grid = await getSheetGrid(client, config.logSpreadsheetId, gid);
  let header = grid.rows[0] || FINGERPRINT_HEADER;
  if (fingerprintHeaderMissing(grid.rows)) {
    header = FINGERPRINT_HEADER;
    await writeSheetValues(client, config.logSpreadsheetId, grid.title, "A1", [header]);
  }
  for (const text of texts) {
    await appendSheetRow(client, config.logSpreadsheetId, gid, fingerprintSheetRow(id, text, header, when));
  }
}

/** Copy sheet templates that are missing on disk. Local files the sheet does not list stay. */
async function syncStoredPrints(config) {
  if (!config.logSpreadsheetId) return;
  const index = await loadIndex(config.fingerprintDir);
  const grid = await getSheetGrid(client, config.logSpreadsheetId, config.fingerprintSheetGid);
  const existing = await listTemplateNames(config);
  const have = new Set(existing.map((name) => name.toLowerCase()));
  const planned = fingerprintFiles(grid.rows);
  let wrote = 0;
  for (const item of planned) {
    if (have.has(item.file.toLowerCase())) continue;
    await writeFile(templatePath(config.fingerprintDir, item.file), item.template);
    have.add(item.file.toLowerCase());
    wrote += 1;
  }
  const linked = new Set();
  let changed = wrote > 0;
  for (const item of planned) {
    if (linked.has(item.studentId)) continue;
    const primary = templateFileForStudent({ studentId: item.studentId });
    if (!have.has(primary.toLowerCase())) continue;
    linked.add(item.studentId);
    const prev = index.students[studentKey({ studentId: item.studentId })] || {};
    if (String(prev.templateFile || "").toLowerCase() === primary.toLowerCase()) continue;
    changed = true;
    putStudent(index, {
      studentId: item.studentId,
      studentName: prev.studentName || "",
      templateFile: primary,
      capturedAt: prev.capturedAt || "",
    });
  }
  if (changed) await saveIndex(config.fingerprintDir, index);
  console.log(`fingerprint sheet rows=${planned.length} wrote=${wrote}`);
}

async function syncOnce(config) {
  if (!client || sheetDenied) return;
  await reloadStudents(config);
}

async function safeSync(config, gen) {
  if (sheetDenied) return;
  publish({ syncNote: "Syncing…" }, gen);
  try {
    await exclusive(() => syncOnce(config));
    if (sheetDenied) return;
    publish({ syncNote: `Synced ${new Date().toLocaleTimeString()}` }, gen);
  } catch (err) {
    const note = await failureNote(config, err);
    if (isSheetPermissionError(err.message)) sheetDenied = true;
    console.log(note);
    publish({ syncNote: note, error: note }, gen);
  }
}

async function showPending(config, gen, reason = "") {
  let detail = reason || "Choose who this print belongs to.";
  let error = "";
  try {
    await reloadStudents(config);
  } catch (err) {
    error = `Can't load students from the sheet: ${err.message}`;
    detail = error;
    const index = await loadIndex(config.fingerprintDir);
    cacheStudents(index.students);
  }
  if (!error && Object.keys(cached).length === 0) {
    detail = "No students on the sheet yet. Add them in Google Sheets. This print is kept.";
  }
  publish({ phase: "pending", headline: "New fingerprint", detail, error, canCloseSettings: true, enroll: null }, gen);
}

async function restorePending(config, gen) {
  const index = await loadIndex(config.fingerprintDir);
  cacheStudents(index.students);
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
  pending = null;
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
  const who = decision.student?.studentName || decision.student?.studentId || "";
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
    const who = student.studentName || student.studentId;
    console.log(`matched ${who || student.templateFile}`);
    let extra = "";
    try {
      extra = markDetail(await markAttendance(config, student, true));
    } catch (err) {
      extra = await failureNote(config, err);
      if (isSheetPermissionError(err.message)) sheetDenied = true;
      console.error(err.message);
    }
    const detail = [`Matched ${who}`, extra].filter(Boolean).join(" ");
    const marked = extra.startsWith("Marked");
    publish(
      {
        phase: pause ? state.phase : "ready",
        headline: pause ? state.headline : "Place a finger",
        detail: pause ? state.detail : detail,
        lastMatch: {
          studentName: student.studentName || "",
          studentId: student.studentId || "",
          at: new Date().toISOString(),
        },
        scanImage,
        scanImages: [],
        error: extra.startsWith("Marked") ? "" : extra,
      },
      gen,
    );
    if (marked) await publishPresent(config);
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
  await showPending(config, gen, decision.reason);
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

async function prepareGoogle(config, gen) {
  sheetDenied = false;
  sheetReported = false;
  try {
    client = await createGoogle(config);
  } catch (err) {
    client = null;
    publish({ error: err.message }, gen);
  }
  return config;
}

async function runLoop(config, gen) {
  await exclusive(async () => {
    if (gen !== generation) return;
    await restorePending(config, gen);
  });
  let sheetReady = false;
  const googleTask = (async () => {
    try {
      config = await prepareGoogle(config, gen);
      currentConfig = config;
      if (!client || sheetDenied || gen !== generation) return;
      await exclusive(async () => {
        if (gen !== generation) return;
        try {
          await syncStoredPrints(config);
        } catch (err) {
          console.error(err.message);
          if (isSheetPermissionError(err.message)) console.log(await failureNote(config, err));
        }
        await reloadStudents(config);
      });
    } catch (err) {
      const note = await failureNote(config, err);
      if (isSheetPermissionError(err.message)) sheetDenied = true;
      console.log(note);
      publish({ syncNote: note, error: note }, gen);
    } finally {
      sheetReady = true;
    }
  })();
  void googleTask;
  let nextSync = Date.now() + config.syncIntervalSeconds * 1000;
  while (appRunning && gen === generation) {
    try {
      if (pause) {
        await sleep(250);
        continue;
      }
      if (sheetReady && !sheetDenied && Date.now() >= nextSync) {
        nextSync = Date.now() + config.syncIntervalSeconds * 1000;
        await safeSync(config, gen);
        if (gen !== generation) return;
        if (!pending && !pause && String(state.detail).startsWith("Syncing")) {
          publish({ detail: "Listening" }, gen);
        }
      }
      if (pause || pending || !scannerReady || gen !== generation) {
        await sleep(300);
        continue;
      }
      await oneScan(config, gen);
    } catch (err) {
      publish({ error: err.message }, gen);
      await sleep(2000);
    }
  }
}

async function ensureRoster(config) {
  try {
    const index = await loadIndex(config.fingerprintDir);
    await writeLog(config.fingerprintDir, index);
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
    config = loadConfig(configOptions());
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
  await ensureRoster(config);
  publish({
    phase: "ready",
    headline: "Place a finger",
    detail: "Listening",
    fingerprintDir: config.fingerprintDir,
    config: publicConfig(config),
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
  if (scannerReady) publish({ detail: "Syncing templates…" });
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

async function writeBatch(config, student, bodies) {
  const primary = templateFileForStudent(student);
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
  const templateFile = templateFileForStudent(student);
  let uploadBody = null;
  let draft;
  let savedCount = 1;
  let savedBodies = [];
  if (!batchSave) {
    uploadBody = await readFile(pendingPath(config.fingerprintDir));
    if (!uploadBody.length) throw new Error("The saved print is empty.");
    draft = {
      studentId: student.studentId || "",
      studentName: student.studentName || "",
      rowNumber: student.rowNumber,
      templateFile,
      capturedAt: new Date().toISOString(),
    };
  }

  publish({
    phase: "linking",
    detail: batchSave ? "Saving these scans…" : "Saving this print…",
    error: "",
    enroll: null,
  });
  if (batchSave) {
    savedBodies = batch.slice();
    savedCount = savedBodies.length;
    const saved = await writeBatch(config, student, savedBodies);
    draft = saved.draft;
    batch = [];
    collecting = false;
  } else {
    const names = await listTemplateNames(config);
    const stem = templateFile.replace(/\.txt$/i, "").toLowerCase();
    for (const name of names) {
      const sid = name.replace(/\.txt$/i, "").toLowerCase();
      if (sid.startsWith(`${stem}--`) || (name !== templateFile && sid === stem)) {
        await rm(templatePath(config.fingerprintDir, name), { force: true });
      }
    }
    savedBodies = [uploadBody];
    const index = await loadIndex(config.fingerprintDir);
    await writeFile(templatePath(config.fingerprintDir, templateFile), uploadBody);
    putStudent(index, draft);
    index.pending = null;
    await saveIndex(config.fingerprintDir, index);
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
    lastMatch: {
      studentName: draft.studentName,
      studentId: draft.studentId,
      at: draft.capturedAt,
    },
  };
  let extra = "Saved on this computer.";
  let problem = "";
  let fingerprintNote = "";
  if (client && canonicalStudentId(draft.studentId)) {
    try {
      await appendFingerprints(config, draft.studentId, savedBodies, draft.capturedAt);
    } catch (err) {
      console.error(err.message);
      fingerprintNote = "The fingerprint sheet was not written.";
    }
  }
  if (client && !sheetDenied) {
    try {
      const plan = await markAttendance(config, draft, true);
      const note = markDetail(plan);
      if (note) extra = problem ? `${note} ${problem}` : note;
    } catch (err) {
      console.error(err.message);
      if (isSheetPermissionError(err.message)) sheetDenied = true;
      problem = await failureNote(config, err);
      extra = problem;
    }
  }
  if (fingerprintNote) extra = `${extra} ${fingerprintNote}`;
  const who = draft.studentName || draft.studentId;
  const detail = batchSave
    ? `Saved ${savedCount} scan${savedCount === 1 ? "" : "s"}. ${extra}`
    : `Linked ${who}. ${extra}`;
  const marked = String(extra).includes("Marked present");
  const hadGallery = batchImages.length > 1;
  clearBatchImages();
  publish({
    ...linked,
    detail,
    error: problem,
    enroll: null,
    scanImages: [],
    ...(hadGallery ? { scanImage: scanImageUrl() } : {}),
  });
  if (marked) await publishPresent(config);
  console.log(`linked ${who} file=${templateFile} scans=${savedCount}`);
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

function registerIpc() {
  ipcMain.handle("getState", () => state);
  ipcMain.handle("filter", (_event, query) => fuzzyStudents(Object.values(cached), query).map(viewStudent));
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
    savedScreen = { phase: state.phase, headline: state.headline, detail: state.detail };
    pause = true;
    publish({
      phase: "config",
      headline: "Setup",
      detail: "Service account path, spreadsheet, gid, and scanner.",
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
      phase: next.phase === "config" || next.phase === "linking" ? "ready" : next.phase,
      headline: next.headline || "Place a finger",
      detail: next.detail || "Listening",
      error: "",
    });
  });
  ipcMain.handle("saveConfig", async (_event, input) => {
    try {
      const prev = loadConfig(configOptions());
      const serviceAccountJson = String(input?.serviceAccountJson || "").trim();
      if (serviceAccountJson.startsWith("{") || serviceAccountJson.includes("private_key")) {
        throw new Error("Service account must be a file path, not the key itself.");
      }
      const gidText = String(input?.sheetGid ?? "").trim();
      const sheetGid = gidText ? Number(gidText) : prev.sheetGid;
      if (!Number.isInteger(sheetGid) || sheetGid < 0) throw new Error("Sheet gid must be a number.");
      await writeConfigFile(prev, {
        serviceAccountJson,
        spreadsheetId: String(input?.spreadsheetId || "").trim(),
        sheetGid,
        zk4500Cli: String(input?.zk4500Cli || "").trim() || prev.zk4500Cli,
        scanTimeoutSeconds: prev.scanTimeoutSeconds,
        syncIntervalSeconds: prev.syncIntervalSeconds,
      });
      pause = false;
      await startLoop();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("undoAttendance", async (_event, input) => {
    if (!currentConfig || !client || sheetDenied) return { ok: false, error: "The sheet is not available." };
    const rowNumber = Number(input?.rowNumber);
    const logRow = Number(input?.logRow) || 0;
    try {
      await exclusive(async () => {
        const config = currentConfig;
        const today = new Date();
        const { title, rows } = await getSheetGrid(client, config.spreadsheetId, config.sheetGid);
        const plan = planClearRow(rows, rowNumber, today);
        if (plan.op !== "update") {
          throw new Error(plan.op === "missing-date" ? "Today's date column is missing." : "That student is not on the sheet.");
        }
        await writeAttendanceCell(client, config.spreadsheetId, title, plan.a1, "");
        forgetScan(plan.rowNumber);
        let logNote = "";
        if (logRow > 1 && config.logSpreadsheetId) {
          try {
            const log = await getSheetGrid(client, config.logSpreadsheetId, config.logSheetGid);
            if (matchingLogRow(log.rows, logRow, plan.studentId, today)) {
              await deleteSheetRows(client, config.logSpreadsheetId, config.logSheetGid, [logRow]);
            } else {
              logNote = " The time log row no longer matches, so it was left.";
            }
          } catch (err) {
            console.error(err.message);
            logNote = " The time log was not changed.";
          }
        }
        await publishPresent(config);
        publish({ detail: `${plan.name} removed from today.${logNote}`, error: logNote ? logNote.trim() : "" });
        console.log(`undo attendance ${plan.name} row=${plan.rowNumber}`);
      });
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("setAttendanceTime", async (_event, input) => {
    if (!currentConfig || !client || sheetDenied) return { ok: false, error: "The sheet is not available." };
    const stamp = stampFromClock(new Date(), input?.time);
    if (!stamp) return { ok: false, error: "Enter a time like 16:55." };
    if (!currentConfig.logSpreadsheetId) return { ok: false, error: "No time log sheet is configured." };
    const rowNumber = Number(input?.rowNumber);
    const logRow = Number(input?.logRow) || 0;
    try {
      await exclusive(async () => {
        const config = currentConfig;
        const today = new Date();
        const { rows } = await getSheetGrid(client, config.spreadsheetId, config.sheetGid);
        const plan = planClearRow(rows, rowNumber, today);
        if (!plan.name) throw new Error("That student is not on the sheet.");
        const log = await getSheetGrid(client, config.logSpreadsheetId, config.logSheetGid);
        const header = log.rows[0] || ["الطالب", "حضور"];
        const match = matchingLogRow(log.rows, logRow, plan.studentId, today);
        if (match) {
          await writeSheetCell(client, config.logSpreadsheetId, log.title, `${columnLetter(match.timeColumn)}${logRow}`, stamp);
        } else {
          const values = attendanceLogRow(plan.studentId, today, header, plan.studentName);
          values[logLayout(header).time] = stamp;
          await appendSheetRow(client, config.logSpreadsheetId, config.logSheetGid, values);
        }
        rememberClock(plan.rowNumber, clockFromStamp(stamp));
        await publishPresent(config);
        publish({ detail: `Time for ${plan.name} set to ${stamp}.`, error: "" });
        console.log(`attendance time ${plan.name} ${stamp}`);
      });
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("clearFingerprints", async () => {
    if (!currentConfig?.fingerprintDir) return { ok: false, error: "The app is still starting." };
    if (!client || sheetDenied || !currentConfig.logSpreadsheetId) {
      return { ok: false, error: "The fingerprint sheet is not available." };
    }
    try {
      await exclusive(async () => {
        const grid = await getSheetGrid(client, currentConfig.logSpreadsheetId, currentConfig.fingerprintSheetGid);
        await clearSheetBelowHeader(client, currentConfig.logSpreadsheetId, currentConfig.fingerprintSheetGid, grid.rows.length);
        printsEpoch += 1;
        const removed = await clearFingerprints(currentConfig.fingerprintDir);
        pending = null;
        batch = [];
        collecting = false;
        clearBatchImages();
        allowedImage = "";
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
      });
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, error: err.message };
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
      await loadScanTimes();
      await createWindow();
      await startLoop();
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
  app.on("before-quit", () => {
    appRunning = false;
  });
}
