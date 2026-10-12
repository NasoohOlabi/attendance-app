import { test, expect } from "./fixtures/app.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("a saved pending print is offered for assignment after restart", async ({ app }) => {
  await app.ready();
  app.enqueue({ template: "single-pending-restore" });
  await expect(app.page.locator("#pending")).toBeVisible();
  await expect(app.page.locator("#list button")).toHaveCount(3);
  await app.restart();
  await expect(app.page.locator("#pending")).toBeVisible();
  await expect(app.page.locator("#list button")).toHaveCount(3);
  expect(await readFile(path.join(app.prints, "pending.txt"), "utf8")).toBe("single-pending-restore");
  expect((await app.index()).pending).toMatchObject({ capturedAt: "2026-10-12T13:55:03.000Z" });
});

