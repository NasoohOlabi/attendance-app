import "./style.css";
import { applyDom, setFont, setLang, translate } from "./i18n.js";
import { fingerCue, matchTime, presentTrace, screenForPhase } from "./view.js";

const ready = document.querySelector("#ready");
const pending = document.querySelector("#pending");
const config = document.querySelector("#config");
const headline = document.querySelector("#headline");
const place = document.querySelector("#place");
const placeLabel = document.querySelector("#place-label");
const PLACE_LABEL = { now: "Place your finger", hold: "Hold still", wait: "One moment" };
const detail = document.querySelector("#detail");
const trace = document.querySelector("#trace");
const fingerReady = document.querySelector("#finger-ready");
const printsReady = document.querySelector("#prints-ready");
const printsPending = document.querySelector("#prints-pending");
const last = document.querySelector("#last");
const lastName = document.querySelector("#last-name");
const lastMeta = document.querySelector("#last-meta");
const lastChips = document.querySelector("#last-chips");
const lastFields = document.querySelector("#last-fields");
const phoneWarning = document.querySelector("#phone-warning");
const phonePrompt = document.querySelector("#phone-prompt");
const phoneNumber = document.querySelector("#phone-number");
const phoneError = document.querySelector("#phone-error");
const phoneSkip = document.querySelector("#phone-skip");
const phoneSave = document.querySelector("#phone-save");
const phoneStudent = document.querySelector("#phone-student");
let phoneScan = null;
let phoneSkipped = false;
let phoneSaving = false;
const todayCount = document.querySelector("#today-count");
const todayEmpty = document.querySelector("#today-empty");
const todayList = document.querySelector("#today-list");
const pendingDetail = document.querySelector("#pending-detail");
const search = document.querySelector("#search");
const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");
const sync = document.querySelector("#sync");
const settings = document.querySelector("#settings");
const printsPage = document.querySelector("#prints");
const printsNav = document.querySelector("#prints-nav");
const printsSearch = document.querySelector("#prints-search");
const printsList = document.querySelector("#prints-list");
const printsEmpty = document.querySelector("#prints-empty");
const attendance = document.querySelector("#attendance");
const update = document.querySelector("#update");
const updateDialog = document.querySelector("#update-dialog");
const updateDialogDetail = document.querySelector("#update-dialog-detail");
const updateProgress = document.querySelector("#update-progress");
const updateDialogAction = document.querySelector("#update-dialog-action");
const updateDialogClose = document.querySelector("#update-dialog-close");
const cancel = document.querySelector("#cancel");
const testModeSwitch = document.querySelector("#test-mode");
const testModeIndicator = document.querySelector("#test-mode-indicator");
const testModeProgress = document.querySelector("#test-mode-progress");
const persistentSettings = document.querySelector("#persistent-settings");
let switchingTestMode = false;
const confirm = document.querySelector("#confirm");
const confirmTitle = document.querySelector("#confirm-title");
const confirmWho = document.querySelector("#confirm-who");
const confirmName = document.querySelector("#confirm-name");
const confirmId = document.querySelector("#confirm-id");
const confirmDetail = document.querySelector("#confirm-detail");
const markManual = document.querySelector("#mark-manual");
const manualPick = document.querySelector("#manual-pick");
const manualSearch = document.querySelector("#manual-search");
const manualEmpty = document.querySelector("#manual-empty");
const manualList = document.querySelector("#manual-list");
const boutyRosterActions = document.querySelector("#bouty-roster-actions");
const boutyRosterPrev = document.querySelector("#bouty-roster-prev");
const boutyRosterNext = document.querySelector("#bouty-roster-next");
const boutyRosterRefresh = document.querySelector("#bouty-roster-refresh");
const confirmProfileChips = document.querySelector("#confirm-profile-chips");
const confirmProfileFields = document.querySelector("#confirm-profile-fields");
const confirmCancel = document.querySelector("#confirm-cancel");
const confirmOk = document.querySelector("#confirm-ok");
const dashboard = document.querySelector("#dashboard");
const dashboardView = document.querySelector("#dashboard-view");
const dashboardClose = document.querySelector("#dashboard-close");
const trend = document.querySelector("#trend");
const trendEmpty = document.querySelector("#trend-empty");

let picker = false;
let configOpen = false;
let filterGen = 0;
let linking = false;
let listLoading = false;
let lastState = null;
let confirmRequest = null;
let dashboardOpen = false;
let printsSeen = false;
let printsGen = 0;
let manualGen = 0;
let manualSearchTimer;
let boutyRosterPage = 1;
let deletingPrints = false;

