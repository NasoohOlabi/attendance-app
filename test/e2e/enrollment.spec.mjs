import { test, expect } from "./fixtures/app.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const id1 = "00 00 000 005";
const id2 = "00 00 000 006";

async function captureUnknown(app, template = "new-print") {
  app.enqueue({ template });
  await expect(app.page.locator("#pending")).toBeVisible();
}

async function chooseStudent(app, id) {
  await app.page.locator("#search").fill("Website");
  const choice = app.page.locator("#list li button").filter({ hasText: id });
  await expect(choice).toHaveCount(1);
  await choice.click();
  await expect(app.page.locator("#ready")).toBeVisible();
}

async function addScans(app, templates) {
  await app.page.locator("#more-scans").click();
  for (const template of templates) app.enqueue({ template });
  await expect(app.page.locator("#enroll-done")).toHaveText(`Done · ${templates.length + 1} scans`);
}

test("assigning an unknown print links the Bouty student and matches it later", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "first-capture");
  await chooseStudent(app, id1);

  const index = await app.index();
  expect(index.students[id1]).toMatchObject({ studentId: id1, templateFile: "s-00-00-000-005.txt" });
  expect(await readFile(path.join(app.prints, "templates", index.students[id1].templateFile), "utf8")).toBe("first-capture");

  app.enqueue({ template: "recognized-second-capture", matchSid: "s-00-00-000-005", score: 18 });
  await expect(app.page.locator("#last-name")).toHaveText("Website Student");
  await expect(app.page.locator("#today-count")).toHaveText("1");
});

test("a second assignment adds a print and keeps the first", async ({ app }) => {
  await app.ready();
  await app.seedPrint(id1, "أحمد طالب");
  await captureUnknown(app, "second-capture");
  await app.page.locator("#search").fill("Website");
  const choice = app.page.locator("#list li button").filter({ hasText: id1 });
  await expect(choice).toContainText("1 print");
  await expect(choice).not.toContainText("replace");
  await choice.click();
  await expect(app.page.locator("#ready")).toBeVisible();

  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005.txt"), "utf8")).toBe("synthetic-print");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005--2.txt"), "utf8")).toBe("second-capture");
  expect((await app.index()).students[id1].templateFile).toBe("s-00-00-000-005.txt");
});

test("Done saves three kept scans as separate files locally", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "primary");
  await addScans(app, ["extra-one", "extra-two"]);
  await app.page.locator("#enroll-done").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  await chooseStudent(app, id1);

  const names = (await app.files()).sort();
  expect(names).toEqual(["s-00-00-000-005--2.txt", "s-00-00-000-005--3.txt", "s-00-00-000-005.txt"]);
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005.txt"), "utf8")).toBe("primary");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005--2.txt"), "utf8")).toBe("extra-one");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005--3.txt"), "utf8")).toBe("extra-two");
});

test("Rescan replaces only the latest kept capture", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "keep-first");
  await addScans(app, ["discard-latest"]);
  await app.page.locator("#enroll-done").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  await app.page.locator("#rescan").click();
  await expect(app.page.locator("#enroll-done")).toHaveText("Done · 1 scan");

  app.enqueue({ template: "keep-replacement" });
  await expect(app.page.locator("#enroll-done")).toHaveText("Done · 2 scans");
  await app.page.locator("#enroll-done").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  await chooseStudent(app, id1);

  expect(await app.files()).toEqual(expect.arrayContaining(["s-00-00-000-005.txt", "s-00-00-000-005--2.txt"]));
  expect(await app.files()).toHaveLength(2);
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-005--2.txt"), "utf8")).toBe("keep-replacement");
  expect(await app.files()).not.toContain("s-00-00-000-005--3.txt");
});

test("unassigned scans collected after More are dropped when the app restarts", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "first-kept-scan");
  await app.page.locator("#more-scans").click();
  app.enqueue({ template: "second-kept-scan" });
  await expect(app.page.locator("#enroll-done")).toHaveText("Done · 2 scans");
  expect(await app.files()).toEqual([]);

  await app.restart();
  await app.ready();
  await expect(app.page.locator("#pending")).toBeHidden();
  expect(await app.files()).toEqual([]);
  expect((await app.index()).pending).toBeNull();
});

test("cancel confirmation drops pending scans and keeps prints already enrolled", async ({ app }) => {
  await app.ready();
  await app.seedPrint(id1, "\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628");
  await captureUnknown(app, "waiting-to-assign");
  const priorFiles = await app.files();

  await app.page.locator("#discard-scans").click();
  await expect(app.page.locator("#confirm")).toBeVisible();
  await app.page.locator("#confirm-cancel").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  expect(await app.files()).toEqual(priorFiles);

  await app.page.locator("#discard-scans").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#ready")).toBeVisible();
  expect(await app.files()).toEqual(priorFiles);
  expect((await app.index()).pending).toBeNull();
});

test("deleting one student's fingerprints preserves the other student's local files", async ({ app }) => {
  await app.seedPrint(id1, "Website Student");
  await app.seedPrint(id2, "Second Student");
  await app.page.locator("#prints-nav").click();
  const row = app.page.locator("#prints-list li").filter({ hasText: "Second Student" });
  await row.getByRole("button").click();
  await app.page.locator("#confirm-ok").click();
  await expect.poll(app.files).toEqual(["s-00-00-000-005.txt"]);
  expect((await app.index()).students[id2]).toMatchObject({ templateFile: "", capturedAt: "" });
  expect(app.sheets.requests).toEqual([]);
});
