import { test, expect } from "./fixtures/app.mjs";

test.describe("a missing date", () => {
  test.use({ fixtureOptions: { sheets: { day: "13/10" } } });
  test("inserts today's date without reordering existing days or changing another student", async ({ app }) => {
    await app.ready();
    await app.seedPrint();
    await app.mark();
    await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
    const grid = app.sheets.grid("Info");
    expect(grid.rows[0].slice(2, 5)).toEqual(["13/10", "11/10", "12/10"]);
    expect(grid.rows[2][4]).toBe("حاضر");
    expect(grid.rows[3][4]).toBe("");
    expect(grid.cells.get("2,4").dataValidation.showCustomUi).toBe(true);
    expect(grid.cells.get("1,4").formula).toBe("=COUNTA(E3:E)");
  });
});

test.describe("Damascus midnight on a UTC computer", () => {
  test.use({ fixtureOptions: { clock: "2026-12-31T21:30:03.000Z", timezone: "UTC", sheets: { day: "1/1" } } });
  test("uses the same Damascus day for the checkbox and the log across the new year", async ({ app }) => {
    await app.ready();
    await app.seedPrint();
    await app.mark();
    await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
    expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
    expect(app.sheets.grid("Info").rows[0][2]).toBe("1/1");
    expect(app.sheets.grid("AttendanceLog").rows[1][2]).toBe("1/1/2027 00:30:00");
  });
});