function renderUpdate(updateState) {
  const info = updateState || {};
  update.hidden = !info.enabled;
  if (!info.enabled) return;
  const labels = {
    idle: "Check for updates",
    checking: "Checking for updates…",
    available: "Download update",
    "up-to-date": "Up to date",
    downloaded: "Restart to update",
    error: "Update unavailable",
  };
  const label = info.status === "downloading"
    ? `${translate("Downloading update…")} ${Math.max(0, Number(info.progress) || 0)}%`
    : translate(labels[info.status] || labels.idle);
  update.querySelector("span").textContent = label;
  update.disabled = info.status === "checking" || info.status === "downloading";
  update.title = info.error || "";
  const modal = ["checking", "available", "downloading", "downloaded", "error"].includes(info.status);
  updateDialog.hidden = !modal;
  if (modal) {
    const progress = Math.max(0, Math.min(100, Number(info.progress) || 0));
    updateProgress.value = progress;
    updateProgress.hidden = !["downloading", "downloaded"].includes(info.status);
    updateDialogDetail.textContent = info.status === "downloading"
      ? `${translate("Downloading update…")} ${progress}%${info.error ? ` — ${info.error}` : ""}`
      : info.error || translate(labels[info.status] || labels.idle);
    updateDialogAction.textContent = translate(info.status === "downloaded" ? "Restart to update" : info.status === "available" ? "Download update" : info.status === "error" ? "Try again" : "Check for updates");
    updateDialogAction.hidden = info.status === "checking" || info.status === "downloading";
  }
}

function renderDashboard(days) {
  trend.replaceChildren();
  const values = Array.isArray(days) ? days : [];
  trendEmpty.hidden = values.length !== 0;
  const max = Math.max(1, ...values.map((day) => Number(day.count) || 0));
  for (const day of values) {
    const item = document.createElement("div");
    item.className = "trend-day";
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = `${Math.max(4, ((Number(day.count) || 0) / max) * 100)}%`;
    bar.title = `${day.label}: ${day.count}`;
    const count = document.createElement("strong");
    count.textContent = day.count;
    const label = document.createElement("span");
    label.textContent = day.label;
    item.append(bar, count, label);
    trend.append(item);
  }
}

function setFinger(img, url, show) {
  if (!show || !url) {
    img.hidden = true;
    img.removeAttribute("src");
    return;
  }
  if (img.getAttribute("src") !== url) img.src = url;
  img.hidden = false;
}

function paintGallery(gallery, urls) {
  const frames = [...gallery.querySelectorAll("img")];
  const same = frames.length === urls.length && frames.every((img, index) => img.getAttribute("src") === urls[index]);
  if (!same) {
    gallery.replaceChildren();
    for (const url of urls) {
      const img = document.createElement("img");
      img.className = "finger";
      img.alt = translate("Scanned finger");
      img.src = url;
      gallery.appendChild(img);
    }
  }
  gallery.querySelectorAll("img").forEach((img, index, list) => {
    img.classList.toggle("is-new", index === list.length - 1);
    img.alt = translate("Scanned finger");
  });
  gallery.hidden = false;
}

function showFingers(img, gallery, images, singleUrl) {
  const urls = Array.isArray(images) ? images.filter(Boolean) : [];
  if (urls.length > 1) {
    setFinger(img, "", false);
    paintGallery(gallery, urls);
    return;
  }
  gallery.hidden = true;
  gallery.replaceChildren();
  setFinger(img, singleUrl || urls[0] || "", true);
}

function rescanButton() {
  const button = document.createElement("button");
  button.id = "rescan";
  button.className = "print-rescan";
  button.type = "button";
  button.setAttribute("aria-label", translate("Rescan"));
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2-5.1"/><path d="M19.5 4.5V9H15"/></svg>';
  button.addEventListener("click", () => window.attendance.rescan());
  return button;
}

function paintPendingGallery(images, singleUrl, locked) {
  const listed = Array.isArray(images) ? images.filter(Boolean) : [];
  const urls = listed.length ? listed : singleUrl ? [singleUrl] : [];
  const add = document.querySelector("#more-scans");
  if (!urls.length) {
    printsPending.hidden = true;
    printsPending.classList.remove("is-single");
    printsPending.replaceChildren(add);
    return;
  }
  const frames = [...printsPending.querySelectorAll(".print-frame")];
  const same =
    frames.length === urls.length && frames.every((frame, index) => frame.querySelector("img")?.getAttribute("src") === urls[index]);
  if (!same) {
    printsPending.replaceChildren(
      ...urls.map((url, index) => {
        const frame = document.createElement("div");
        frame.className = "print-frame";
        const img = document.createElement("img");
        img.className = "finger";
        if (urls.length > 1 && index === urls.length - 1) img.classList.add("is-new");
        img.alt = translate("Scanned finger");
        img.src = url;
        frame.append(img);
        if (index === urls.length - 1) frame.append(rescanButton());
        return frame;
      }),
      add,
    );
  } else {
    frames.forEach((frame, index) => {
      const img = frame.querySelector("img");
      if (img) {
        img.classList.toggle("is-new", urls.length > 1 && index === urls.length - 1);
        img.alt = translate("Scanned finger");
      }
      const rescan = frame.querySelector(".print-rescan");
      if (rescan) rescan.setAttribute("aria-label", translate("Rescan"));
    });
    if (add.parentElement !== printsPending) printsPending.append(add);
  }
  printsPending.classList.toggle("is-single", urls.length === 1);
  printsPending.hidden = false;
  add.disabled = locked;
  const rescan = printsPending.querySelector("#rescan");
  if (rescan) rescan.disabled = locked;
}

function closeManualPick() {
  clearTimeout(manualSearchTimer);
  manualGen += 1;
  boutyRosterPage = 1;
  manualPick.hidden = true;
  manualSearch.value = "";
  manualList.replaceChildren();
  manualEmpty.hidden = true;
}

