import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { legacyUserDataPath, LEGACY_USER_DATA_DIR, loadConfig, requireGoogleConfig } from "../src/config.mjs";
import { appendAppLog, appLogFile, appLogLine } from "../src/log.mjs";
import { attendanceCellUpdate, createGoogle, explainApiFailure, isOfflineError } from "../src/google.mjs";
import { translate } from "../src/renderer/i18n.js";
import { fingerCue, presentTrace, screenForPhase } from "../src/renderer/view.js";
import { appendScanTrace, beginScanAttempt, captureKillDelay, formatCommand, identifyArgs, interpretIdentify, interpretScan, mergeCapturedFiles, nextCapture, planScanRetry, scanArgs, SCAN_OUTAGE_MESSAGE, SCAN_RETRY_PAUSE_MS } from "../src/scan.mjs";
import {
  buildRoster,
  clearFingerprints,
  decidePrint,
  dateHeaderText,
  findDateColumn,
  fuzzyStudents,
  loadIndex,
  logPath,
  mergeStudents,
  parseAttendanceGrid,
  presentToday,
  planClearRow,
  attachLogTimes,
  withScanTimes,
  clocksFromAppLog,
  stampFromClock,
  nextSampleFile,
  planBatchFiles,
  pendingPath,
  studentByTemplateSid,
  attendanceLogRow,
  attendanceStamp,
  canonicalStudentId,
  catalogDue,
  CATALOG_REFRESH_MS,
  fingerprintFiles,
  fingerprintHeaderMissing,
  fingerprintSheetRow,
  FINGERPRINT_HEADER,
  overlayPresent,
  planAttendance,
  queueAbsent,
  queueClock,
  queuePresent,
  bestCandidate,
  captureScreen,
  PARTIAL_THRESHOLD,
  planDateColumn,
  sheetsSerial,
  shiftColumnFormula,
  putStudent,
  saveIndex,
  templateFileForStudent,
  templatePath,
} from "../src/store.mjs";

test("a capture cycle records started, exited, and the next capture", () => {
  let lines = [];
  lines = appendScanTrace(lines, { type: "started", command: "identify", timeoutSeconds: 20 });
  lines = appendScanTrace(lines, { type: "waiting", elapsedSeconds: 1 });
  lines = appendScanTrace(lines, { type: "waiting", elapsedSeconds: 2 });
  lines = appendScanTrace(lines, { type: "exited", exitCode: 2, timedOut: true, elapsedSeconds: 20 });
  lines = appendScanTrace(lines, { type: "next" });
  assert.deepEqual(lines, [
    "Capture started · identify · 20s",
    "Waiting for a finger · 2s",
    "No finger · 20s",
    "Next capture scheduled",
  ]);
  const killed = appendScanTrace(
    appendScanTrace([], { type: "started", command: "identify", timeoutSeconds: 20 }),
    { type: "killed", elapsedSeconds: 25 },
  );
  assert.equal(appendScanTrace(killed, { type: "next" }).at(-1), "Next capture scheduled");
  assert.match(killed[1], /Stopped a capture/);
});

