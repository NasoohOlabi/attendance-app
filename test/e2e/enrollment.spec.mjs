import { test, expect } from "./fixtures/app.mjs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const id1 = "00 00 000 001";
const id2 = "00 00 000 002";

async function captureUnknown(app, template = "new-print") {
  app.enqueue({ template });
  await expect(app.page.locator("#pending")).toBeVisible();
}

async function chooseStudent(app, id) {
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

test("assigning an unknown print by id marks the right same-name student and matches it later", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "first-capture");
  await chooseStudent(app, id2);

  await expect.poll(() => app.sheets.grid("FingerPrints").rows).toHaveLength(2);
  expect(app.sheets.grid("FingerPrints").rows[1].slice(0, 2)).toEqual([id2, "first-capture"]);
  const index = await app.index();
  expect(index.students[id2]).toMatchObject({ studentId: id2, templateFile: "s-00-00-000-002.txt" });
  expect(await readFile(path.join(app.prints, "templates", index.students[id2].templateFile), "utf8")).toBe("first-capture");

  app.enqueue({ template: "recognized-second-capture", matchSid: "s-00-00-000-002", score: 18 });
  await expect(app.page.locator("#last-name")).toHaveText("\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628");
  await expect(app.page.locator("#today-count")).toHaveText("1");
  expect(app.sheets.grid("Info").rows[3][2]).toBe("حاضر");
  expect(app.sheets.grid("AttendanceLog").rows[1][0]).toBe(id2);
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(2);
});

test("Done saves three kept scans as separate files and sheet rows", async ({ app }) => {
  await app.ready();
  await captureUnknown(app, "primary");
  await addScans(app, ["extra-one", "extra-two"]);
  await app.page.locator("#enroll-done").click();
  await expect(app.page.locator("#pending")).toBeVisible();
  await chooseStudent(app, id1);

  const names = (await app.files()).sort();
  expect(names).toEqual(["s-00-00-000-001--2.txt", "s-00-00-000-001--3.txt", "s-00-00-000-001.txt"]);
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001.txt"), "utf8")).toBe("primary");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001--2.txt"), "utf8")).toBe("extra-one");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001--3.txt"), "utf8")).toBe("extra-two");
  await expect.poll(() => app.sheets.grid("FingerPrints").rows).toHaveLength(4);
  expect(app.sheets.grid("FingerPrints").rows.slice(1).map((row) => row[0])).toEqual([id1, id1, id1]);
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

  expect(await app.files()).toEqual(expect.arrayContaining(["s-00-00-000-001.txt", "s-00-00-000-001--2.txt"]));
  expect(await app.files()).toHaveLength(2);
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001--2.txt"), "utf8")).toBe("keep-replacement");
  expect(await app.files()).not.toContain("s-00-00-000-001--3.txt");
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
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(1);
});

test("fingerprint sheet append failure keeps the assigned local print", async ({ app }) => {
  await app.ready();
  app.sheets.failNextWith(new Error("offline"), (request) => request.url.includes("FingerPrints") && request.url.includes(":append"));
  await captureUnknown(app, "local-survives-upload-failure");
  await chooseStudent(app, id1);

  await expect(app.page.locator("#detail")).toContainText("fingerprint sheet was not written");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001.txt"), "utf8")).toBe("local-survives-upload-failure");
  expect((await app.index()).students[id1].templateFile).toBe("s-00-00-000-001.txt");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(1);
});

test("startup restores remote prints and retains local prints absent from the sheet", async ({ app }) => {
  await app.ready();
  await app.seedPrint(id2, "\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628");
  app.sheets.grid("FingerPrints").rows.push([id1, "restored-from-sheet", "12/10/2026 16:55:03"]);
  await app.restart();
  await app.ready();

  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-001.txt"), "utf8")).toBe("restored-from-sheet");
  expect(await readFile(path.join(app.prints, "templates", "s-00-00-000-002.txt"), "utf8")).toBe("synthetic-print");
  expect((await app.index()).students[id1].templateFile).toBe("s-00-00-000-001.txt");
  expect((await app.index()).students[id2].templateFile).toBe("s-00-00-000-002.txt");
});

test("fingerprint deletion preserves local files when the sheet fails, then clears remote before local", async ({ app }) => {
  await app.ready();
  await app.seedPrint(id1, "Ahmed Student");
  app.sheets.grid("FingerPrints").rows.push([id1, "synthetic-print", "12/10/2026 16:55:03"]);
  await app.restart();
  await app.ready();
  const beforeAttendance = structuredClone(app.sheets.grid("Info").rows);

  app.sheets.offline = true;
  await app.page.locator("#settings").click();
  await app.page.locator("#clear-prints").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#error")).toContainText("offline");
  expect(await app.files()).toContain("s-00-00-000-001.txt");
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(2);

  app.sheets.offline = false;
  await app.page.locator("#clear-prints").click();
  await app.page.locator("#confirm-ok").click();
  await expect.poll(() => app.files()).toEqual([]);
  expect(app.sheets.grid("FingerPrints").rows).toHaveLength(1);
  expect(app.sheets.grid("Info").rows).toEqual(beforeAttendance);
});