function show(name) {
  if (name !== "ready") closeManualPick();
  ready.hidden = dashboardOpen || name !== "ready";
  pending.hidden = name !== "pending";
  config.hidden = name !== "config";
  printsPage.hidden = name !== "prints";
  settings.hidden = linking;
  dashboard.hidden = name !== "ready";
  dashboardView.hidden = !dashboardOpen;
  ready.classList.toggle("ready", name === "ready");
  const current = dashboardOpen ? "dashboard" : name === "config" ? "settings" : name === "prints" ? "prints" : name === "ready" ? "attendance" : "";
  attendance.setAttribute("aria-current", current === "attendance" ? "page" : "false");
  dashboard.setAttribute("aria-current", current === "dashboard" ? "page" : "false");
  settings.setAttribute("aria-current", current === "settings" ? "page" : "false");
  printsNav.setAttribute("aria-current", current === "prints" ? "page" : "false");
}

function renderList(students) {
  list.replaceChildren();
  empty.hidden = students.length !== 0 || listLoading;
  for (const student of students) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = linking;
    const name = document.createElement("span");
    name.dir = "auto";
    name.textContent = student.studentName || student.studentId || translate("Student");
    const sub = document.createElement("span");
    sub.className = "sub";
    const bits = [];
    if (student.studentId && student.studentId !== student.studentName) bits.push(student.studentId);
    const prints = Number(student.printCount) || 0;
    if (prints > 0) bits.push(translate(prints === 1 ? "1 print" : `${prints} prints`));
    else if (student.hasPrint) bits.push(translate("add"));
    sub.textContent = bits.join(" · ");
    button.append(name, sub);
    button.addEventListener("click", () => choose(student.key));
    item.append(button);
    list.append(item);
  }
}

async function refreshList() {
  const gen = ++filterGen;
  const result = await window.attendance.filter(search.value);
  if (gen !== filterGen) return;
  const students = Array.isArray(result) ? result : result?.students || [];
  empty.textContent = translate(Array.isArray(result) ? "No matching students" : result?.error || "No matching students");
  renderList(students);
}

async function choose(key) {
  if (linking) return;
  linking = true;
  for (const button of list.querySelectorAll("button")) button.disabled = true;
  const result = await window.attendance.assign(key);
  linking = false;
  if (!result?.ok) await refreshList();
}

