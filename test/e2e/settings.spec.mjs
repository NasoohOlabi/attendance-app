import { test, expect } from "./fixtures/app.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function openSettings(page) {
  await page.locator("#settings").click();
  await expect(page.locator("#config")).toBeVisible();
}

test("manual Bouty overrides use labelled fields and reject duplicate dates", async ({ app }) => {
  await openSettings(app.page);
  await app.electron.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("saveBouty");
    ipcMain.handle("saveBouty", (_event, input) => {
      globalThis.savedBoutyOverrides = JSON.parse(input.settings);
      return { ok: true };
    });
  });
  await app.page.locator("#bouty-advanced").evaluate((element) => { element.hidden = false; element.open = true; });
  await app.page.locator("#add-bouty-day").click();
  const date = app.page.locator("#bouty-days .override-row").first();
  await date.getByLabel("Date in Damascus").fill("2026-11-21");
  await date.getByLabel("Attendance day ID").fill("42");
  await app.page.locator("#add-bouty-link").click();
  await app.page.getByLabel("Student ID", { exact: true }).fill("123");
  await app.page.getByLabel("Enrolment ID", { exact: true }).fill("456");
  await app.page.locator("#save-bouty-advanced").click();
  expect(await app.electron.evaluate(() => globalThis.savedBoutyOverrides)).toEqual({
    mapping: [{ studentId: "123", enrollmentId: 456 }], days: { "2026-11-21": 42 }, presentStatusId: 1, absentStatusId: 2,
  });
  await app.page.locator("#add-bouty-day").click();
  const duplicate = app.page.locator("#bouty-days .override-row").last();
  await duplicate.getByLabel("Date in Damascus").fill("2026-11-21");
  await duplicate.getByLabel("Attendance day ID").fill("99");
  await app.page.locator("#save-bouty-advanced").click();
  await expect(app.page.getByText("Each attendance date can only be listed once.")).toBeVisible();
  expect((await app.electron.evaluate(() => globalThis.savedBoutyOverrides)).days).toEqual({ "2026-11-21": 42 });
  await duplicate.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(app.page.locator("#bouty-days .override-row")).toHaveCount(1);
});

test("settings cancel discards edits", async ({ app }) => {
  const before = await readFile(app.configPath, "utf8");
  await openSettings(app.page);
  await app.page.locator("#cfg-exe").fill("unsaved-scanner");
  await app.page.locator("#cancel").click();
  await expect(app.page.locator("#ready")).toBeVisible();
  expect(await readFile(app.configPath, "utf8")).toBe(before);
});

test("settings save persists the update track without requiring Sheets", async ({ app }) => {
  await openSettings(app.page);
  await app.page.locator("#track-nightly").click();
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await app.page.locator("#save").click();
  await expect(app.page.locator("#ready")).toBeVisible();
  expect(JSON.parse(await readFile(app.configPath, "utf8")).updateChannel).toBe("nightly");
  await app.restart();
  await openSettings(app.page);
  await expect(app.page.locator("#track-nightly")).toHaveAttribute("aria-pressed", "true");
  await expect(app.page.locator("#cfg-sheet")).toHaveCount(0);
});

test("Browse places the chosen executable path in the scanner field", async ({ app }) => {
  const chosen = path.join(app.root, "chosen-scanner.exe");
  await openSettings(app.page);
  await app.electron.evaluate(({ dialog }, testPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [testPath] });
  }, chosen);
  await app.page.locator('[data-pick="exe"]').click();
  await expect(app.page.locator("#cfg-exe")).toHaveValue(chosen);
});

test("language direction and choice survive switching and restart", async ({ app }) => {
  await openSettings(app.page);
  await app.page.locator("#lang-ar").click();
  await expect(app.page.locator("html")).toHaveAttribute("dir", "rtl");
  await app.restart();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(app.page.locator("html")).toHaveAttribute("dir", "rtl");

  await openSettings(app.page);
  await app.page.locator("#lang-en").click();
  await expect(app.page.locator("html")).toHaveAttribute("dir", "ltr");
  await app.restart();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "en");
  await expect(app.page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("each Arabic font is selectable and the latest choice survives restart", async ({ app }) => {
  await openSettings(app.page);
  for (const font of ["cairo", "tajawal", "plex", "naskh"]) {
    await app.page.locator(`button[data-font="${font}"]`).click();
    await expect(app.page.locator("html")).toHaveAttribute("data-font", font);
    await expect(app.page.locator(`button[data-font="${font}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await app.restart();
  await expect(app.page.locator("html")).toHaveAttribute("data-font", "naskh");
  await openSettings(app.page);
  await expect(app.page.locator('button[data-font="naskh"]')).toHaveAttribute("aria-pressed", "true");
});

test("fingerprint deletion confirmation can be canceled three ways", async ({ app }) => {
  await openSettings(app.page);
  await app.seedPrint();
  const before = await app.files();
  const confirm = app.page.locator("#confirm");

  await app.page.locator("#clear-prints").click();
  await expect(confirm).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();

  await app.page.locator("#clear-prints").click();
  await expect(confirm).toBeVisible();
  await confirm.click({ position: { x: 4, y: 4 } });
  await expect(confirm).toBeHidden();

  await app.page.locator("#clear-prints").click();
  await expect(confirm).toBeVisible();
  await app.page.locator("#confirm-cancel").click();
  await expect(confirm).toBeHidden();
  expect(await app.files()).toEqual(before);
});

test("ready window keeps its default size and honors its minimum size", async ({ app }) => {
  const geometry = await app.electron.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { bounds: window.getBounds(), minimum: window.getMinimumSize(), workArea: screen.getPrimaryDisplay().workAreaSize };
  });
  const expectedWidth = Math.min(1120, geometry.workArea.width);
  const expectedHeight = Math.min(800, geometry.workArea.height);
  expect(geometry.bounds.width).toBeGreaterThanOrEqual(expectedWidth);
  expect(geometry.bounds.width).toBeLessThanOrEqual(expectedWidth + 4);
  expect(geometry.bounds.height).toBeGreaterThanOrEqual(expectedHeight);
  expect(geometry.bounds.height).toBeLessThanOrEqual(expectedHeight + 4);
  expect(geometry.minimum).toEqual([900, 680]);
});

