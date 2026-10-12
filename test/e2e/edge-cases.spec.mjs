import { test, expect } from "./fixtures/app.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const id = "00 00 000 001";
const name = "\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628";
const infoRead = (options) => options.url.includes("attendance-test") && options.method !== "POST" && options.method !== "PUT";

test.describe("duplicate roster id", () => {
  test.use({ fixtureOptions: { sheets: { students: [[name, id], [name, id]] } } });

  test("refuses attendance and time-log writes", async ({ app }) => {
    await app.ready();
    await app.seedPrint(id, name);
    await app.mark(id);

    await expect(app.page.locator("#error")).toContainText("more than once");
    expect(app.sheets.grid("Info").rows[2][2] || "").toBe("");
    expect(app.sheets.grid("Info").rows[3][2] || "").toBe("");
    expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
    expect(app.sheets.requests.filter((request) => request.method === "POST" || request.method === "PUT")).toEqual([]);
  });
});

test("a roster student without an id can match locally but cannot be marked present", async ({ app }) => {
  app.sheets.grid("Info").rows[2][1] = "";
  await app.ready();
  const index = await app.index();
  index.students[`name:${name.toLowerCase()}`] = {
    studentId: "",
    studentName: name,
    templateFile: "s-ahmed-student.txt",
    capturedAt: "2026-10-12T13:55:03.000Z",
  };
  await writeFile(path.join(app.prints, "templates", "s-ahmed-student.txt"), "synthetic-print");
  await writeFile(path.join(app.prints, "index.json"), JSON.stringify(index));
  app.enqueue({ matchSid: "s-ahmed-student" });

  await expect(app.page.locator("#detail")).toContainText("no id");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
  expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
  expect(app.sheets.requests.filter((request) => request.method === "POST" || request.method === "PUT")).toEqual([]);
});

test("undo after a roster reorder clears the selected id after sync resumes", async ({ app }) => {
  await app.ready();
  await app.seedPrint(id, name);
  await app.mark(id);
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);

  app.sheets.offline = true;
  await app.page.locator("#today-list .today-undo").click();
  await app.page.locator("#confirm-ok").click();
  [app.sheets.grid("Info").rows[2], app.sheets.grid("Info").rows[3]] = [
    app.sheets.grid("Info").rows[3],
    app.sheets.grid("Info").rows[2],
  ];
  app.sheets.offline = false;
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });

  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  expect(app.sheets.grid("Info").rows[2][1]).toBe("00 00 000 002");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
  expect(app.sheets.grid("Info").rows[3][1]).toBe(id);
  expect(app.sheets.grid("Info").rows[3][2]).toBe("");
  expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
});

test("log without a name column appends only id and the exact Damascus stamp", async ({ app }) => {
  app.sheets.grid("AttendanceLog").rows[0] = ["\u0627\u0644\u0637\u0627\u0644\u0628", "\u062d\u0636\u0648\u0631"];
  await app.ready();
  await app.seedPrint(id, name);
  await app.mark(id);

  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  expect(app.sheets.grid("AttendanceLog").rows[1]).toEqual([id, "12/10/2026 16:55:00"]);
});

test.describe("without a configured time log", () => {
  test.use({ fixtureOptions: { config: { logSpreadsheetId: "" } } });

  test("clock edits report the missing log configuration without appending", async ({ app }) => {
    await app.ready();
    await app.seedPrint(id, name);
    await app.mark(id);
    await expect(app.page.locator("#today-count")).toHaveText("1");
    await expect.poll(() => app.sheets.grid("Info").rows[2][2]).toBe("\u062d\u0627\u0636\u0631");

    const time = app.page.locator("#today-list input[type=time]");
    await time.fill("17:10");
    await time.dispatchEvent("change");
    await expect(app.page.locator("#error")).toContainText("time log");
    expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
    expect(app.sheets.requests.filter((request) => request.url.includes("AttendanceLog") && request.url.includes(":append"))).toEqual([]);
  });
});

test("search keeps its cached names visible while the throttled roster read is pending", async ({ app }) => {
  await app.ready();
  const gate = app.block(infoRead);
  app.enqueue({ template: "unknown-print" });
  await gate.waiting;
  await expect(app.page.locator("#list li button")).toHaveCount(3);
  await expect(app.page.locator("#list")).toContainText(name);
  await app.page.locator("#search").fill("أحمد");
  await expect(app.page.locator("#list li button")).toHaveCount(2);
  await app.page.locator("#search").fill("");
  await expect(app.page.locator("#list li button")).toHaveCount(3);
  expect(gate.hits).toBe(1);
  gate.release();
  await expect(app.page.locator("#list li button")).toHaveCount(3);
});