function addBoutyRow(kind, first = "", second = "") {
  const row = document.createElement("div");
  row.className = "override-row";
  const labels = kind === "days" ? ["Date in Damascus", "Attendance day ID"] : ["Student ID", "Enrolment ID"];
  for (const [index, title] of labels.entries()) {
    const label = document.createElement("label");
    label.className = "field";
    const caption = document.createElement("span");
    caption.textContent = translate(title);
    caption.dataset.i18n = title;
    const input = document.createElement("input");
    input.type = index === 1 ? "number" : kind === "days" ? "date" : "text";
    input.dir = "ltr";
    input.required = true;
    if (index === 1) { input.min = "1"; input.step = "1"; }
    input.value = index === 0 ? first : second;
    label.append(caption, input);
    row.append(label);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = translate("Remove");
  remove.dataset.i18n = "Remove";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  document.querySelector(`#bouty-${kind}`).append(row);
}

document.querySelector("#add-bouty-day").addEventListener("click", () => addBoutyRow("days"));
document.querySelector("#add-bouty-link").addEventListener("click", () => addBoutyRow("mapping"));

function readBoutySettings() {
  for (const input of document.querySelectorAll("#bouty-advanced input")) {
    if (!input.reportValidity()) return null;
  }
  const rows = (kind) => [...document.querySelectorAll(`#bouty-${kind} .override-row`)].map((row) =>
    [...row.querySelectorAll("input")].map((input) => input.value.trim()));
  const dates = rows("days");
  if (new Set(dates.map(([date]) => date)).size !== dates.length) {
    error.hidden = false;
    error.textContent = translate("Each attendance date can only be listed once.");
    return null;
  }
  return JSON.stringify({
    mapping: rows("mapping").map(([studentId, enrollmentId]) => ({ studentId, enrollmentId: Number(enrollmentId) })),
    days: Object.fromEntries(dates.map(([date, id]) => [date, Number(id)])),
    presentStatusId: Number(document.querySelector("#bouty-present").value),
    absentStatusId: Number(document.querySelector("#bouty-absent").value),
  });
}

function fillConfig(state) {
  const cfg = state.config || {};
  document.querySelector("#app-version").textContent = state.appVersion || state.update?.version || "—";
  document.querySelector("#cfg-exe").value = cfg.zk4500Cli || "";
  document.querySelector("#cfg-dir").textContent = state.fingerprintDir || cfg.fingerprintDir || "";
  for (const button of document.querySelectorAll("[data-track]")) button.setAttribute("aria-pressed", String(button.dataset.track === (cfg.updateChannel || "stable")));
  const bouty = state.bouty || {};
  document.querySelector("#bouty-days").replaceChildren();
  document.querySelector("#bouty-mapping").replaceChildren();
  for (const [date, id] of Object.entries(bouty.days || {})) addBoutyRow("days", date, id);
  for (const row of bouty.mapping || []) addBoutyRow("mapping", row.studentId, row.enrollmentId);
  document.querySelector("#bouty-present").value = bouty.presentStatusId || 1;
  document.querySelector("#bouty-absent").value = bouty.absentStatusId || 2;
  document.querySelector("#bouty-user").value = "";
  document.querySelector("#bouty-password").value = "";
  cancel.hidden = !state.canCloseSettings;
}

const ICONS = {
  wait: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 18.5V15"/><path d="M9.2 16.2c.2-1.6.7-2.5.7-4.4a2.1 2.1 0 0 1 4.2 0c0 1.8.3 2.6.5 3.8"/><path d="M6.6 15c.3-1.5.8-2.4.8-4.8a4.6 4.6 0 0 1 9.2 0c0 2 .2 3 .5 4.2"/></svg>`,
  listen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M8.4 8.4a5.1 5.1 0 0 1 7.2 0"/><path d="M8.4 15.6a5.1 5.1 0 0 0 7.2 0"/><path d="M5.6 5.6a9 9 0 0 1 12.8 0"/><path d="M5.6 18.4a9 9 0 0 0 12.8 0"/></svg>`,
  again: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2-5.1"/><path d="M19.5 4.5V9H15"/></svg>`,
  ready: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 12.5 10 16l7.5-8"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 18.5V15"/><path d="M9.2 16.2c.2-1.6.7-2.5.7-4.4a2.1 2.1 0 0 1 4.2 0c0 1.8.3 2.6.5 3.8"/><path d="M6.6 15c.3-1.5.8-2.4.8-4.8a4.6 4.6 0 0 1 9.2 0c0 2 .2 3 .5 4.2"/></svg>`,
  saved: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 12.5 10 16l7.5-8"/></svg>`,
  picture: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="m4 16 4.2-3.6 2.8 2.4 2-1.6L20 17.5"/></svg>`,
  match: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 12.5 10 16l7.5-8"/></svg>`,
  miss: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M9 12h6"/></svg>`,
  idle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/></svg>`,
  trouble: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 8.2v5"/><circle cx="12" cy="16.2" r="0.7" fill="currentColor" stroke="none"/></svg>`,
  quiet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/></svg>`,
};

function renderTrace(lines) {
  const steps = presentTrace(lines);
  trace.hidden = steps.length === 0;
  trace.replaceChildren(
    ...steps.map((step) => {
      const item = document.createElement("li");
      item.className = `log-${step.tone}${step.live ? " log-now" : ""}`;
      const icon = document.createElement("span");
      icon.className = "log-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = ICONS[step.tone] || ICONS.quiet;
      const title = document.createElement("span");
      title.className = "log-title";
      if (step.tone === "match" && step.title.startsWith("Matched ")) {
        title.append(translate("Matched"));
        title.append(" ");
        const name = document.createElement("span");
        name.dir = "auto";
        name.textContent = step.title.slice("Matched ".length);
        title.append(name);
      } else {
        title.textContent = translate(step.title);
      }
      item.append(icon, title);
      if (step.meta) {
        const meta = document.createElement("span");
        meta.className = "log-meta";
        meta.dir = "ltr";
        meta.textContent = step.meta;
        item.append(meta);
      }
      return item;
    }),
  );
}

let todayKey = "";

function presentItem(item) {
  if (typeof item === "string") return { name: item, studentId: "", rowNumber: 0, time: "", logRow: 0 };
  return {
    name: item?.name || "",
    studentId: item?.studentId || "",
    rowNumber: Number(item?.rowNumber) || 0,
    time: item?.time || "",
    logRow: Number(item?.logRow) || 0,
  };
}

function renderToday(names) {
  const known = Array.isArray(names);
  const list = known ? names.map(presentItem).filter((item) => item.name) : [];
  let digits = todayCount.querySelector("span");
  if (!digits) {
    digits = document.createElement("span");
    digits.dir = "ltr";
    todayCount.replaceChildren(digits);
  }
  digits.textContent = known ? String(list.length) : "–";
  todayEmpty.hidden = list.length > 0;
  todayEmpty.textContent = translate(known ? "No one yet" : "Loading attendance");
  const key = JSON.stringify(list);
  if (key === todayKey) return;
  todayKey = key;
  todayList.replaceChildren(
    ...list.map((person) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "today-name";
      name.dir = "auto";
      name.textContent = person.name;
      const time = document.createElement("span");
      time.className = "today-time";
      time.textContent = person.time;
      time.dir = "ltr";
      const undo = document.createElement("button");
      undo.className = "today-undo";
      undo.type = "button";
      undo.textContent = translate("Undo");
      undo.addEventListener("click", () => undoToday(person));
      item.append(name, time, undo);
      return item;
    }),
  );
}

let confirmResolve = null;

function paintConfirm() {
  if (!confirmRequest || confirm.hidden) return;
  confirmTitle.textContent = translate(confirmRequest.title);
  confirmWho.hidden = !confirmRequest.name;
  confirmName.textContent = confirmRequest.name || "";
  confirmId.hidden = !confirmRequest.id;
  confirmId.textContent = confirmRequest.id || "";
  confirmDetail.hidden = !confirmRequest.detail;
  confirmDetail.textContent = translate(confirmRequest.detail || "");
  confirmOk.textContent = translate(confirmRequest.confirmLabel);
  confirmOk.hidden = confirmRequest.canConfirm === false;
  confirmCancel.textContent = translate(confirmRequest.canConfirm === false ? "Close" : "Cancel");
  confirmOk.className = confirmRequest.tone === "primary" ? "primary" : "danger";
  renderProfile(confirmRequest.fields, confirmProfileChips, confirmProfileFields);
}

function askConfirm(request) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    confirmRequest = request;
    confirm.hidden = false;
    paintConfirm();
    confirmCancel.focus();
  });
}

function closeConfirm(accepted) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmRequest = null;
  confirm.hidden = true;
  resolve(accepted);
}

async function undoToday(person) {
  if (typeof window.attendance.undoAttendance !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then undo.");
    return;
  }
  const accepted = await askConfirm({
    title: "Remove from today?",
    name: person.name,
    detail: lastState?.testMode ? "Remove this student from today's test attendance." : "Set this student's attendance to Absent on Bouty.",
    confirmLabel: "Remove",
  });
  if (!accepted) return;
  const result = await window.attendance.undoAttendance({ studentId: person.studentId, rowNumber: person.rowNumber, logRow: person.logRow });
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
}

function renderProfile(fields, chips = lastChips, lines = lastFields) {
  chips.replaceChildren();
  lines.replaceChildren();
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = translate(field.value);
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.dir = field.kind === "phone" ? "ltr" : "auto";
    dd.textContent = value;
    lines.append(dt, dd);
  }
  chips.hidden = chips.childElementCount === 0;
  lines.hidden = lines.childElementCount === 0;
}

function syncPhoneControls() {
  phoneNumber.disabled = phoneSaving;
  phoneSkip.disabled = phoneSaving;
  phoneSave.disabled = phoneSaving || !phoneNumber.value.trim();
}

function renderPhoneReminder(match) {
  const scan = match?.phoneMissing ? match.scanId : null;
  if (scan !== phoneScan) {
    phoneScan = scan;
    phoneSkipped = false;
    phoneSaving = false;
    phoneNumber.value = "";
    phoneError.hidden = true;
    syncPhoneControls();
  }
  phoneStudent.textContent = scan ? match.studentName : "";
  phoneWarning.hidden = !scan;
  phonePrompt.hidden = !scan || phoneSkipped;
  phoneWarning.setAttribute("aria-expanded", String(!phonePrompt.hidden));
}

phoneWarning.addEventListener("click", () => {
  phoneSkipped = false;
  renderPhoneReminder(lastState.lastMatch);
  phoneNumber.focus();
});
phoneSkip.addEventListener("click", () => {
  phoneSkipped = true;
  phoneNumber.value = "";
  phoneError.hidden = true;
  syncPhoneControls();
  renderPhoneReminder(lastState.lastMatch);
  phoneWarning.focus();
});
phoneNumber.addEventListener("input", syncPhoneControls);
phonePrompt.addEventListener("submit", async (event) => {
  event.preventDefault();
  const scan = phoneScan;
  if (!scan || phoneSaving || phoneSave.disabled) return;
  phoneSaving = true;
  phoneError.hidden = true;
  syncPhoneControls();
  const failed = "Could not save the phone number. Try again.";
  const result = await window.attendance.saveMissingPhone(scan, phoneNumber.value).catch(() => ({ error: failed }));
  if (phoneScan !== scan) return;
  phoneSaving = false;
  syncPhoneControls();
  if (!result?.ok) {
    phoneError.textContent = translate(result?.error || failed);
    phoneError.hidden = false;
    phoneNumber.focus();
  }
});

function render(state) {
  if (lastState && Boolean(lastState.testMode) !== Boolean(state.testMode)) {
    closeConfirm(false);
    closeManualPick();
    dashboardOpen = false;
    ++printsGen;
    ++filterGen;
    clearTimeout(searchTimer);
    list.replaceChildren();
    printsList.replaceChildren();
    search.value = "";
    printsSearch.value = "";
    todayKey = "";
  }
  lastState = state;
  renderPhoneReminder(state.lastMatch);
  // Keep the installed build visible even when settings was already open.
  const version = document.querySelector("#app-version");
  if (version) version.textContent = state.appVersion || state.update?.version || "—";
  const testing = Boolean(state.testMode);
  testModeSwitch.checked = testing;
  testModeSwitch.disabled = switchingTestMode;
  testModeIndicator.hidden = !testing;
  persistentSettings.disabled = testing;
  document.querySelector("#save").hidden = testing;
  cancel.textContent = translate(testing ? "Done" : "Cancel");
  renderUpdate(testing ? null : state.update);
  if (testing) updateDialog.hidden = true;
  const signedIn = Boolean(state.bouty?.enabled);
  document.querySelector("#bouty-sign-in").hidden = signedIn;
  document.querySelector("#sign-out-bouty").hidden = !signedIn;
  document.querySelector("#save-bouty").hidden = signedIn;
  document.querySelector("#bouty-advanced").hidden = !signedIn;
  document.querySelector("#bouty-status").textContent = translate(signedIn ? "Signed in to Bouty" : "Signed out of Bouty");
  const mode = screenForPhase(state.phase);
  const enteredPicker = mode === "pending" && !picker;
  const enteredConfig = mode === "config" && !configOpen;
  picker = mode === "pending";
  configOpen = mode === "config";
  const enteredPrints = mode === "prints" && !printsSeen;
  printsSeen = mode === "prints";
  linking = state.phase === "linking";
  show(mode);
  renderToday(state.present);
  renderDashboard(state.dashboard);
  if (dashboardOpen) return;
  if (mode === "ready") {
    headline.textContent = translate(state.headline || "Place a finger");
    detail.textContent = translate(state.detail || "Listening");
    const cue = fingerCue(state.trace);
    place.dataset.cue = cue;
    placeLabel.textContent = translate(PLACE_LABEL[cue]);
    renderTrace(state.trace);
    showFingers(fingerReady, printsReady, state.scanImages, state.scanImage);
    const enrollActions = document.querySelector("#enroll-actions");
    enrollActions.hidden = !state.enroll;
    document.querySelector("#enroll-done").textContent = state.enroll
      ? translate(`Done · ${state.enroll.count} scan${state.enroll.count === 1 ? "" : "s"}`)
      : translate("Done");
    if (state.lastMatch) {
      last.hidden = false;
      lastName.dir = "auto";
      lastName.textContent = state.lastMatch.studentName || state.lastMatch.studentId || translate("Student");
      const when = matchTime(state.lastMatch.at);
      lastMeta.replaceChildren();
      if (state.lastMatch.studentId) {
        const id = document.createElement("span");
        id.dir = "ltr";
        id.textContent = state.lastMatch.studentId;
        lastMeta.append(id);
      }
      if (state.lastMatch.studentId && when) lastMeta.append(document.createTextNode("  ·  "));
      if (when) {
        const time = document.createElement("span");
        time.dir = "ltr";
        time.textContent = when;
        lastMeta.append(time);
      }
      if (state.lastMatch.profileStatus) {
        if (lastMeta.childNodes.length) lastMeta.append(document.createTextNode("  ·  "));
        lastMeta.append(document.createTextNode(translate(state.lastMatch.profileStatus)));
      }
      renderProfile(state.lastMatch.fields);
    } else {
      last.hidden = true;
      renderProfile([]);
    }
  } else {
    showFingers(fingerReady, printsReady, [], "");
  }
  if (mode === "pending") {
    paintPendingGallery(state.scanImages, state.scanImage, linking);
    document.querySelector("#discard-scans").disabled = linking;
    listLoading = String(state.detail || "").startsWith("Loading");
    pendingDetail.textContent = translate(state.detail || "Choose who this print belongs to.");
    if (enteredPicker) {
      search.value = "";
      search.focus();
    }
    refreshList();
  } else {
    paintPendingGallery([], "", false);
  }
  if (mode === "config") {
    cancel.hidden = !state.canCloseSettings;
    if (enteredConfig) fillConfig(state);
    document.querySelector("#config-detail").textContent = translate(state.detail || "Bouty account and scanner.");
  }
  if (mode === "prints") {
    document.querySelector("#prints-detail").textContent = translate(state.detail || "Remove one student's fingerprints from this computer.");
    if (enteredPrints) {
      printsSearch.value = "";
      refreshPrints();
    }
  }
  error.hidden = !state.error;
  error.textContent = translate(state.error || "");
  sync.textContent = testing ? "" : translate(state.bouty?.message || "");
}

dashboard.addEventListener("click", async () => {
  dashboardOpen = true;
  if (!printsPage.hidden) await window.attendance.closePrints();
  show("ready");
});
dashboardClose.addEventListener("click", () => {
  dashboardOpen = false;
  show("ready");
});
attendance.addEventListener("click", () => {
  const settingsOpen = !config.hidden;
  const printsOpen = !printsPage.hidden;
  dashboardOpen = false;
  if (settingsOpen) {
    show("config");
    window.attendance.closeSettings();
    return;
  }
  if (printsOpen) {
    show("prints");
    window.attendance.closePrints();
    return;
  }
  show(screenForPhase(lastState?.phase));
});
printsNav.addEventListener("click", () => {
  if (!printsPage.hidden) return;
  dashboardOpen = false;
  window.attendance.openPrints();
});

let searchTimer;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  filterGen += 1;
  list.replaceChildren();
  empty.hidden = false;
  empty.textContent = translate("Searching Bouty…");
  searchTimer = setTimeout(() => refreshList(), 350);
});
search.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const first = list.querySelector("button");
  if (first && !first.disabled) first.click();
});
async function dropKeptScans() {
  if (typeof window.attendance.discardScans !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then cancel.");
    return;
  }
  const accepted = await askConfirm({
    title: "Drop these scans?",
    detail: "These scans are dropped. No student is saved.",
    confirmLabel: "Drop scans",
  });
  if (!accepted) return;
  const result = await window.attendance.discardScans();
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
}

document.querySelector("#discard-scans").addEventListener("click", dropKeptScans);
document.querySelector("#enroll-cancel").addEventListener("click", dropKeptScans);
document.querySelector("#more-scans").addEventListener("click", async () => {
  if (typeof window.attendance.addMoreScans !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then add more scans.");
    return;
  }
  const button = document.querySelector("#more-scans");
  button.disabled = true;
  try {
    const result = await window.attendance.addMoreScans();
    if (!result?.ok && result?.error) {
      error.hidden = false;
      error.textContent = translate(result.error);
    }
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#enroll-done").addEventListener("click", () => window.attendance.finishEnroll());
settings.addEventListener("click", () => {
  if (!config.hidden) return;
  dashboardOpen = false;
  window.attendance.openSettings();
});

function renderPrints(students) {
  printsList.replaceChildren();
  const query = printsSearch.value.trim();
  printsEmpty.hidden = students.length !== 0;
  printsEmpty.textContent = translate(query ? "No matching students" : "No fingerprints stored");
  for (const student of students) {
    const item = document.createElement("li");
    const person = document.createElement("div");
    person.className = "print-person";
    const name = document.createElement("span");
    name.dir = "auto";
    name.textContent = student.studentName || student.studentId || translate("Student");
    const sub = document.createElement("span");
    sub.className = "sub";
    const bits = [];
    if (student.studentId && student.studentId !== student.studentName) bits.push(student.studentId);
    const count = Number(student.count) || 0;
    if (count > 0) bits.push(translate(count === 1 ? "1 print" : `${count} prints`));
    sub.textContent = bits.join(" · ");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "danger";
    button.disabled = deletingPrints;
    button.textContent = translate("Delete");
    button.addEventListener("click", () => removePrints(student));
    person.append(name, sub, button);
    item.append(person);
    printsList.append(item);
  }
}

async function refreshPrints() {
  if (typeof window.attendance.listPrints !== "function") return;
  const gen = ++printsGen;
  const students = await window.attendance.listPrints(printsSearch.value);
  if (gen !== printsGen || printsPage.hidden) return;
  renderPrints(Array.isArray(students) ? students : []);
}

async function removePrints(student) {
  if (deletingPrints) return;
  if (typeof window.attendance.deleteStudentPrints !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then delete the fingerprints.");
    return;
  }
  const accepted = await askConfirm({
    title: "Delete this student's fingerprints?",
    name: student.studentName || student.studentId,
    detail: "Remove this student's saved fingerprints from this computer.",
    confirmLabel: "Delete fingerprints",
  });
  if (!accepted) return;
  deletingPrints = true;
  for (const button of printsList.querySelectorAll("button")) button.disabled = true;
  try {
    const result = await window.attendance.deleteStudentPrints(student.key);
    if (!result?.ok && result?.error) {
      error.hidden = false;
      error.textContent = translate(result.error);
    } else {
      error.hidden = true;
    }
  } finally {
    deletingPrints = false;
    await refreshPrints();
  }
}

printsSearch.addEventListener("input", () => {
  refreshPrints();
});
update.addEventListener("click", async () => {
  update.disabled = true;
  try {
    const result = await window.attendance.updateAction();
    if (!result?.ok && result?.error) {
      error.hidden = false;
      error.textContent = translate(result.error);
    }
  } catch (err) {
    error.hidden = false;
    error.textContent = translate("Update check failed.");
  } finally {
    update.disabled = false;
  }
});
updateDialogAction.addEventListener("click", async () => {
  updateDialogAction.disabled = true;
  await window.attendance.updateAction();
  updateDialogAction.disabled = false;
});
updateDialogClose.addEventListener("click", () => { updateDialog.hidden = true; });
cancel.addEventListener("click", () => window.attendance.closeSettings());
testModeProgress.addEventListener("cancel", (event) => event.preventDefault());
testModeSwitch.addEventListener("change", async () => {
  const enabled = testModeSwitch.checked;
  testModeSwitch.checked = Boolean(lastState?.testMode);
  switchingTestMode = true;
  testModeSwitch.disabled = true;
  testModeProgress.showModal();
  try {
    const result = await window.attendance.setTestMode(enabled);
    if (!result?.ok) {
      error.hidden = false;
      error.textContent = translate(result?.error || "Could not change test mode.");
    }
  } catch {
    error.hidden = false;
    error.textContent = translate("Could not change test mode.");
  } finally {
    testModeProgress.close();
    switchingTestMode = false;
    testModeSwitch.disabled = false;
    testModeSwitch.checked = Boolean(lastState?.testMode);
  }
});
document.querySelector("#clear-prints").addEventListener("click", async () => {
  const button = document.querySelector("#clear-prints");
  if (typeof window.attendance.clearFingerprints !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then delete the fingerprints.");
    return;
  }
  const accepted = await askConfirm({
    title: "Delete all fingerprints?",
    detail: "Remove all saved fingerprints from this computer.",
    confirmLabel: "Delete fingerprints",
  });
  if (!accepted) return;
  button.disabled = true;
  try {
    const result = await window.attendance.clearFingerprints();
    if (!result?.ok && result?.error) {
      error.hidden = false;
      error.textContent = translate(result.error);
    }
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#save").addEventListener("click", async () => {
  const save = document.querySelector("#save");
  save.disabled = true;
  const result = await window.attendance.saveConfig({
    zk4500Cli: document.querySelector("#cfg-exe").value,
    updateChannel: document.querySelector('[data-track][aria-pressed="true"]')?.dataset.track || "stable",
  });
  save.disabled = false;
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
});
for (const button of document.querySelectorAll("[data-track]")) button.addEventListener("click", () => {
  for (const candidate of document.querySelectorAll("[data-track]")) candidate.setAttribute("aria-pressed", String(candidate === button));
});
async function saveBouty(event) {
  const button = event.currentTarget;
  const settings = readBoutySettings();
  if (settings === null) return;
  button.disabled = true;
  try {
    const result = await window.attendance.saveBouty({ username: document.querySelector("#bouty-user").value,
      password: document.querySelector("#bouty-password").value, settings });
    if (!result?.ok) { error.hidden = false; error.textContent = translate(result?.error || "Bouty settings could not be saved."); }
    else { document.querySelector("#bouty-password").value = ""; error.hidden = true; }
  } finally { button.disabled = false; }
}
document.querySelector("#save-bouty").addEventListener("click", saveBouty);
document.querySelector("#save-bouty-advanced").addEventListener("click", saveBouty);
document.querySelector("#sign-out-bouty").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await window.attendance.signOutBouty();
    if (!result?.ok) {
      error.hidden = false;
      error.textContent = translate(result?.error || "Bouty could not sign out.");
    } else {
      document.querySelector("#bouty-user").value = "";
      document.querySelector("#bouty-password").value = "";
    }
  } finally { button.disabled = false; }
});
for (const button of document.querySelectorAll("[data-pick]")) {
  button.addEventListener("click", async () => {
    const picked = await window.attendance.pickFile(button.dataset.pick);
    if (picked) document.querySelector(`#${button.dataset.target}`).value = picked;
  });
}

