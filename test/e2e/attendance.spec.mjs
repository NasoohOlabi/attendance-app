import { test, expect } from "./fixtures/app.mjs";

const id = "00 00 000 001";
const checkboxWrite = (options) => options.data?.requests?.some((request) => request.updateCells?.start?.rowIndex >= 2);
const logAppend = (options) => options.url.includes("AttendanceLog") && options.url.includes(":append");

test("idle sync ticks and student searches do not reread the sheet", async ({ app }) => {
  await app.ready();
  const before = app.sheets.requests.length;
  await app.page.waitForTimeout(2500);
  expect(app.sheets.requests).toHaveLength(before);
  app.enqueue({ template: "new-print", score: 0 });
  await expect(app.page.locator("#pending")).toBeVisible();
  const loaded = app.sheets.requests.length;
  await app.page.locator("#search").fill("طالب");
  await app.page.waitForTimeout(10500);
  await app.page.locator("#search").fill("أحمد");
  await app.page.waitForTimeout(500);
  expect(app.sheets.requests).toHaveLength(loaded);
});

async function known(app, studentId = id) {
  await app.ready();
  await app.seedPrint(studentId);
  await app.mark(studentId);
  await expect(app.page.locator("#today-count")).toHaveText("1");
}

test("attendance matches by id and deduplicates repeated scans with identical names", async ({ app }) => {
  await known(app);
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
  const cell = app.sheets.grid("Info").cells.get("2,2");
  expect(cell.dataValidation).toEqual({ condition: { type: "BOOLEAN", values: [{ userEnteredValue: "حاضر" }] }, strict: true, showCustomUi: true });
  expect(app.sheets.grid("AttendanceLog").rows[1]).toEqual([id, "أحمد طالب", "12/10/2026 16:55:00"]);
  const captures = app.captures.filter((item) => item.type === "exited").length;
  await app.mark();
  await expect.poll(() => app.captures.filter((item) => item.type === "exited").length).toBeGreaterThan(captures);
  await app.seedPrint("00 00 000 002");
  await app.mark("00 00 000 002");
  await expect(app.page.locator("#today-count")).toHaveText("2");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(3);
  expect(app.sheets.grid("AttendanceLog").rows.map((row) => row[0])).toEqual(["الطالب", id, "00 00 000 002"]);
  await expect(app.page.locator("#pending")).toBeHidden();
});

test("attendance undo clears only the selected value and keeps its checkbox and other days", async ({ app }) => {
  app.sheets.grid("Info").rows[2][3] = "حاضر";
  app.sheets.grid("AttendanceLog").rows.push([id, "أحمد طالب", "11/10/2026 16:55:00"]);
  await known(app);
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(3);
  await app.page.locator("#today-list .today-undo").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#today-count")).toHaveText("0");
  await expect.poll(() => app.sheets.grid("Info").rows[2][2]).toBe("");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  expect(app.sheets.grid("Info").rows[2][3]).toBe("حاضر");
  expect(app.sheets.grid("Info").cells.get("2,2").dataValidation.showCustomUi).toBe(true);
  expect(app.sheets.grid("AttendanceLog").rows[1][2]).toBe("11/10/2026 16:55:00");
  expect(app.sheets.requests.filter((options) => options.url.includes("attendance-test") && options.url.includes(":clear"))).toEqual([]);
});

test("attendance clock edit rewrites the matching log stamp without changing its date or cell", async ({ app }) => {
  await known(app);
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  const time = app.page.locator("#today-list input[type=time]");
  await time.fill("17:10");
  await time.dispatchEvent("change");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows[1][2]).toBe("12/10/2026 17:10:00");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
  expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(2);
  await expect(time).toHaveValue("17:10");
});

test("outbox immediately shows offline marks, survives restart, and drains once", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  app.sheets.offline = true;
  await app.mark();
  await expect(app.page.locator("#today-count")).toHaveText("1");
  await expect(app.page.locator("#sync")).toHaveText("Waiting to sync");
  await expect.poll(async () => (await app.outbox()).items.length).toBe(1);
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
  await app.restart();
  await expect(app.page.locator("#today-count")).toHaveText("1");
  app.sheets.offline = false;
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
});

test("outbox undo before transmission cancels the queued mark and clock edit", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  app.sheets.offline = true;
  await app.mark();
  await expect(app.page.locator("#today-count")).toHaveText("1");
  await expect.poll(async () => (await app.outbox()).items.length).toBe(1);
  await app.page.locator("#today-list input[type=time]").fill("17:10");
  await app.page.locator("#today-list input[type=time]").dispatchEvent("change");
  await app.page.locator("#today-list .today-undo").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#today-count")).toHaveText("0");
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  app.sheets.offline = false;
  await app.restart();
  await app.ready();
  expect(app.sheets.grid("AttendanceLog").rows).toEqual([["الطالب", "إسم", "حضور"]]);
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
});

