import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures/app.mjs";

test("startup discards a test enrollment left by an abrupt exit", async ({ app }) => {
  await app.ready();
  await app.page.locator("#settings").click();
  await app.page.locator("#test-mode").click();
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await expect(app.page.locator("#test-mode-indicator")).toBeVisible();
  await expect(app.page.locator("#ready")).toBeVisible();

  app.enqueue({ template: "practice-pending" });
  await expect(app.page.locator("#pending")).toBeVisible();
  const { fingerprintDir } = await app.state();
  expect(fingerprintDir).not.toBe(app.prints);
  expect(await readFile(path.join(fingerprintDir, "pending.txt"), "utf8")).toBe("practice-pending");
  await expect(access(path.join(app.prints, "pending.txt"))).rejects.toMatchObject({ code: "ENOENT" });

  await app.restart({ abrupt: true });
  await expect(app.page.locator("#ready")).toBeVisible();
  await expect(app.page.locator("#pending")).toBeHidden();
  await expect(app.page.locator("#test-mode-indicator")).toBeHidden();
  expect((await app.state()).fingerprintDir).toBe(app.prints);
  expect((await app.index()).pending).toBeNull();
  await expect(access(fingerprintDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("starting test mode preserves an unfinished live enrollment", async ({ app }) => {
  await app.ready();
  app.enqueue({ template: "live-pending" });
  await expect(app.page.locator("#pending")).toBeVisible();
  const originalIndex = await app.index();
  await app.page.locator("#settings").click();
  await app.page.locator("#test-mode").click();
  await expect(app.page.locator("#error")).toContainText("Finish or discard");
  await expect(app.page.locator("#test-mode")).not.toBeChecked();
  await app.page.locator("#cancel").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  expect((await app.state()).testMode).toBe(false);
  expect(await app.index()).toEqual(originalIndex);
  expect(await readFile(path.join(app.prints, "pending.txt"), "utf8")).toBe("live-pending");
});