confirmCancel.addEventListener("click", () => closeConfirm(false));
confirmOk.addEventListener("click", () => closeConfirm(true));
confirm.addEventListener("click", (event) => {
  if (event.target === confirm) closeConfirm(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || confirm.hidden) return;
  event.preventDefault();
  closeConfirm(false);
});

function chooseLang(lang) {
  setLang(lang);
  todayKey = "";
  paintConfirm();
  if (!printsPage.hidden) refreshPrints();
  if (lastState) render(lastState);
}

function renderManualList(students) {
  manualList.replaceChildren();
  for (const student of students) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("span");
    name.dir = "auto";
    name.textContent = student.studentName || student.studentId || translate("Student");
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.dir = "ltr";
    const identifier = student.studentNumber;
    sub.textContent = identifier && identifier !== student.studentName ? identifier : "";
    button.append(name, sub);
    button.addEventListener("click", () => openBoutyProfile(student));
    item.append(button);
    manualList.append(item);
  }
}

async function refreshManual(refresh = false) {
  clearTimeout(manualSearchTimer);
  const gen = ++manualGen;
  boutyRosterActions.hidden = false;
  manualList.replaceChildren();
  manualEmpty.hidden = false;
  manualEmpty.textContent = translate("Searching Bouty…");
  boutyRosterPrev.disabled = true;
  boutyRosterNext.disabled = true;
  boutyRosterRefresh.disabled = true;
  const result = await window.attendance.boutyRoster({ query: manualSearch.value, page: boutyRosterPage, refresh });
  if (gen !== manualGen || manualPick.hidden) return;
  const students = result?.students || [];
  const problem = result?.error || "";
  manualEmpty.hidden = students.length !== 0 && !problem && !result?.notice;
  manualEmpty.textContent = translate(problem || result?.notice || "No matching students");
  renderManualList(problem ? [] : students);
  boutyRosterPrev.disabled = boutyRosterPage <= 1;
  boutyRosterNext.disabled = !result?.hasNext;
  boutyRosterRefresh.disabled = false;
}

