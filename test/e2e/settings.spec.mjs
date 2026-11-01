import { test, expect } from "./fixtures/app.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function openSettings(page) {
  await page.locator("#settings").click();
  await expect(page.locator("#config")).toBeVisible();
}

test("settings cancel discards edits", async ({ app }) => {
  const before = await readFile(app.configPath, "utf8");
  await openSettings(app.page);
  await app.page.locator("#cfg-sheet").fill("unsaved-sheet");
  await app.page.locator("#cancel").click();
  await expect(app.page.locator("#ready")).toBeVisible();
  expect(await readFile(app.configPath, "utf8")).toBe(before);
});

test("settings save persists editable values without dropping Pages configuration", async ({ app }) => {
  const alternate = structuredClone(app.sheets.grid("Info"));
  alternate.sheetId = 8;
  alternate.title = "Alternate";
  app.sheets.grids.push(alternate);
  await openSettings(app.page);
  await app.page.locator("#cfg-gid").fill("8");
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await app.page.locator("#save").click();
  await expect(app.page.locator("#ready")).toBeVisible();

  const saved = JSON.parse(await readFile(app.configPath, "utf8"));
  expect(saved).toMatchObject({
    serviceAccountJson: path.join(app.root, "synthetic-key.json"),
    spreadsheetId: "attendance-test",
    sheetGid: 8,
    logSpreadsheetId: "pages-test",
    logSheetGid: 2,
    fingerprintSheetGid: 3,
  });
  await app.restart();
  await openSettings(app.page);
  await expect(app.page.locator("#cfg-sheet")).toHaveValue("attendance-test");
  await expect(app.page.locator("#cfg-gid")).toHaveValue("8");
});

test("invalid gid is rejected without saving", async ({ app }) => {
  const before = await readFile(app.configPath, "utf8");
  await openSettings(app.page);
  await app.page.locator("#cfg-gid").fill("-1");
  await app.page.locator("#save").click();
  await expect(app.page.locator("#error")).toContainText("Sheet gid must be a number.");
  await expect(app.page.locator("#config")).toBeVisible();
  expect(await readFile(app.configPath, "utf8")).toBe(before);
});

test("account settings offer file import without a raw key text field", async ({ app }) => {
  const before = await readFile(app.configPath, "utf8");
  await openSettings(app.page);
  await app.page.locator("#settings-account-tab").click();
  await expect(app.page.locator("#import-account")).toBeVisible();
  await expect(app.page.locator("#cfg-key")).toHaveCount(0);
  await expect(app.page.locator("#account-status")).toContainText("external key");
  expect(await readFile(app.configPath, "utf8")).toBe(before);
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

test("fingerprint deletion confirmation can be canceled three ways without a sheet write", async ({ app }) => {
  await openSettings(app.page);
  const before = app.sheets.requests.length;
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
  expect(app.sheets.requests.slice(before).filter((request) => request.method === "POST" || request.method === "PUT")).toEqual([]);
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(1);
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

