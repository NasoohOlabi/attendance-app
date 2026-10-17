import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSheetRow,
  deleteSheetRows,
  ensureDateColumn,
  getSheetGrid,
  writeAttendanceCell,
} from "../../src/google.mjs";
import { createSheets } from "../e2e/fixtures/sheets.mjs";

test("the Sheets fixture serves real grid reads and restricts endpoints", async () => {
  const sheets = createSheets();
  const grid = await getSheetGrid(sheets, "attendance-test", 1);
  assert.equal(grid.title, "Info");
  const before = sheets.requests.length;
  const again = await getSheetGrid(sheets, "attendance-test", 1);
  assert.equal(again.title, "Info");
  const added = sheets.requests.slice(before).map((item) => item.url);
  assert.equal(added.some((url) => url.includes("fields=sheets.properties")), false);
  assert.equal(added.filter((url) => url.includes("/values/")).length, 1);
  assert.deepEqual(grid.rows[0].slice(0, 3), ["إسم كامل", "معرف", "12/10"]);
  assert.equal(grid.rows[2][1], "00 00 000 001");
  await assert.rejects(sheets.request({ url: "https://sheets.googleapis.com/v4/spreadsheets/attendance-test/unknown" }), /Unknown endpoint/);
  await assert.rejects(sheets.request({ url: "https://example.test/v4/spreadsheets/attendance-test" }), /Unknown endpoint/);
});

test("attendance writes update one value and keep its checkbox validation", async () => {
  const sheets = createSheets();
  delete sheets.grid("Info").cells.get("2,2").dataValidation;
  await writeAttendanceCell(sheets, "attendance-test", "Info", "C3", "حاضر");
  let grid = sheets.grid("Info");
  assert.equal(grid.rows[2][2], "حاضر");
  assert.equal(grid.cells.get("2,2").dataValidation.condition.values[0].userEnteredValue, "حاضر");
  await writeAttendanceCell(sheets, "attendance-test", "Info", "C3", "");
  grid = sheets.grid("Info");
  assert.equal(grid.rows[2][2], "");
  assert.equal(grid.cells.get("2,2").dataValidation.condition.type, "BOOLEAN");
  assert.equal(grid.rows[2][1], "00 00 000 001");
});

test("log appends and descending row deletion preserve the header and unrelated row", async () => {
  const sheets = createSheets();
  await appendSheetRow(sheets, "pages-test", 2, ["00 00 000 001", "أحمد طالب", "12/10/2026 08:30:00"]);
  await appendSheetRow(sheets, "pages-test", 2, ["00 00 000 002", "أحمد طالب", "12/10/2026 08:31:00"]);
  await appendSheetRow(sheets, "pages-test", 2, ["00 00 000 003", "سلمى طالبة", "12/10/2026 08:32:00"]);
  await deleteSheetRows(sheets, "pages-test", 2, [2, 4, 2]);
  assert.deepEqual(sheets.grid("AttendanceLog").rows, [
    ["الطالب", "إسم", "حضور"],
    ["00 00 000 002", "أحمد طالب", "12/10/2026 08:31:00"],
  ]);
});

test("date insertion copies date formatting, formula, and validation to the new column", async () => {
  const sheets = createSheets();
  const result = await ensureDateColumn(sheets, "attendance-test", 1, new Date(2026, 9, 13));
  assert.equal(result.inserted, true);
  assert.equal(sheets.grid("Info").rows[0][3], "13/10");
  assert.equal(sheets.grid("Info").cells.get("0,3").userEnteredFormat.numberFormat.pattern, "d/m");
  assert.equal(sheets.grid("Info").cells.get("1,3").formula, "=COUNTA(D3:D)");
  assert.equal(sheets.grid("Info").cells.get("2,3").dataValidation.condition.type, "BOOLEAN");
  assert.equal(sheets.grid("Info").rows[2][4], "");
});
