import { test, expect } from "./fixtures/app.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("smoke uses the real preload and isolated built Electron app", async ({ app }) => {
  await app.ready();
  const state = await app.state();
  expect(state.phase).toBe("ready");
  expect(state.fingerprintDir).toBe(app.prints);
  expect(state.present).toEqual([]);
  const profile = await app.electron.evaluate(({ app }) => app.getPath("userData"));
  expect(profile).toBe(path.join(app.root, "appdata/attendance-service"));
  await expect(app.page.locator("#place")).toHaveAttribute("data-cue", "now");
  const log = await readFile(path.join(app.home, "Masjid/logs/attendance-2026-10-12.log"), "utf8");
  expect(log).toContain("attendance window open");
  expect(app.sheets.requests.length).toBeGreaterThan(0);
});

test.describe("missing scanner", () => {
test.use({ fixtureOptions: { config: { zk4500Cli: "Z:/missing-test-scanner.exe" } } });
test("smoke keeps settings reachable when the scanner path is missing", async ({ app }) => {
  const state = await app.state();
  await expect(app.page.locator("#detail")).toContainText("Scanner CLI not found");
  expect(app.captures).toEqual([]);
  await app.page.locator("#settings").click();
  await expect(app.page.locator("#config")).toBeVisible();
  expect(await app.page.locator("#cfg-dir").textContent()).toBe(state.fingerprintDir);
  await app.page.locator("#cancel").click();
  await expect(app.page.locator("#ready")).toBeVisible();
});
});
