import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures/app.mjs";

test.use({ fixtureOptions: { config: { fingerprintSheetGid: 3 } } });

async function switchMode(app, enabled) {
  const { page } = app;
  await page.locator("#settings").click();
  await page.getByRole("switch", { name: "Test mode" }).click();
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await expect(page.locator("#ready")).toBeVisible();
  await expect(page.locator("#test-mode-progress")).toBeHidden();
  await expect(page.locator("#test-mode-indicator")).toBeVisible({ visible: enabled });
}

async function markManually(app, name) {
  const { page } = app;
  await page.locator("#mark-manual").click();
  await page.locator("#manual-list").getByRole("button", { name: new RegExp(name) }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#today-list")).toContainText(name);
}

test("test scans and manual attendance are discarded before live attendance resumes", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  await app.restart();
  await app.ready();
  const { page } = app;
  const backupRows = () => app.sheets.grid("FingerPrints").rows.slice(1).map((row) => row.slice(0, 2));
  await expect.poll(backupRows).toEqual([["bouty:9", "synthetic-print"]]);
  const liveBackup = backupRows();
  const liveIndex = await app.index();
  const liveFiles = await app.files();
  const liveSample = path.join(app.prints, "templates", liveFiles[0]);
  const originalSample = await readFile(liveSample, "utf8");
  const writes = () => app.electron.evaluate(() => globalThis.boutyTestAttendance);

  await switchMode(app, true);
  app.enqueue({ template: "practice-sample" });
  await expect(page.locator("#pending")).toBeVisible();
  await page.locator("#list").getByRole("button", { name: /Website Student/ }).click();
  await expect(page.locator("#today-list")).toContainText("Website Student");

  await page.locator("#today-list .today-undo").click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#today-count")).toHaveText("0");
  app.enqueue({ matchSid: path.basename(liveFiles[0], ".txt") + "--2" });
  await expect(page.locator("#today-list")).toContainText("Website Student");

  await page.locator("#prints-nav").click();
  const row = page.locator("#prints-list li").filter({ hasText: "Website Student" });
  await expect(row).toContainText("2 prints");
  await row.getByRole("button", { name: "Delete" }).click();
  await page.locator("#confirm-ok").click();
  await expect(row).toHaveCount(0);
  await page.locator("#attendance").click();
  await markManually(app, "Another Student");
  await expect(page.locator("#today-count")).toHaveText("2");
  await page.locator("#dashboard").click();
  await expect(page.locator("#trend .trend-day strong")).toHaveText("2");
  await page.locator("#dashboard-close").click();
  await page.locator("#today-list li").filter({ hasText: "Another Student" }).getByRole("button", { name: "Undo" }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#today-count")).toHaveText("1");
  expect(await writes()).toEqual([]);
  expect(backupRows()).toEqual(liveBackup);
  expect(await app.files()).toEqual(liveFiles);
  expect(await app.index()).toEqual(liveIndex);

  await switchMode(app, false);
  await expect(page.locator("#today-count")).toHaveText("0");
  expect(await app.files()).toEqual(liveFiles);
  expect(await app.index()).toEqual(liveIndex);
  expect(await readFile(liveSample, "utf8")).toBe(originalSample);
  expect(await writes()).toEqual([]);
  await markManually(app, "Website Student");
  await expect.poll(writes).toEqual([expect.objectContaining({ entity_id: 31, status_id: 1 })]);
  expect(backupRows()).toEqual(liveBackup);
});

test("a queued live mark survives a practice undo and syncs after exit", async ({ app }) => {
  await app.ready();
  const { page } = app;
  const queueFile = path.join(app.home, "Masjid/v1/config/bouty-outbox.json");
  const queue = async () => JSON.parse(await readFile(queueFile, "utf8"));
  const writes = () => app.electron.evaluate(() => globalThis.boutyTestAttendance);
  await app.electron.evaluate(() => { globalThis.boutyTestOffline = true; });
  await markManually(app, "Website Student");
  await expect(page.locator("#sync")).toHaveText("Bouty connection failed.");
  const before = await queue();
  expect(before.items).toHaveLength(1);
  expect(before.items[0]).toMatchObject({ studentId: "bouty:9", kind: "present" });

  await switchMode(app, true);
  await expect(page.locator("#sync")).toBeEmpty();
  await page.locator("#today-list .today-undo").click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#today-count")).toHaveText("0");
  await markManually(app, "Another Student");
  const blocked = await page.evaluate(() => Promise.all([
    window.attendance.signOutBouty(),
    window.attendance.saveConfig({ updateChannel: "nightly" }),
  ]));
  for (const result of blocked) expect(result).toEqual({ ok: false, error: "Exit test mode to change these settings." });
  await app.electron.evaluate(async () => {
    globalThis.boutyTestOffline = false;
    // Allow the fixture's one-second live sync timer to fire while test mode is active.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  });
  expect(await writes()).toEqual([]);
  expect(await queue()).toEqual(before);

  await switchMode(app, false);
  await expect(page.locator("#today-list .today-name")).toHaveText("Website Student");
  await expect.poll(writes).toEqual([expect.objectContaining({
    client_operation_id: before.items[0].id,
    entity_id: 31,
    status_id: 1,
  })]);
  await expect.poll(queue).toEqual({ items: [], confirmed: before.items });
});
