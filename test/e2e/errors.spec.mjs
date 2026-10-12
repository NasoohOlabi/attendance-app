import { test, expect } from "./fixtures/app.mjs";

test.describe("missing credentials", () => {
  test.use({ fixtureOptions: { config: { serviceAccountJson: "" } } });
  test("missing credentials show a setup error and never reach Google", async ({ app }) => {
    await expect(app.page.locator("#error")).toContainText("Missing service account JSON path");
    await app.page.locator("#settings").click();
    await expect(app.page.locator("#config")).toBeVisible();
    await app.page.locator("#settings-account-tab").click();
    await expect(app.page.locator("#account-status")).toHaveText("No service account imported.");
    expect(app.sheets.requests).toEqual([]);
  });
});

test.describe("malformed configuration", () => {
  test.use({ fixtureOptions: { configText: "{broken-json" } });
  test("malformed configuration leaves Settings available without sheet access", async ({ app }) => {
    await expect(app.page.locator("#error")).toBeVisible();
    await expect(app.page.locator("#error")).toContainText(/JSON|property|Unexpected/i);
    await app.page.locator("#settings").click();
    await expect(app.page.locator("#config")).toBeVisible();
    expect(app.sheets.requests).toEqual([]);
    expect(app.captures).toEqual([]);
  });
});

test("a protected attendance cell reports the failure and retains the queued mark", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  const error = new Error("protected cell");
  error.response = { status: 400, data: { error: "protected cell" } };
  app.sheets.failNext = { predicate: (options) => options.data?.requests?.some((request) => request.updateCells?.start?.rowIndex >= 2), error };
  await app.mark();
  await expect(app.page.locator("#error")).toContainText("protected range");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
  expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
  const queued = (await app.outbox()).items;
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ studentId: "00 00 000 001", cell: false, log: false });
});
