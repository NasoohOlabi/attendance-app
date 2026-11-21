import { test, expect } from "./fixtures/app.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

test.use({ fixtureOptions: { signedIn: false, config: { attendanceDestination: "sheet", zk4500Cli: "Z:/missing-test-scanner.exe" } } });

async function signIn(app, username = "synthetic-user") {
  await app.page.locator("#bouty-user").fill(username);
  await app.page.locator("#bouty-password").fill("synthetic-password");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed in to Bouty");
}

test("Bouty sign-in persists and sign-out clears credentials across restart", async ({ app }) => {
  await app.page.locator("#settings").click();
  await app.page.locator("#bouty-user").fill("synthetic-user");
  await app.page.locator("#bouty-password").fill("incorrect");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#error")).toHaveText("Bouty login failed.");
  await signIn(app);
  const credentials = path.join(app.home, "Masjid/v1/config/bouty-account.enc");
  expect((await readFile(credentials)).includes(Buffer.from("synthetic-password"))).toBe(false);
  await app.restart();
  await app.page.locator("#settings").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed in to Bouty");
  await expect(app.page.locator("#bouty-password")).toBeHidden();
  await app.page.locator("#attendance").click();
  await app.page.locator("#mark-manual").click();
  await expect(app.page.locator("#manual-list")).toContainText("Website Student");
  await app.page.locator("#manual-list button").filter({ hasText: "Website Student" }).click();
  await expect(app.page.locator("#confirm")).toBeVisible();
  await app.page.locator("#confirm-cancel").click();
  await app.electron.evaluate(() => { globalThis.boutyTestExpired = true; });
  await app.page.locator("#bouty-roster-refresh").click();
  await expect(app.page.locator("#manual-list")).toContainText("Website Student");
  expect(await app.electron.evaluate(() => globalThis.boutyTestLogins)).toBe(2);
  await app.page.locator("#settings").click();
  await app.page.locator("#sign-out-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed out of Bouty");
  await expect.poll(() => app.electron.evaluate(() => globalThis.boutyTestLogouts)).toBe(1);
  await expect(readFile(credentials)).rejects.toMatchObject({ code: "ENOENT" });
  await app.restart();
  await app.page.locator("#settings").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed out of Bouty");
  await expect(app.page.locator("#bouty-password")).toHaveValue("");
  expect(await app.electron.evaluate(() => globalThis.boutyTestLogins)).toBe(0);
});

test("Bouty keeps offline attendance with the original account", async ({ app }) => {
  const file = path.join(app.home, "Masjid/v1/config/bouty-outbox.json");
  await app.page.locator("#settings").click();
  await signIn(app);
  await app.page.locator("#attendance").click();
  await app.electron.evaluate(() => { globalThis.boutyTestOffline = true; });
  await app.page.locator("#mark-manual").click();
  await app.page.locator("#manual-list button").filter({ hasText: "Website Student" }).click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#today-list")).toContainText("Website Student");
  await expect.poll(async () => JSON.parse(await readFile(file, "utf8")).items.length).toBe(1);
  await app.restart();
  await expect(app.page.locator("#today-list")).toContainText("Website Student");
  await expect.poll(() => app.electron.evaluate(() => globalThis.boutyTestAttendance.length)).toBe(1);

  await app.electron.evaluate(() => { globalThis.boutyTestOffline = true; });
  await app.page.locator("#today-list .today-undo").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#today-count")).toHaveText("0");
  await app.page.locator("#settings").click();
  await app.page.locator("#sign-out-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed out of Bouty");
  await app.electron.evaluate(() => { globalThis.boutyTestOffline = false; });
  await signIn(app, "synthetic-other");
  expect(await app.electron.evaluate(() => globalThis.boutyTestAttendance.length)).toBe(1);
  expect(JSON.parse(await readFile(file, "utf8")).items).toHaveLength(1);
  await app.page.locator("#sign-out-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed out of Bouty");
  await signIn(app);
  await expect.poll(() => app.electron.evaluate(() => globalThis.boutyTestAttendance.at(-1)?.status_id)).toBe(2);
});

