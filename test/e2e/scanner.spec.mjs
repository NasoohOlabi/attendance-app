import { test, expect } from "./fixtures/app.mjs";

test("score seven opens enrollment, while score eight matches even when the scanner exits one", async ({ app }) => {
  await app.ready();
  await app.seedPrint("00 00 000 001", "Ahmed Student");
  await app.restart();
  await app.ready();

  app.enqueue({ matchSid: "s-00-00-000-001", score: 7 });
  await expect(app.page.locator("#pending")).toBeVisible();
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");
  await app.page.locator("#discard-scans").click();
  await app.page.locator("#confirm-ok").click();
  await expect(app.page.locator("#ready")).toBeVisible();

  app.enqueue({ matchSid: "s-00-00-000-001", score: 8, exitCode: 1 });
  await expect(app.page.locator("#last-name")).toHaveText("\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628");
  await expect(app.page.locator("#today-count")).toHaveText("1");
  await expect(app.page.locator("#pending")).toBeHidden();
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
});

test("fragmented UTF-8 scanner output still identifies an Arabic roster name", async ({ app }) => {
  await app.ready();
  const name = "\u0633\u0644\u0645\u0649 \u0637\u0627\u0644\u0628\u0629";
  await app.seedPrint("00 00 000 003", name);
  await app.restart();
  await app.ready();

  app.enqueue({ matchSid: "s-00-00-000-003", score: 24, fragmentUtf8: true });
  await expect(app.page.locator("#last-name")).toHaveText(name);
  await expect(app.page.locator("#last-name")).toHaveAttribute("dir", "auto");
  await expect(app.page.locator("#trace")).toContainText(`Matched ${name}`);
  await expect(app.page.locator("#today-list .today-name")).toHaveText(name);
  expect(app.sheets.grid("Info").rows[4][2]).toBe("حاضر");
});

test("a timed-out capture neither marks attendance nor opens enrollment, and the next capture works", async ({ app }) => {
  await app.ready();
  await app.seedPrint("00 00 000 001", "Ahmed Student");
  await app.restart();
  await app.ready();

  app.enqueue({ error: "timeout", exitCode: 2 });
  await expect.poll(() => app.captures.filter((capture) => capture.type === "exited")).toHaveLength(1);
  expect(app.captures.find((capture) => capture.type === "exited").exitCode).toBe(2);
  await expect(app.page.locator("#pending")).toBeHidden();
  await expect(app.page.locator("#today-count")).toHaveText("0");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("");

  app.enqueue({ matchSid: "s-00-00-000-001", score: 20 });
  await expect(app.page.locator("#last-name")).toHaveText("\u0623\u062d\u0645\u062f \u0637\u0627\u0644\u0628");
  await expect(app.page.locator("#today-count")).toHaveText("1");
  expect(app.sheets.grid("Info").rows[2][2]).toBe("حاضر");
});

test("the print protocol serves the current capture and rejects an unknown slot", async ({ app }) => {
  await app.ready();
  app.enqueue({ template: "protocol-image-check" });
  await expect(app.page.locator("#pending")).toBeVisible();

  await expect.poll(() => app.page.locator("#prints-pending img").evaluate((image) => image.naturalWidth)).toBe(1);
  const missing = await app.electron.evaluate(async ({ net }) => {
    const response = await net.fetch("print://scan/999.jpg");
    return { status: response.status, body: await response.text() };
  });
  expect(missing).toEqual({ status: 404, body: "Not found" });
});

test.describe("scanner watchdog", () => {
  test.use({ fixtureOptions: { config: { scanTimeoutSeconds: 1 } } });
  test("a hung fake capture respects both timeout windows before the host stops it", async ({ app }) => {
    await app.ready();
    app.enqueue({ hangMs: 10_000 });
    await expect.poll(() => app.captures.filter((capture) => capture.type === "started").length).toBe(1);
    const started = app.captures.find((capture) => capture.type === "started").at;
    await expect(app.page.locator("#trace")).toContainText("Took too long");
    expect(Date.now() - started).toBeGreaterThanOrEqual(6_900);
    await expect(app.page.locator("#pending")).toBeHidden();
    await expect(app.page.locator("#today-count")).toHaveText("0");
    expect(app.sheets.grid("AttendanceLog").rows).toEqual([["الطالب", "إسم", "حضور"]]);
  });
});
