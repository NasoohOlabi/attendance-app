import assert from "node:assert/strict";
import test from "node:test";
import { requireGoogleConfig } from "../../src/config.mjs";
import { presentFromLog, queuePresent, queueAbsent, queueClock, queuedAttendanceStamp, nextGoogleAttendance } from "../../src/store.mjs";

test("Bouty mode uses the Pages log without requiring the daily grid", () => {
  const config = { attendanceDestination: "bouty", serviceAccountJson: "key", fingerprintDir: "prints", logSpreadsheetId: "pages", logSheetGid: 1, fingerprintSheetGid: 2 };
  assert.doesNotThrow(() => requireGoogleConfig(config));
  assert.throws(() => requireGoogleConfig({ ...config, logSpreadsheetId: "" }), /LOG_SPREADSHEET_ID/);
  assert.deepEqual(presentFromLog([{ studentId: "001", studentName: "One", rowNumber: 1 }], [
    ["الطالب", "حضور"], ["001", "31/10/2026 09:05:00"],
  ], new Date("2026-10-31T06:05:00Z")), [{ name: "One", studentId: "001", rowNumber: 1, time: "09:05", logRow: 2 }]);
});

test("Pages keeps the original scan seconds and honors an explicit clock correction", () => {
  const scan = { studentId: "001", at: "2026-10-31T06:05:37Z", time: "09:05", exactTime: true, destination: "bouty" };
  const pending = queuePresent([], scan);
  assert.equal(queuedAttendanceStamp(pending[0]), "31/10/2026 09:05:37");
  const edited = queueClock(pending, { ...scan, time: "09:12" });
  assert.equal(queuedAttendanceStamp(edited[0]), "31/10/2026 09:12:00");
});

test("switching destinations keeps an existing pending sheet mark separate", () => {
  const person = { studentId: "001", studentName: "One", at: "2026-10-31T06:05:00Z" };
  const sheet = queuePresent([], person);
  const both = queuePresent(sheet, { ...person, destination: "bouty" });
  assert.equal(both.length, 2);
  assert.equal(both[0].destination, undefined);
  assert.equal(both[1].destination, "bouty");
  assert.equal(nextGoogleAttendance(both, "bouty"), both[1]);
  assert.equal(nextGoogleAttendance(both, "sheet"), both[0]);
  assert.equal(nextGoogleAttendance([both[0]], "bouty"), undefined);
  const remaining = queueAbsent(both, { ...person, destination: "bouty" });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].destination, undefined);
});