test("outbox resumes a cell-success log-failure without duplicating the attendance write", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  const gate = app.block(logAppend);
  await app.mark();
  await gate.waiting;
  await expect.poll(async () => (await app.outbox()).items[0]?.cell).toBe(true);
  app.sheets.offline = true;
  gate.release();
  await app.restart();
  app.sheets.offline = false;
  app.enqueue({ exitCode: 2, error: "timeout", events: [] });
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  expect(app.sheets.requests.filter(checkboxWrite)).toHaveLength(1);
});

test("outbox log append acknowledgement loss reconciles an accepted row", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  const request = app.sheets.request.bind(app.sheets);
  let lost = false;
  app.sheets.request = async (options) => {
    const result = await request(options);
    if (logAppend(options) && !lost) {
      lost = true;
      throw new Error("socket hang up");
    }
    return result;
  };
  await app.mark();
  await expect.poll(() => lost).toBe(true);
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  expect(app.sheets.grid("AttendanceLog").rows).toEqual([["الطالب", "إسم", "حضور"], [id, "أحمد طالب", "12/10/2026 16:55:00"]]);
});

test("outbox log failure preserves present cell and reports the missing time log", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  const error = new Error("protected range");
  error.response = { status: 400, data: { error: "protected range" } };
  app.sheets.failNext = { predicate: logAppend, error };
  await app.mark();
  await expect(app.page.locator("#detail")).toContainText("Marked present. The time log was not written.");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
  expect(app.sheets.grid("AttendanceLog").rows).toHaveLength(1);
  await expect(app.page.locator("#today-count")).toHaveText("1");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  expect(app.sheets.requests.filter(checkboxWrite)).toHaveLength(1);
});

for (const status of [400, 403, 500]) {
  test(`outbox retains a failed log (${status}) across restart and retries automatically`, async ({ app }) => {
    await app.ready();
    await app.seedPrint();
    const request = app.sheets.request.bind(app.sheets);
    let failing = true;
    let failures = 0;
    app.sheets.request = async (options) => {
      if (failing && logAppend(options)) {
        failures++;
        const error = new Error("log unavailable");
        error.response = { status, data: { error: "log unavailable" } };
        throw error;
      }
      return request(options);
    };
    await app.mark();
    await expect.poll(() => failures).toBeGreaterThan(0);
    await expect(app.page.locator("#today-count")).toHaveText("1");
    await expect.poll(async () => (await app.outbox()).items[0]).toMatchObject({ studentId: id, cell: true, log: false });
    const beforeRestart = failures;
    await app.restart();
    await expect(app.page.locator("#today-count")).toHaveText("1");
    await expect.poll(() => failures).toBeGreaterThan(beforeRestart);
    failing = false;
    app.enqueue({ exitCode: 2, error: "timeout", events: [] });
    await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBe(2);
    await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
    await expect(app.page.locator("#today-count")).toHaveText("1");
    expect(app.sheets.requests.filter(checkboxWrite)).toHaveLength(1);
  });
}

test("outbox keeps the saved student visible while the sheet reload is delayed", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  const append = app.block(logAppend);
  await app.mark();
  await append.waiting;
  const reload = app.block((options) => options.url.includes("Info") && options.url.includes("/values/"));
  append.release();
  await reload.waiting;
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  await expect(app.page.locator("#today-count")).toHaveText("1");
  reload.release();
});

test("outbox undo during a delayed cell write does not lose the next student's mark", async ({ app }) => {
  await app.ready();
  await app.seedPrint();
  await app.seedPrint("00 00 000 002");
  const gate = app.block(checkboxWrite);
  await app.mark();
  await gate.waiting;
  await app.page.locator("#today-list .today-undo").click();
  await app.page.locator("#confirm-ok").click();
  await app.mark("00 00 000 002");
  await expect.poll(async () => (await app.outbox()).items.some((item) => item.studentId === "00 00 000 002")).toBe(true);
  gate.release();
  await expect.poll(async () => (await app.outbox()).items.length).toBe(0);
  await expect.poll(() => app.sheets.grid("Info").rows[2][2]).toBe("");
  expect(app.sheets.grid("Info").rows[3][2]).toBe("حاضر");
  expect(app.sheets.grid("AttendanceLog").rows.map((row) => row[0])).toEqual(["الطالب", "00 00 000 002"]);
});