async function openBoutyProfile(student) {
  const gen = ++manualGen;
  for (const button of manualList.querySelectorAll("button")) button.disabled = true;
  manualEmpty.hidden = false;
  manualEmpty.textContent = translate("Loading Bouty student information…");
  const profile = await window.attendance.boutyStudent(student);
  if (gen !== manualGen || manualPick.hidden) return;
  for (const button of manualList.querySelectorAll("button")) button.disabled = false;
  manualEmpty.hidden = !profile.error;
  manualEmpty.textContent = translate(profile.error || "");
  if (!profile.error) await confirmManual(profile);
}

async function confirmManual(student) {
  const accepted = await askConfirm({
    title: "Student details",
    name: student.studentName || "",
    id: String(student.studentNumber || student.id || ""),
    fields: student.fields,
    canConfirm: Boolean(student.studentId),
    confirmLabel: "Mark present",
    tone: "primary",
  });
  if (!accepted) return;
  closeManualPick();
  const result = await window.attendance.markPresent({
    studentId: student.studentId,
    studentName: student.studentName,
    rowNumber: student.rowNumber,
    fields: student.fields,
  });
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
}

markManual.addEventListener("click", () => {
  manualPick.hidden = !manualPick.hidden;
  if (manualPick.hidden) {
    closeManualPick();
    return;
  }
  manualSearch.focus();
  refreshManual();
});
manualSearch.addEventListener("input", () => {
  manualPick.hidden = false;
  boutyRosterPage = 1;
  manualGen += 1;
  manualList.replaceChildren();
  boutyRosterPrev.disabled = true;
  boutyRosterNext.disabled = true;
  clearTimeout(manualSearchTimer);
  manualSearchTimer = setTimeout(refreshManual, 350);
});
boutyRosterPrev.addEventListener("click", () => { boutyRosterPage -= 1; void refreshManual(); });
boutyRosterNext.addEventListener("click", () => { boutyRosterPage += 1; void refreshManual(); });
boutyRosterRefresh.addEventListener("click", () => { boutyRosterPage = 1; void refreshManual(true); });

for (const button of document.querySelectorAll("[data-lang]")) {
  button.addEventListener("click", () => chooseLang(button.dataset.lang));
}

for (const button of document.querySelectorAll("[data-font]")) {
  button.addEventListener("click", () => setFont(button.dataset.font));
}

applyDom();
window.attendance.onState(render);
window.attendance.getState().then(render);