test("a detected finger is not sent back to waiting and is not killed at the idle timeout", () => {
  let lines = appendScanTrace([], { type: "waiting", elapsedSeconds: 1 });
  lines = appendScanTrace(lines, { type: "ready" });
  lines = appendScanTrace(lines, { type: "waiting", elapsedSeconds: 2 });
  lines = appendScanTrace(lines, { type: "finger" });
  const held = appendScanTrace(lines, { type: "waiting", elapsedSeconds: 6, fingerDown: true });
  assert.deepEqual(held, lines);
  assert.equal(held.at(-1), "Finger detected");
  const idle = captureKillDelay({ elapsedMs: 25000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(idle.kill, false);
  const hungPastBothWindows = captureKillDelay({ elapsedMs: 45000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(hungPastBothWindows.kill, true);
  const live = captureKillDelay({ elapsedMs: 25000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(live.kill, false);
  const quiet = nextCapture({ exited: true, exitCode: 2, timedOut: true, elapsedMs: 24000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(quiet.scheduleNext, true);
  assert.equal(quiet.loopEnded, false);
});

test("a failed or timed-out capture schedules another and the loop continues", () => {
  const failed = nextCapture({ exited: true, exitCode: 1, elapsedMs: 200, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(failed.scheduleNext, true);
  assert.equal(failed.loopEnded, false);
  assert.equal(failed.showError, false);
  const timed = nextCapture({ exited: true, exitCode: 2, timedOut: true, elapsedMs: 20000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(timed.scheduleNext, true);
  assert.equal(timed.loopEnded, false);
  assert.equal(timed.showError, false);
  const stillCapturing = nextCapture({ exited: false, elapsedMs: 25000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(stillCapturing.killChild, false);
  const hung = nextCapture({ exited: false, elapsedMs: 45000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(hung.killChild, true);
  assert.equal(hung.scheduleNext, true);
  assert.equal(hung.loopEnded, false);
  const waiting = nextCapture({ exited: false, elapsedMs: 1000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(waiting.scheduleNext, false);
  assert.equal(waiting.loopEnded, false);
});

test("a saved print survives exit 1, and an empty miss waits before the next capture", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-print-"));
  const image = path.join(dir, "scan.jpg");
  const template = path.join(dir, "template.txt");
  await writeFile(image, "jpg");
  await writeFile(template, "template-body");
  const stdout = `finger=detected\r\ncapture_success=True\r\nimage=${image}\r\ntemplate=${template}\r\nmatch_found=False\r\nmatch_score=3\r\nmatch_threshold=8\r\n`;
  const result = mergeCapturedFiles(interpretIdentify(stdout, 1), [image, template]);
  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  const view = captureScreen([], result);
  assert.equal(view.imagePath, image);
  assert.equal(view.picker, true);
  assert.equal(view.attendance, false);
  const kept = planScanRetry({ ok: result.ok, exitCode: 1 });
  assert.equal(kept.retryNow, false);
  assert.equal(kept.pauseMs, 0);
  const fromDisk = mergeCapturedFiles(
    { ok: false, exitCode: 1, timedOut: false, parsed: { capture_success: "True" } },
    [image, template],
  );
  assert.equal(fromDisk.ok, true);
  assert.equal(fromDisk.imagePath, image);
  const idle = planScanRetry({ ok: false, timedOut: true, exitCode: 2 });
  assert.equal(idle.retryNow, false);
  assert.equal(idle.showError, false);
  assert.equal(idle.pauseMs, SCAN_RETRY_PAUSE_MS);
  const later = nextCapture({ exited: true, exitCode: 2, timedOut: true, elapsedMs: 20000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(later.scheduleNext, true);
  assert.equal(later.immediate, false);
  assert.equal(later.pauseMs, SCAN_RETRY_PAUSE_MS);
  const live = captureKillDelay({ elapsedMs: 25000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(live.kill, false);
  const fingerHeld = nextCapture({ exited: false, fingerDetected: true, fingerAtMs: 2000, elapsedMs: 25000, timeoutMs: 20000, graceMs: 5000 });
  assert.equal(fingerHeld.killChild, false);
  assert.equal(fingerHeld.scheduleNext, false);
  await rm(dir, { recursive: true, force: true });
});

test("an empty exit 1 waits and stays quiet", () => {
  const once = planScanRetry({ ok: false, exitCode: 1, streak: 0 });
  assert.equal(once.retryNow, false);
  assert.equal(once.pauseMs, SCAN_RETRY_PAUSE_MS);
  assert.equal(once.keepListening, true);
  assert.equal(once.showError, false);
  assert.equal(once.message, "");
  const next = beginScanAttempt(once);
  assert.equal(next.showError, false);
  const timeout = planScanRetry({ ok: false, timedOut: true, exitCode: 2, streak: 4 });
  assert.equal(timeout.showError, false);
  assert.equal(timeout.streak, 0);
  assert.equal(SCAN_OUTAGE_MESSAGE.includes("exit"), false);
});

const GRID = [
  ["إسم كامل", "معرف", "Sat 13/6", "Mon 15/6", "Wed 17/6", "Sat 4/7", "Wed 25/6", "28/6"],
  ["", "", "102", "68", "57", "1", "0", "26"],
  ["اسم أول", "00 00 000 001"],
  ["اسم ثان", "00 00 000 002"],
  ["اسم ثالث", "00 00 000 003"],
];

test("attendance grid reads the name and the Marif id", () => {
  const grid = parseAttendanceGrid(GRID);
  assert.equal(grid.headerRowNumber, 1);
  assert.equal(grid.summaryRowNumber, 2);
  assert.equal(grid.idColumn, 1);
  assert.deepEqual(
    grid.students.map((student) => student.studentName),
    ["اسم أول", "اسم ثان", "اسم ثالث"],
  );
  assert.equal(grid.students[0].studentId, "00 00 000 001");
  assert.equal(grid.students[0].rowNumber, 3);
  assert.deepEqual(grid.duplicates, []);
  assert.equal(canonicalStudentId("  00  00 000 001 "), "00 00 000 001");
  assert.equal(canonicalStudentId("اسم"), "");
});

test("today's tally is the حاضر names in today's column", () => {
  const rows = [
    ["إسم كامل", "معرف", "Sat 3/10", "Mon 5/10"],
    ["", "", "2", "0"],
    ["اسم أول", "00 00 000 001", "حاضر", ""],
    ["اسم ثان", "00 00 000 002", "", "حاضر"],
    ["اسم رابع", "00 00 000 003", true, ""],
    ["اسم ثالث", "00 00 000 004", "FALSE", ""],
    ["اسم أول", "00 00 000 005", "حاضر", ""],
  ];
  assert.deepEqual(presentToday(rows, new Date(2026, 9, 3)), [
    { name: "اسم أول", studentId: "00 00 000 001", rowNumber: 3 },
    { name: "اسم رابع", studentId: "00 00 000 003", rowNumber: 5 },
    { name: "اسم أول", studentId: "00 00 000 005", rowNumber: 7 },
  ]);
  assert.deepEqual(presentToday(rows, new Date(2026, 9, 5)), [
    { name: "اسم ثان", studentId: "00 00 000 002", rowNumber: 4 },
  ]);
  assert.equal(planClearRow(rows, 7, new Date(2026, 9, 3)).a1, "C7");
  const log = [
    ["الطالب", "حضور"],
    ["00 00 000 001", "3/10/2026 09:00:00"],
    ["00 00 000 002", "5/10/2026 09:00:00"],
    ["00 00 000 005", "3/10/2026 16:55:03"],
  ];
  assert.deepEqual(attachLogTimes(presentToday(rows, new Date(2026, 9, 3)), log, new Date(2026, 9, 3)), [
    { name: "اسم أول", studentId: "00 00 000 001", rowNumber: 3, time: "09:00", logRow: 2 },
    { name: "اسم رابع", studentId: "00 00 000 003", rowNumber: 5, time: "", logRow: 0 },
    { name: "اسم أول", studentId: "00 00 000 005", rowNumber: 7, time: "16:55", logRow: 4 },
  ]);
  assert.equal(stampFromClock(new Date("2026-10-03T13:55:03Z"), "9:05"), "3/10/2026 09:05:00");
  assert.equal(stampFromClock(new Date("2026-10-03T13:55:03Z"), "25:00"), "");
  const people = presentToday(rows, new Date(2026, 9, 3)).map((item) => ({ ...item, time: "", logRow: 0 }));
  assert.equal(withScanTimes(people, { 5: "18:09" })[1].time, "18:09");
  assert.equal(
    withScanTimes(people, {}, clocksFromAppLog("2026-10-03 18:10:05 info linked اسم خامس file=s-خامس.txt\n2026-10-03 18:09:51 info matched اسم رابع")).find((item) => item.rowNumber === 5).time,
    "18:09",
  );
  assert.equal(withScanTimes(people, {}, { "اسم أول": "09:00" }).filter((item) => item.name === "اسم أول").every((item) => item.time === ""), true);
});

test("date headers resolve to a column, including a bare day/month", () => {
  const saturday = findDateColumn(GRID[0], new Date(2026, 6, 4));
  assert.equal(saturday.columnIndex, 5);
  assert.equal(saturday.header, "Sat 4/7");
  const bare = findDateColumn(GRID[0], new Date(2026, 5, 28));
  assert.equal(bare.header, "28/6");
  assert.equal(findDateColumn(GRID[0], new Date(2026, 9, 3)), null);
});

test("attendance mark patches only the one date cell", () => {
  const present = planAttendance(GRID, "00 00 000 001", new Date(2026, 6, 4), true);
  assert.equal(present.op, "update");
  assert.equal(present.a1, "F3");
  assert.equal(present.value, "حاضر");
  assert.deepEqual(present.values, [["حاضر"]]);
  assert.equal(present.row, undefined);

  const absent = planAttendance(GRID, "00 00 000 002", new Date(2026, 6, 4), false);
  assert.equal(absent.op, "update");
  assert.equal(absent.a1, "F4");
  assert.deepEqual(absent.values, [[""]]);

  const applied = GRID.map((row) => row.slice());
  applied[present.rowNumber - 1][present.columnIndex] = present.value;
  assert.equal(applied.length, GRID.length);
  assert.equal(applied[0][0], "إسم كامل");
  assert.equal(applied[1][2], "102");
  assert.equal(applied[2][5], "حاضر");
  assert.equal(applied[2][0], "اسم أول");
  assert.equal(applied[3][5], undefined);
});

test("a missing date column is inserted beside the latest earlier day, then one cell is marked", () => {
  const header = ["إسم كامل", "معرف", "Sat 13/6", "Sat 4/7", "Wed 25/6"];
  const formulas = ["", "", "=COUNTA(C3:C)", "=COUNTA(D3:D)", "=COUNTA(E3:E)"];
  const serials = [null, null, 46186, 46207, 45833];
  const rows = [header, ["", "", "102", "1", "0"], ["اسم أول", "00 00 000 001"]];
  const today = new Date(2026, 9, 3);
  const layout = { formulas, serials };
  const plan = planAttendance(rows, "00 00 000 001", today, true, layout);
  const inserted = planDateColumn(header, formulas, serials, today);
  assert.equal(dateHeaderText(today), "Sat 3/10");
  assert.equal(sheetsSerial(new Date(2026, 5, 13)), 46186);
  assert.equal(inserted.op, "insert");
  assert.equal(inserted.insertIndex, 4);
  assert.equal(inserted.header, "Sat 3/10");
  assert.equal(inserted.sourceFormula, "=COUNTA(D3:D)");
  assert.equal(inserted.formula, "=COUNTA(E3:E)");
  assert.equal(shiftColumnFormula("=COUNTA(Q3:Q)", 16, 17), "=COUNTA(R3:R)");
  assert.equal(plan.op, "update");
  assert.equal(plan.a1, "E3");
  assert.deepEqual(plan.values, [["حاضر"]]);
  assert.equal(plan.values[0].length, 1);
  assert.equal(plan.insert.formula, "=COUNTA(E3:E)");

  const existing = planAttendance(rows, "00 00 000 001", new Date(2026, 6, 4), true, layout);
  assert.equal(existing.insert, undefined);
  assert.equal(existing.a1, "D3");
  assert.deepEqual(existing.values, [["حاضر"]]);

  const oldSheet = [
    ["capture_id", "person_id", "person_name"],
    ["c1", "p1", "Nasoum"],
  ];
  const blocked = planAttendance(oldSheet, "Nasoum", today, true, layout);
  assert.equal(blocked.op, "missing-id");
  assert.equal(blocked.values, undefined);
  assert.equal(blocked.insert, undefined);
});

test("the same Marif id writes nothing, and the same name with two ids is fine", () => {
  const rows = [
    ["إسم كامل", "معرف", "الإسم", "كنية", "Sat 4/7"],
    ["", "", "", "", "0"],
    ["اسم سادس", "00 00 000 066", "جزء", "أول"],
    ["اسم سادس", "00 00 000 296", "جزء", "أول"],
    ["اسم سابع", "00 00 000 140", "جزء", "ثان"],
    ["اسم سابع", "00 00 000 140", "جزء", "ثان"],
    ["", "00 00 000 196", "اسم", "ثامن"],
    ["بدون", "", "", ""],
  ];
  const grid = parseAttendanceGrid(rows);
  assert.deepEqual(
    grid.students.map((student) => [student.studentName, student.studentId, student.rowNumber]),
    [
      ["اسم سادس", "00 00 000 066", 3],
      ["اسم سادس", "00 00 000 296", 4],
      ["اسم سابع", "00 00 000 140", 5],
      ["اسم سابع", "00 00 000 140", 6],
      ["اسم ثامن", "00 00 000 196", 7],
    ],
  );
  assert.deepEqual(grid.duplicates, ["00 00 000 140"]);
  const day = new Date(2026, 6, 4);
  const first = planAttendance(rows, "00 00 000 066", day, true);
  const second = planAttendance(rows, "00 00 000 296", day, true);
  assert.equal(first.op, "update");
  assert.equal(first.a1, "E3");
  assert.equal(second.op, "update");
  assert.equal(second.a1, "E4");
  assert.equal(second.value, "حاضر");
  const dup = planAttendance(rows, "00 00 000 140", day, true);
  assert.equal(dup.op, "duplicate");
  assert.equal(dup.values, undefined);
  assert.equal(planAttendance(rows, "", day, true).op, "missing-id");
  assert.equal(planAttendance(rows, "00 00 000 999", day, true).op, "missing-student");
  const merged = mergeStudents({ students: {}, pending: null }, rows);
  assert.equal(merged.students["00 00 000 140"], undefined);
  assert.equal(merged.students["00 00 000 066"].studentName, "اسم سادس");
  assert.equal(merged.students["00 00 000 296"].studentName, "اسم سادس");
});

test("mergeStudents keeps the local template and does not read template cells from the sheet", () => {
  const merged = mergeStudents(
    {
      students: {
        "00 00 000 002": {
          studentId: "00 00 000 002",
          studentName: "اسم ثان",
          templateFile: "s-00-00-000-002.txt",
          capturedAt: "",
        },
      },
      pending: null,
    },
    [
      ["إسم كامل", "معرف", "Sat 4/7", "template_file"],
      ["", "", "1", "9"],
      ["اسم ثان", "00 00 000 002", "", "s-from-sheet.txt"],
      ["اسم ثان", "00 00 000 009", "", "s-other.txt"],
      [""],
    ],
  );
  assert.equal(merged.students["00 00 000 002"].templateFile, "s-00-00-000-002.txt");
  assert.equal(merged.students["00 00 000 009"].studentName, "اسم ثان");
  assert.equal(merged.duplicates.length, 0);
});

test("filename uses student id, otherwise a sanitized name", () => {
  assert.equal(templateFileForStudent({ studentId: "15", studentName: "Nasoum Ali" }), "s-15.txt");
  assert.equal(templateFileForStudent({ studentId: "00 00 000 001", studentName: "اسم أول" }), "s-00-00-000-001.txt");
  assert.equal(templateFileForStudent({ studentId: "", studentName: "Nasoum Ali" }), "s-nasoum-ali.txt");
  assert.equal(templateFileForStudent({ studentId: "..\\..\\evil", studentName: "Nope" }), "s-evil.txt");
});

test("fuzzy search ranks names and ignores misses", () => {
  const students = [
    { studentId: "1", studentName: "Nasoum" },
    { studentId: "2", studentName: "Noura" },
    { studentId: "3", studentName: "Sara" },
  ];
  assert.deepEqual(
    fuzzyStudents(students, "").map((student) => student.studentName),
    ["Nasoum", "Noura", "Sara"],
  );
  assert.deepEqual(
    fuzzyStudents(students, "nou").map((student) => student.studentName),
    ["Noura", "Nasoum"],
  );
  assert.deepEqual(
    fuzzyStudents(students, "nas").map((student) => student.studentName),
    ["Nasoum"],
  );
  assert.deepEqual(fuzzyStudents(students, "zz"), []);
  assert.equal(fuzzyStudents(students, "2")[0].studentName, "Noura");
});

test("extra scans keep the first file and still match that student", () => {
  assert.equal(nextSampleFile("s-adam.txt", []), "s-adam.txt");
  assert.equal(nextSampleFile("s-adam.txt", ["s-adam.txt"]), "s-adam--2.txt");
  assert.equal(nextSampleFile("s-adam.txt", ["s-adam.txt", "s-adam--2.txt"]), "s-adam--3.txt");
  const students = [{ studentName: "Adam", templateFile: "s-adam.txt" }];
  assert.equal(studentByTemplateSid(students, "s-adam").studentName, "Adam");
  assert.equal(studentByTemplateSid(students, "s-adam--2").studentName, "Adam");
  assert.equal(studentByTemplateSid(students, "s-other"), null);
});

test("a batch of scans fills the primary file then extras", () => {
  assert.deepEqual(planBatchFiles("s-adam.txt", [], 3), ["s-adam.txt", "s-adam--2.txt", "s-adam--3.txt"]);
  assert.deepEqual(planBatchFiles("s-adam.txt", ["s-adam.txt"], 2), ["s-adam--2.txt", "s-adam--3.txt"]);
  assert.deepEqual(planBatchFiles("s-adam.txt", ["s-adam.txt", "s-adam--2.txt"], 1), ["s-adam--3.txt"]);
  assert.deepEqual(planBatchFiles("s-adam.txt", [], 0), []);
});

test("decidePrint is known only when the matched template is linked", () => {
  const students = {
    "7": { studentId: "7", studentName: "Nasoum", templateFile: "s-7.txt" },
  };
  assert.equal(decidePrint(students, { matched: true, matchSid: "s-7" }).kind, "known");
  assert.equal(decidePrint(students, { matched: true, matchSid: "S-7" }).student.studentName, "Nasoum");
  assert.equal(decidePrint(students, { matched: false, matchSid: "" }).kind, "new");
  assert.equal(decidePrint(students, { matched: true, matchSid: "s-missing" }).kind, "new");
});

test("local index roundtrip keeps the template file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-store-"));
  const templateFile = templateFileForStudent({ studentId: "p1", studentName: "Nasoum" });
  assert.equal(templateFile, "s-p1.txt");
  const index = { students: {}, pending: null };
  putStudent(index, {
    studentId: "p1",
    studentName: "Nasoum",
    capturedAt: "2026-10-03T09:41:00.000Z",
    templateFile,
  });
  await loadIndex(dir);
  await writeFile(templatePath(dir, templateFile), Buffer.from("template-bytes"));
  await saveIndex(dir, index);

  const loaded = await loadIndex(dir);
  assert.equal(loaded.students.p1.studentName, "Nasoum");
  assert.equal(loaded.students.p1.templateFile, "s-p1.txt");
  await rm(dir, { recursive: true, force: true });
});

test("a sheet permission error asks to share as Editor", () => {
  const email = "editor@example.iam.gserviceaccount.com";
  const other = "Google API POST https://sheets.googleapis.com/v4/spreadsheets/x failed (400): bad request";
  assert.equal(explainApiFailure(other, email).includes("Share as Editor"), false);
  const permission = "Google API GET https://sheets.googleapis.com/v4/spreadsheets/x failed (403): The caller does not have permission";
  assert.match(explainApiFailure(permission, email), /Sheet permission denied\. Share as Editor with editor@example/);
});

test("the student catalog refreshes at most once every 10 seconds", () => {
  assert.equal(CATALOG_REFRESH_MS, 10_000);
  assert.equal(catalogDue(0, 10_000), true);
  assert.equal(catalogDue(1_000, 10_999), false);
  assert.equal(catalogDue(1_000, 11_000), true);
});

test("a mark shows up before the sheet answers, and an early undo cancels it", () => {
  const at = "2026-10-10T05:00:00.000Z";
  const day = "10/10/2026";
  const person = { studentId: "00 00 000 001", studentName: "اسم أول", rowNumber: 3, at, time: "08:00" };
  const queued = queuePresent([], person);
  assert.equal(queued.length, 1);
  assert.equal(queuePresent(queued, person).length, 1);
  const shown = overlayPresent([], queued, day);
  assert.equal(shown[0].name, "اسم أول");
  assert.equal(shown[0].time, "08:00");
  const edited = queueClock(queued, { ...person, time: "08:15" });
  assert.equal(edited[0].time, "08:15");
  assert.equal(edited[0].kind, "present");
  assert.deepEqual(queueAbsent(edited, person), []);
  const written = [{ ...edited[0], cell: true, log: true }];
  const undo = queueAbsent(written, { ...person, logRow: 4 });
  assert.equal(undo[0].kind, "absent");
  assert.equal(undo[0].log, false);
  assert.deepEqual(overlayPresent([{ name: "اسم أول", studentId: "00 00 000 001", rowNumber: 3, time: "08:00", logRow: 4 }], undo, day), []);
  const half = [{ ...edited[0], cell: true, log: false }];
  assert.equal(queueAbsent(half, person)[0].log, true);
  assert.equal(isOfflineError("Google API GET https://sheets.googleapis.com failed (no status): getaddrinfo ENOTFOUND"), true);
  assert.equal(isOfflineError("The caller does not have permission"), false);
});

test("a present mark puts the حاضر checkbox back on that cell", () => {
  const present = attendanceCellUpdate("حاضر");
  assert.equal(present.fields, "userEnteredValue,dataValidation");
  assert.equal(present.cell.userEnteredValue.stringValue, "حاضر");
  assert.equal(present.cell.dataValidation.condition.type, "BOOLEAN");
  assert.equal(present.cell.dataValidation.strict, true);
  assert.equal(present.cell.dataValidation.showCustomUi, true);
  assert.deepEqual(present.cell.dataValidation.condition.values, [{ userEnteredValue: "حاضر" }]);
  const absent = attendanceCellUpdate("");
  assert.equal(absent.cell.userEnteredValue, undefined);
  assert.equal(absent.cell.dataValidation.condition.values[0].userEnteredValue, "حاضر");
});

test("a successful match still plans one حاضر cell", () => {
  const today = new Date(2026, 9, 3);
  const rows = [
    ["إسم كامل", "معرف", dateHeaderText(today)],
    ["", "", "0"],
    ["اسم رابع", "00 00 000 010"],
  ];
  const plan = planAttendance(rows, "00 00 000 010", today, true);
  assert.equal(plan.op, "update");
  assert.equal(plan.a1, "C3");
  assert.deepEqual(plan.values, [["حاضر"]]);
  assert.equal(plan.insert, undefined);
  const when = new Date("2026-10-03T13:55:03Z");
  assert.deepEqual(attendanceLogRow("00 00 000 010", when), ["00 00 000 010", "3/10/2026 16:55:03"]);
  assert.deepEqual(attendanceLogRow("00 00 000 010", when, ["الطالب", "حضور"]), [
    "00 00 000 010",
    "3/10/2026 16:55:03",
  ]);
  assert.deepEqual(attendanceLogRow("00 00 000 010", when, ["الطالب", "حضور", "معرف"]), [
    "",
    "3/10/2026 16:55:03",
    "00 00 000 010",
  ]);
  assert.deepEqual(attendanceLogRow("00 00 000 010", when, ["الطالب", "إسم", "حضور"], "اسم رابع"), [
    "00 00 000 010",
    "اسم رابع",
    "3/10/2026 16:55:03",
  ]);
  const namedLog = [
    ["الطالب", "إسم", "حضور"],
    ["00 00 000 001", "اسم أول", "3/10/2026 09:00:00"],
  ];
  assert.equal(
    attachLogTimes([{ name: "اسم أول", studentId: "00 00 000 001", rowNumber: 3 }], namedLog, today)[0].time,
    "09:00",
  );
  assert.equal(attendanceStamp(new Date("2026-10-03T21:05:09Z")), "4/10/2026 00:05:09");
});

test("fingerprint rows store one template per row and several rows can share an id", () => {
  const when = new Date("2026-10-03T13:55:03Z");
  assert.deepEqual(FINGERPRINT_HEADER, ["student_id", "fingerprint", "created_at"]);
  assert.equal(fingerprintHeaderMissing([]), true);
  assert.equal(fingerprintHeaderMissing([FINGERPRINT_HEADER]), false);
  assert.deepEqual(fingerprintSheetRow("00 00 000 001", "tmpl-a", FINGERPRINT_HEADER, when), [
    "00 00 000 001",
    "tmpl-a",
    "3/10/2026 16:55:03",
  ]);
  assert.deepEqual(fingerprintSheetRow("00 00 000 001", "tmpl-a", ["معرف", "قالب"], when), ["00 00 000 001", "tmpl-a"]);
  assert.deepEqual(fingerprintSheetRow("00 00 000 001", "tmpl-b", ["الطالب", "معرف", "البصمة"], when), [
    "",
    "00 00 000 001",
    "tmpl-b",
  ]);
  const files = fingerprintFiles([
    ["student_id", "fingerprint", "created_at"],
    ["00 00 000 001", "tmpl-a", "3/10/2026 16:55:03"],
    ["00 00 000 001", "tmpl-b", "3/10/2026 16:56:00"],
    ["00 00 000 002", "tmpl-c", "4/10/2026 00:05:09"],
  ]);
  assert.deepEqual(
    files.map((item) => [item.studentId, item.file, item.template]),
    [
      ["00 00 000 001", "s-00-00-000-001.txt", "tmpl-a"],
      ["00 00 000 001", "s-00-00-000-001--2.txt", "tmpl-b"],
      ["00 00 000 002", "s-00-00-000-002.txt", "tmpl-c"],
    ],
  );
  const students = [{ studentId: "00 00 000 001", studentName: "اسم أول", templateFile: "s-00-00-000-001.txt" }];
  assert.equal(studentByTemplateSid(students, "s-00-00-000-001").studentName, "اسم أول");
  assert.equal(studentByTemplateSid(students, "s-00-00-000-001--2").studentId, "00 00 000 001");
});

test("scan and identify invocation", () => {
  const outDir = path.join("C:\\temp", "attendance-scan");
  const args = scanArgs(20, outDir, "cap1");
  assert.deepEqual(args, ["scan", "--timeout", "20", "--out", outDir, "--prefix", "cap1"]);
  const exe = path.join("C:\\scanner", "zk4500.exe");
  assert.match(formatCommand(exe, args), /zk4500\.exe scan --timeout 20 --out .+ --prefix cap1$/);

  const matchDir = path.join("C:\\prints", "templates");
  const identify = identifyArgs(12, outDir, "scan", matchDir);
  assert.deepEqual(identify, ["identify", "--timeout", "12", "--out", outDir, "--prefix", "scan", "--match-dir", matchDir, "--threshold", "8"]);

  const ok = interpretScan("capture_success=True\r\ntemplate=C:\\t\\template-1.txt\r\n", 0);
  assert.equal(ok.ok, true);
  assert.equal(ok.templatePath, "C:\\t\\template-1.txt");
  assert.equal(interpretScan("error=timeout\r\n", 2).error, "Fingerprint capture timed out.");
  assert.match(interpretScan("error=init failed\r\n", 1).error, /init failed/);

  const matched = interpretIdentify("capture_success=True\r\ntemplate=C:\\t\\template-1.txt\r\nmatch_found=True\r\nmatch_sid=s-7\r\n", 0);
  assert.equal(matched.ok, true);
  assert.equal(matched.matched, true);
  assert.equal(matched.matchSid, "s-7");
  const unmatched = interpretIdentify(
    "finger=detected\r\ncapture_success=True\r\nimage=C:\\t\\scan-20261003.jpg\r\ntemplate=C:\\t\\template-20261003.txt\r\nmatch_found=False\r\nmatch_best_sid=s-adam\r\nmatch_sid=\r\nmatch_score=4\r\nmatch_threshold=8\r\n",
    0,
  );
  assert.equal(unmatched.ok, true);
  assert.equal(unmatched.matched, false);
  assert.equal(unmatched.imagePath, "C:\\t\\scan-20261003.jpg");
  assert.equal(unmatched.matchBestSid, "s-adam");
  assert.equal(interpretIdentify("error=timeout\r\n", 2).timedOut, true);
  assert.equal(interpretIdentify("capture_success=False\r\nerror=timeout\r\n", 2).ok, false);
});

test("a matched print marks attendance and stays off the picker", () => {
  const students = [{ studentId: "اسم", studentName: "اسم", templateFile: "s-khalid.txt" }];
  const result = interpretIdentify(
    "capture_success=True\r\nimage=C:\\t\\scan-1.jpg\r\ntemplate=C:\\t\\t.txt\r\nmatch_found=True\r\nmatch_sid=s-khalid\r\n",
    0,
  );
  const view = captureScreen(students, result);
  assert.equal(view.attendance, true);
  assert.equal(view.picker, false);
  assert.equal(view.student.studentName, "اسم");
  assert.equal(view.imagePath, "C:\\t\\scan-1.jpg");
});

test("an unmatched print opens the picker and does not mark attendance", () => {
  const result = interpretIdentify(
    "capture_success=True\r\nimage=C:\\t\\scan-2.jpg\r\ntemplate=C:\\t\\t.txt\r\nmatch_found=False\r\nmatch_sid=\r\n",
    0,
  );
  const view = captureScreen([{ studentId: "اسم", studentName: "اسم", templateFile: "s-khalid.txt" }], result);
  assert.equal(view.picker, true);
  assert.equal(view.attendance, false);
  assert.equal(view.imagePath, "C:\\t\\scan-2.jpg");
});

test("a score at the partial threshold matches that student", () => {
  const students = [{ studentId: "اسم رابع", studentName: "اسم رابع", templateFile: "s-adam.txt" }];
  const view = captureScreen(students, {
    ok: true,
    candidates: [
      { sid: "s-adam", score: PARTIAL_THRESHOLD },
      { sid: "s-other", score: PARTIAL_THRESHOLD - 1 },
    ],
  });
  assert.equal(PARTIAL_THRESHOLD, 8);
  assert.equal(view.attendance, true);
  assert.equal(view.picker, false);
  assert.equal(view.student.studentName, "اسم رابع");
});

test("a weaker score does not steal the match", () => {
  const judged = bestCandidate(
    [
      { sid: "s-other", score: 3 },
      { sid: "s-adam", score: 12 },
    ],
    PARTIAL_THRESHOLD,
  );
  assert.equal(judged.matched, true);
  assert.equal(judged.sid, "s-adam");
  assert.equal(judged.score, 12);
});

test("a score below the partial threshold opens the picker", () => {
  const view = captureScreen([{ studentId: "اسم رابع", studentName: "اسم رابع", templateFile: "s-adam.txt" }], {
    ok: true,
    matchLoaded: 1,
    candidates: [{ sid: "s-adam", score: PARTIAL_THRESHOLD - 1 }],
  });
  assert.equal(view.attendance, false);
  assert.equal(view.picker, true);
  assert.match(view.reason, /Best score 7 vs threshold 8/);
});

test("a timeout has no image, no picker, and no attendance write", () => {
  const result = interpretIdentify("capture_success=False\r\nerror=timeout\r\n", 2);
  const view = captureScreen([{ studentId: "اسم", studentName: "اسم", templateFile: "s-khalid.txt" }], result);
  assert.equal(view.imagePath, "");
  assert.equal(view.picker, false);
  assert.equal(view.attendance, false);
  const hot = captureScreen([{ studentId: "اسم رابع", studentName: "اسم رابع", templateFile: "s-adam.txt" }], {
    ok: false,
    timedOut: true,
    candidates: [{ sid: "s-adam", score: 99 }],
  });
  assert.equal(hot.picker, false);
  assert.equal(hot.attendance, false);
});

test("the finger image path is set only when the capture succeeded", () => {
  const ok = interpretIdentify("capture_success=True\r\nimage=C:\\t\\scan-3.jpg\r\ntemplate=C:\\t\\t.txt\r\nmatch_found=False\r\n", 0);
  assert.equal(captureScreen([], ok).imagePath, "C:\\t\\scan-3.jpg");
  const missed = interpretIdentify("capture_success=False\r\nerror=timeout\r\nimage=C:\\t\\stale.jpg\r\n", 2);
  assert.equal(captureScreen([], missed).imagePath, "");
  assert.equal(interpretScan("capture_success=True\r\nimage=C:\\t\\scan-3.jpg\r\ntemplate=C:\\t\\t.txt\r\n", 0).imagePath, "C:\\t\\scan-3.jpg");
  assert.equal(interpretScan("error=timeout\r\n", 2).imagePath, undefined);
});

test("config env overrides the file and the fingerprint dir stays fixed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-cfg-"));
  const file = path.join(dir, "attendance.config.json");
  await writeFile(
    file,
    JSON.stringify({
      serviceAccountJson: "from-file.json",
      spreadsheetId: "sheet-file",
      fingerprintDir: "prints",
      zk4500Cli: "zk.exe",
      scanTimeoutSeconds: 15,
    }),
  );
  const cfg = loadConfig({
    cwd: dir,
    env: {
      ATTENDANCE_CONFIG: file,
      SPREADSHEET_ID: "sheet-env",
      GOOGLE_SERVICE_ACCOUNT_JSON: path.join(dir, "sa.json"),
    },
  });
  assert.equal(cfg.spreadsheetId, "sheet-env");
  assert.equal(cfg.serviceAccountJson, path.join(dir, "sa.json"));
  assert.equal(cfg.fingerprintDir, path.join(homedir(), "Masjid", "v1", "fingerprints"));
  assert.equal(cfg.sheetGid, null);
  assert.equal(cfg.scanTimeoutSeconds, 15);

  const overridden = loadConfig({
    cwd: dir,
    env: { ATTENDANCE_CONFIG: file, FINGERPRINT_DIR: path.join(dir, "prints") },
  });
  assert.equal(overridden.fingerprintDir, path.join(dir, "prints"));
  assert.throws(() => requireGoogleConfig({ ...cfg, spreadsheetId: "" }), /SPREADSHEET_ID/);
});

test("clearing fingerprints removes the prints and leaves other files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "masjid-prints-"));
  const templates = path.join(dir, "templates");
  await mkdir(templates, { recursive: true });
  await writeFile(path.join(templates, "s-adam.txt"), "print");
  await writeFile(path.join(templates, "s-adam--2.txt"), "print2");
  await writeFile(path.join(dir, "pending.txt"), "waiting");
  await writeFile(path.join(dir, "notes.txt"), "keep");
  await saveIndex(dir, {
    students: { a: { studentId: "a", studentName: "Adam", templateFile: "s-adam.txt" } },
    pending: { capturedAt: "x" },
  });
  const removed = await clearFingerprints(dir);
  assert.equal(removed, 2);
  const index = await loadIndex(dir);
  assert.deepEqual(index, { students: {}, pending: null });
  assert.deepEqual(JSON.parse(await readFile(logPath(dir), "utf8")), []);
  await assert.rejects(readFile(path.join(templates, "s-adam.txt")));
  await assert.rejects(readFile(pendingPath(dir)));
  assert.equal(await readFile(path.join(dir, "notes.txt"), "utf8"), "keep");
  await rm(dir, { recursive: true, force: true });
});

test("bug logs are written under ~/Masjid/logs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "masjid-log-"));
  const when = new Date(2026, 9, 3, 17, 44, 5);
  const file = appLogFile(when, home);
  assert.equal(file, path.join(home, "Masjid", "logs", "attendance-2026-10-03.log"));
  await appendAppLog(file, appLogLine("error", "Scanner init failed (2)", when));
  await appendAppLog(file, appLogLine("info", "Scanner ready\nnext line", when));
  const body = await readFile(file, "utf8");
  assert.match(body, /2026-10-03 17:44:05 error Scanner init failed \(2\)/);
  assert.match(body, /info Scanner ready \| next line/);
  await rm(home, { recursive: true, force: true });
});

test("the place-finger cue turns on only after the scanner is ready", () => {
  const early = ["Next capture scheduled", "Capture started · identify · 20s", "Waiting for a finger · 1s"];
  assert.equal(fingerCue(early), "wait");
  const open = [...early, "Scanner ready", "Waiting for a finger · 3s"];
  assert.equal(fingerCue(open), "now");
  assert.equal(fingerCue([...open, "Finger detected"]), "hold");
  assert.equal(fingerCue(["Scanner ready", "Scanner init failed (2)"]), "wait");
});

test("the scan log reads as short steps", () => {
  assert.deepEqual(
    presentTrace([
      "Next capture scheduled",
      "Capture started · identify · 20s",
      "Waiting for a finger · 1s",
      "Scanner ready",
      "Waiting for a finger · 3s",
    ]),
    [
      { tone: "again", title: "Next scan", meta: "", live: false },
      { tone: "listen", title: "Listening", meta: "", live: false },
      { tone: "wait", title: "Waited", meta: "1s", live: false },
      { tone: "ready", title: "Scanner ready", meta: "", live: false },
      { tone: "wait", title: "Waiting for a finger", meta: "3s", live: true },
    ],
  );
  assert.equal(presentTrace(["Matched اسم رابع · score 26 / 8"])[0].title, "Matched اسم رابع");
  assert.equal(presentTrace(["No match · best 0 / 8"])[0].tone, "miss");
  assert.equal(presentTrace(["Finger detected", "Print captured"])[0].title, "Finger seen");
});

test("arabic copy keeps student names and turns known chrome into Arabic", () => {
  assert.equal(translate("Settings", "en"), "Settings");
  assert.equal(translate("Settings", "ar"), "الإعدادات");
  assert.equal(translate("Place your finger", "ar"), "ضع إصبعك");
  assert.equal(translate("Cancel", "ar"), "إلغاء");
  assert.equal(translate("Drop these scans?", "ar"), "إلغاء هذه المسحات؟");
  assert.equal(translate("Drop scans", "ar"), "أزل المسحات");
  const matched = translate("Matched اسم رابع", "ar");
  assert.match(matched, /اسم رابع/);
  assert.doesNotMatch(matched, /Matched/);
  assert.match(matched, /تطابق/);
  const timed = translate("Time for مثال set to 3/10/2026 16:55:03.", "ar");
  assert.match(timed, /مثال/);
  assert.match(timed, /16:55:03/);
  assert.match(translate("3 scans kept. Place another finger.", "ar"), /3/);
  assert.match(translate("Linked اسم. Marked present.", "ar"), /اسم/);
  assert.equal(translate("not a known scanner line", "ar"), "not a known scanner line");
});

test("screenForPhase keeps listening, the picker, and setup apart", () => {
  assert.equal(screenForPhase("ready"), "ready");
  assert.equal(screenForPhase("pending"), "pending");
  assert.equal(screenForPhase("linking"), "pending");
  assert.equal(screenForPhase("config"), "config");
  assert.equal(screenForPhase("starting"), "ready");
});

test("buildRoster skips students without a print and ignores pending.txt", () => {
  const roster = buildRoster(
    {
      a: { studentId: "2", studentName: "Sara", templateFile: "s-2.txt", capturedAt: "t2" },
      b: { studentId: "7", studentName: "Nasoum", templateFile: "s-7.txt", capturedAt: "t7" },
      c: { studentId: "3", studentName: "No Print", templateFile: "", capturedAt: "" },
      d: { studentId: "4", studentName: "Missing File", templateFile: "s-4.txt", capturedAt: "t4" },
      e: { studentId: "", studentName: "Pending", templateFile: "pending.txt", capturedAt: "tp" },
    },
    ["s-2.txt", "s-7.txt", "pending.txt"],
  );
  assert.deepEqual(
    roster.map((row) => row.studentName),
    ["Nasoum", "Sara"],
  );
  assert.equal(roster[0].templateFile, "s-7.txt");
  assert.equal(roster.some((row) => row.templateFile === "pending.txt"), false);
});

test("log.json adds a print, replaces it, and drops a file removed from disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-log-"));
  const index = { students: {}, pending: null };
  putStudent(index, {
    studentId: "2",
    studentName: "Sara",
    templateFile: "s-2.txt",
    capturedAt: "2026-10-03T09:00:00.000Z",
  });
  putStudent(index, {
    studentId: "7",
    studentName: "Nasoum",
    templateFile: "s-7.txt",
    capturedAt: "2026-10-03T08:00:00.000Z",
  });
  putStudent(index, {
    studentId: "3",
    studentName: "No Print",
    templateFile: "",
    capturedAt: "",
  });
  await loadIndex(dir);
  await writeFile(templatePath(dir, "s-2.txt"), Buffer.from("sara"));
  await writeFile(templatePath(dir, "s-7.txt"), Buffer.from("sample"));
  await saveIndex(dir, index);

  const created = await readFile(logPath(dir), "utf8");
  assert.equal(created, `${JSON.stringify(JSON.parse(created), null, 2)}\n`);
  assert.deepEqual(
    JSON.parse(created).map((row) => row.studentName),
    ["Nasoum", "Sara"],
  );

  putStudent(index, {
    studentId: "7",
    studentName: "Nasoum",
    templateFile: "s-7.txt",
    capturedAt: "2026-10-03T11:00:00.000Z",
  });
  await writeFile(templatePath(dir, "s-7.txt"), Buffer.from("sample-replaced"));
  await saveIndex(dir, index);
  const replaced = JSON.parse(await readFile(logPath(dir), "utf8"));
  assert.equal(replaced.length, 2);
  assert.equal(replaced.filter((row) => row.studentId === "7").length, 1);
  assert.equal(replaced.find((row) => row.studentId === "7").capturedAt, "2026-10-03T11:00:00.000Z");
  assert.equal(replaced.find((row) => row.studentId === "7").templateFile, "s-7.txt");

  await rm(templatePath(dir, "s-2.txt"));
  await saveIndex(dir, index);
  const afterRemoval = JSON.parse(await readFile(logPath(dir), "utf8"));
  assert.deepEqual(
    afterRemoval.map((row) => row.studentId),
    ["7"],
  );
  assert.equal(afterRemoval.some((row) => row.studentName === "No Print"), false);
});

test("pending capture survives and is not an enrolled template", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-pending-"));
  const capturedAt = "2026-10-03T10:00:00.000Z";
  const index = { students: {}, pending: { capturedAt } };
  await loadIndex(dir);
  await writeFile(pendingPath(dir), Buffer.from("pending-print"));
  await saveIndex(dir, index);

  const loaded = await loadIndex(dir);
  assert.deepEqual(loaded.pending, { capturedAt });
  assert.equal((await readFile(pendingPath(dir))).toString(), "pending-print");
  assert.notEqual(path.dirname(pendingPath(dir)), path.join(dir, "templates"));
  assert.deepEqual(JSON.parse(await readFile(logPath(dir), "utf8")), []);
  assert.equal(decidePrint(loaded.students, { matched: true, matchSid: "pending" }).kind, "new");
});

test("empty config placeholders stay empty", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-placeholders-"));
  const file = path.join(dir, "attendance.config.json");
  await writeFile(
    file,
    JSON.stringify({
      serviceAccountJson: "C:\\path\\to\\service-account.json",
      spreadsheetId: "",
      sheetGid: "",
      zk4500Cli: "",
    }),
  );
  const cfg = loadConfig({ cwd: dir, env: { ATTENDANCE_CONFIG: file } });
  assert.equal(cfg.serviceAccountJson, "");
  assert.equal(cfg.spreadsheetId, "");
  assert.equal(cfg.sheetGid, null);
  assert.equal(cfg.logSpreadsheetId, "");
  assert.equal(cfg.logSheetGid, null);
  assert.equal(cfg.fingerprintSheetGid, null);
  assert.equal(cfg.zk4500Cli, "");
  assert.equal(cfg.fingerprintDir, path.join(homedir(), "Masjid", "v1", "fingerprints"));

  const overridden = loadConfig({
    cwd: dir,
    env: { ATTENDANCE_CONFIG: file, SPREADSHEET_ID: "custom-sheet", SHEET_GID: "99" },
  });
  assert.equal(overridden.spreadsheetId, "custom-sheet");
  assert.equal(overridden.sheetGid, 99);
});

test("default paths stay fixed unless FINGERPRINT_DIR is set", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-defaults-"));
  const cfg = loadConfig({ cwd: dir, env: {} });
  assert.equal(cfg.zk4500Cli, "");
  assert.equal(cfg.fingerprintDir, path.join(homedir(), "Masjid", "v1", "fingerprints"));
  assert.equal(cfg.serviceAccountJson, "");
  assert.equal(cfg.spreadsheetId, "");
  assert.equal(cfg.sheetGid, null);
  assert.equal(cfg.fingerprintSheetGid, null);
  assert.throws(
    () => requireGoogleConfig({ ...cfg, serviceAccountJson: "", spreadsheetId: "sheet" }),
    /serviceAccountJson/,
  );
  assert.throws(
    () => requireGoogleConfig({ ...cfg, serviceAccountJson: "key.json", spreadsheetId: "" }),
    /SPREADSHEET_ID/,
  );
  assert.doesNotThrow(() =>
    requireGoogleConfig({ ...cfg, serviceAccountJson: "key.json", spreadsheetId: "sheet", sheetGid: 1 }),
  );
  const overridden = loadConfig({
    cwd: dir,
    env: { FINGERPRINT_DIR: path.join(dir, "prints") },
  });
  assert.equal(overridden.fingerprintDir, path.join(dir, "prints"));
});

test("packaged app uses the bundled scanner when the saved path is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-scanner-"));
  const file = path.join(dir, "attendance.config.json");
  const saved = "C:\\scanner\\zk4500.exe";
  const bundled = path.join(dir, "resources", "scanner", "zk4500.exe");
  await writeFile(file, JSON.stringify({ zk4500Cli: saved }));
  const missing = loadConfig({
    cwd: dir,
    env: { ATTENDANCE_CONFIG: file },
    scannerDefault: bundled,
    scannerFallback: bundled,
    exists: () => false,
  });
  assert.equal(missing.zk4500Cli, bundled);
  const present = loadConfig({
    cwd: dir,
    env: { ATTENDANCE_CONFIG: file },
    scannerDefault: bundled,
    scannerFallback: bundled,
    exists: (candidate) => candidate === saved,
  });
  assert.equal(present.zk4500Cli, saved);
  const absent = loadConfig({
    cwd: dir,
    env: { ATTENDANCE_CONFIG: path.join(dir, "missing.json") },
    scannerDefault: bundled,
    scannerFallback: bundled,
    exists: () => false,
  });
  assert.equal(absent.zk4500Cli, bundled);
});

test("the installed profile stays in the captured directory", () => {
  const appData = path.join("C:\\Users\\someone\\AppData", "Roaming");
  assert.equal(LEGACY_USER_DATA_DIR, "attendance-service");
  assert.equal(legacyUserDataPath(appData), path.join(appData, "attendance-service"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "attendance-app");
  assert.equal(pkg.build.appId, "com.masjid.attendance");
  assert.equal(pkg.build.productName, "Masjid Attendance");
  assert.equal(pkg.build.win.executableName, "Masjid Attendance");
  assert.equal(pkg.build.nsis.shortcutName, "Masjid Attendance");
  assert.equal(pkg.build.nsis.uninstallDisplayName, "Masjid Attendance");
  assert.equal(pkg.build.nsis.guid, "2febcda6-3658-5c7c-9dfa-528fe71d9a9a");
  assert.equal(pkg.build.extraResources[0].from, "staging/scanner");
  assert.equal(JSON.stringify(pkg).includes("D:/workspaces"), false);
  assert.equal(JSON.stringify(pkg).includes("D:\\\\workspaces"), false);
});

test("createGoogle fails clearly without a key file", async () => {
  await assert.rejects(() => createGoogle({ serviceAccountJson: "" }), /Missing service account JSON path/);
  const missing = path.join(tmpdir(), "no-such-attendance-key.json");
  await assert.rejects(() => createGoogle({ serviceAccountJson: missing }), /Cannot read service account JSON/);
  const dir = await mkdtemp(path.join(tmpdir(), "attendance-key-"));
  const bad = path.join(dir, "sa.json");
  await writeFile(bad, JSON.stringify({ type: "service_account" }));
  await assert.rejects(() => createGoogle({ serviceAccountJson: bad }), /missing client_email or private_key/);
});