test("Bouty roster can refresh, open a profile, and mark attendance on the website", async ({ app }) => {
  await app.page.locator("#settings").click();
  await app.page.locator("#bouty-user").fill("synthetic-user");
  await app.page.locator("#bouty-password").fill("synthetic-password");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed in to Bouty");
  await app.page.locator("#attendance").click();
  await app.page.locator("#mark-manual").click();
  const list = app.page.locator("#manual-list");
  await expect(list).toContainText("Website Student");
  await expect(list).toContainText("Another Student");
  await app.electron.evaluate(() => { globalThis.boutyTestName = "Refreshed Student"; });
  await app.page.locator("#bouty-roster-refresh").click();
  await expect(list).toContainText("Refreshed Student");
  await app.page.locator("#manual-search").fill("Refreshed");
  await list.getByRole("button").click();
  await expect(app.page.locator("#confirm-profile-fields")).toContainText("Website School");
  await expect(app.page.locator("#confirm-profile-fields")).toContainText("Website Group");
  await expect(app.page.locator("#confirm-name")).toHaveText("Website Student");
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#last-name")).toHaveText("Website Student");
  await expect.poll(() => app.electron.evaluate(() => globalThis.boutyTestAttendance)).toEqual([
    expect.objectContaining({ day_id: 22, entity_id: 31, status_id: 1 }),
  ]);
  await expect(app.page.locator("#today-list")).toContainText("Website Student");
  await expect(app.page.locator("#last-fields")).toContainText("Website School");
  expect(app.captures).toEqual([]);
  expect(await app.electron.evaluate(() => globalThis.boutyTestLogins)).toBe(1);
  expect(app.sheets.requests).toEqual([]);
});

test("saved Bouty students support offline enrollment and manual attendance after restart", async ({ app }) => {
  await app.page.locator("#settings").click();
  await signIn(app);
  await app.page.locator("#attendance").click();
  await app.page.locator("#mark-manual").click();
  await expect(app.page.locator("#manual-list")).toContainText("Another Student");
  const cache = path.join(app.home, "Masjid/v1/config/bouty-roster.enc");
  expect((await readFile(cache)).includes(Buffer.from("Website Student"))).toBe(false);
  await app.restart();
  await app.electron.evaluate(() => { globalThis.boutyTestDisconnected = true; });
  await app.page.locator("#mark-manual").click();
  await app.page.locator("#manual-list button").filter({ hasText: "Another Student" }).click();
  await expect(app.page.locator("#confirm-name")).toHaveText("Another Student");
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#today-list")).toContainText("Another Student");

  const index = await app.index();
  index.pending = { capturedAt: "2026-10-12T13:55:03.000Z" };
  await writeFile(path.join(app.prints, "index.json"), JSON.stringify(index));
  await writeFile(path.join(app.prints, "pending.txt"), "synthetic-offline-print");
  await app.restart();
  await app.electron.evaluate(() => { globalThis.boutyTestDisconnected = true; });
  await expect(app.page.locator("#pending")).toBeVisible();
  const students = app.page.locator("#list button");
  await expect(students).toHaveCount(2);
  await app.page.locator("#search").fill("Website");
  await expect(students).toHaveCount(1);
  await students.click();
  await expect(app.page.locator("#last-name")).toHaveText("Website Student");
  await expect(app.page.locator("#today-list")).toContainText("Website Student");
  expect(await app.files()).toContain("s-00-00-000-005.txt");
});

test("Bouty picker and scan card use website student information", async ({ app }) => {
  await app.page.locator("#settings").click();
  await app.page.locator("#bouty-user").fill("synthetic-user");
  await app.page.locator("#bouty-password").fill("synthetic-password");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#bouty-status")).toHaveText("Signed in to Bouty");
  const index = await readFile(path.join(app.prints, "index.json"), "utf8").then(JSON.parse).catch(() => ({ students: {} }));
  index.pending = { capturedAt: "2026-10-12T13:55:03.000Z" };
  await writeFile(path.join(app.prints, "index.json"), JSON.stringify(index));
  await writeFile(path.join(app.prints, "pending.txt"), "synthetic-print");
  await app.restart();
  await expect(app.page.locator("#pending")).toBeVisible();
  await app.page.locator("#search").fill("Website");
  await expect(app.page.locator("#list button")).toHaveCount(1);
  await expect(app.page.locator("#list button")).toContainText("Website Student");
  await app.page.locator("#list button").click();
  await expect(app.page.locator("#last-name")).toHaveText("Website Student");
  await expect(app.page.locator("#last-fields")).toContainText("Website School");
  expect(app.sheets.requests).toEqual([]);
});
