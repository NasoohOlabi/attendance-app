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
const cancel = document.querySelector("#cancel");
const confirm = document.querySelector("#confirm");
const confirmTitle = document.querySelector("#confirm-title");
const confirmWho = document.querySelector("#confirm-who");
const confirmName = document.querySelector("#confirm-name");
const confirmDetail = document.querySelector("#confirm-detail");
const confirmCancel = document.querySelector("#confirm-cancel");
const confirmOk = document.querySelector("#confirm-ok");

let picker = false;
let configOpen = false;
let filterGen = 0;
let linking = false;
let batchAssign = false;
let listLoading = false;
let lastState = null;
let confirmRequest = null;

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

function show(name) {
  ready.hidden = name !== "ready";
  pending.hidden = name !== "pending";
  config.hidden = name !== "config";
  settings.hidden = name === "config" || linking;
  ready.classList.toggle("ready", name === "ready");
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
    if (student.hasPrint) bits.push(translate(batchAssign ? "add scans" : "replace"));
    sub.textContent = bits.join(" · ");
    button.append(name, sub);
    button.addEventListener("click", () => choose(student.key));
    item.append(button);
    list.append(item);
  }
}

async function refreshList() {
  const gen = ++filterGen;
  const students = await window.attendance.filter(search.value);
  if (gen !== filterGen) return;
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

function fillConfig(state) {
  const cfg = state.config || {};
  document.querySelector("#cfg-key").value = cfg.serviceAccountJson || "";
  document.querySelector("#cfg-sheet").value = cfg.spreadsheetId || "";
  document.querySelector("#cfg-gid").value = cfg.sheetGid ?? "";
  document.querySelector("#cfg-exe").value = cfg.zk4500Cli || "";
  document.querySelector("#cfg-dir").textContent = state.fingerprintDir || cfg.fingerprintDir || "";
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
  if (typeof item === "string") return { name: item, rowNumber: 0, time: "", logRow: 0 };
  return {
    name: item?.name || "",
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
  todayEmpty.textContent = translate(known ? "No one yet" : "Loading the sheet");
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
      const time = document.createElement("input");
      time.className = "today-time";
      time.type = "time";
      time.value = person.time;
      time.dir = "ltr";
      time.setAttribute("aria-label", translate(`Time for ${person.name}`));
      time.addEventListener("change", () => saveTodayTime(person, time));
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
  confirmDetail.textContent = translate(confirmRequest.detail);
  confirmOk.textContent = translate(confirmRequest.confirmLabel);
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
    detail: "Today's cell is cleared. The time logged for today is removed. Other days stay.",
    confirmLabel: "Remove",
  });
  if (!accepted) return;
  const result = await window.attendance.undoAttendance({ rowNumber: person.rowNumber, logRow: person.logRow });
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
}

async function saveTodayTime(person, input) {
  if (!input.value || input.value === person.time) return;
  if (typeof window.attendance.setAttendanceTime !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then change the time.");
    input.value = person.time;
    return;
  }
  const result = await window.attendance.setAttendanceTime({
    rowNumber: person.rowNumber,
    logRow: person.logRow,
    time: input.value,
  });
  if (!result?.ok) {
    input.value = person.time;
    if (result?.error) {
      error.hidden = false;
      error.textContent = translate(result.error);
    }
  }
}

function renderProfile(fields) {
  lastChips.replaceChildren();
  lastFields.replaceChildren();
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = translate(field.value);
    if (field.kind === "phone" || field.kind === "line") {
      const dt = document.createElement("dt");
      dt.textContent = field.label;
      const dd = document.createElement("dd");
      dd.dir = field.kind === "phone" ? "ltr" : "auto";
      dd.textContent = value;
      lastFields.append(dt, dd);
      continue;
    }
    const chip = document.createElement("span");
    if (field.kind === "meter") chip.className = "is-meter";
    else if (field.kind === "flag") chip.className = field.value === "No" ? "is-off" : "is-flag";
    chip.title = field.label;
    if (field.kind !== "meter") {
      const label = document.createElement("small");
      label.textContent = field.label;
      chip.append(label);
    }
    chip.append(document.createTextNode(value));
    lastChips.append(chip);
  }
  lastChips.hidden = lastChips.childElementCount === 0;
  lastFields.hidden = lastFields.childElementCount === 0;
}

function render(state) {
  lastState = state;
  const mode = screenForPhase(state.phase);
  const enteredPicker = mode === "pending" && !picker;
  const enteredConfig = mode === "config" && !configOpen;
  picker = mode === "pending";
  configOpen = mode === "config";
  linking = state.phase === "linking";
  batchAssign = Boolean(state.enroll?.count);
  show(mode);
  renderToday(state.present);
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
    document.querySelector("#config-detail").textContent = translate(state.detail || "");
    cancel.hidden = !state.canCloseSettings;
    if (enteredConfig) fillConfig(state);
  }
  error.hidden = !state.error;
  error.textContent = translate(state.error || "");
  sync.textContent = translate(state.syncNote || "");
}

search.addEventListener("input", () => refreshList());
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
settings.addEventListener("click", () => window.attendance.openSettings());
cancel.addEventListener("click", () => window.attendance.closeSettings());
document.querySelector("#clear-prints").addEventListener("click", async () => {
  const button = document.querySelector("#clear-prints");
  if (typeof window.attendance.clearFingerprints !== "function") {
    error.hidden = false;
    error.textContent = translate("Close the app and open it again, then delete the fingerprints.");
    return;
  }
  const accepted = await askConfirm({
    title: "Delete all fingerprints?",
    detail: "Prints on this computer and on the fingerprints sheet are removed. The attendance sheet is not changed.",
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
    serviceAccountJson: document.querySelector("#cfg-key").value,
    spreadsheetId: document.querySelector("#cfg-sheet").value,
    sheetGid: document.querySelector("#cfg-gid").value,
    zk4500Cli: document.querySelector("#cfg-exe").value,
  });
  save.disabled = false;
  if (!result?.ok && result?.error) {
    error.hidden = false;
    error.textContent = translate(result.error);
  }
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
  if (lastState) render(lastState);
}

for (const button of document.querySelectorAll("[data-lang]")) {
  button.addEventListener("click", () => chooseLang(button.dataset.lang));
}

for (const button of document.querySelectorAll("[data-font]")) {
  button.addEventListener("click", () => setFont(button.dataset.font));
}

applyDom();
window.attendance.onState(render);
window.attendance.getState().then(render);
