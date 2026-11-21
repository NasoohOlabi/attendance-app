import { test, expect } from "./fixtures/app.mjs";

const templateId = "s-00-00-000-005";

async function seedStudent(app) {
  await app.ready();
  await app.seedPrint();
  await app.restart();
  await app.ready();
}

test("a missing phone returns on rescan until Bouty confirms a saved number", async ({ app }) => {
  await seedStudent(app);
  const { page } = app;
  const warning = page.locator("#phone-warning");
  const prompt = page.getByRole("dialog", { name: "Phone number is missing" });
  const scan = () => app.enqueue({ matchSid: templateId });
  await app.electron.evaluate(() => {
    globalThis.boutyTestLinkedParent = true;
    globalThis.boutyTestStudentPhones[9] = "";
  });
  scan();
  await expect(page.locator("#last-name")).toHaveText("Website Student");
  await expect(prompt).toBeVisible();
  await expect(warning).toHaveCSS("background-color", "rgb(201, 0, 26)");
  await prompt.getByRole("button", { name: "Skip" }).click();
  await expect(prompt).toBeHidden();
  await expect(warning).toBeVisible();
  scan();
  await expect(prompt).toBeVisible();

  const number = prompt.getByLabel("Contact phone number");
  const save = prompt.getByRole("button", { name: "Save number" });
  await number.fill("invalid");
  await save.click();
  await expect(prompt.getByRole("alert")).toHaveText("Enter a valid phone number.");
  await number.fill("٠٩٩٣ ٠١٢ ٣٤٥");
  await app.electron.evaluate(() => { globalThis.boutyTestRejectPhone = true; });
  await save.click();
  await expect(prompt.getByRole("alert")).toHaveText("Could not save the phone number. Try again.");
  await app.electron.evaluate(() => { globalThis.boutyTestRejectPhone = false; });
  await save.click();
  await expect(prompt).toBeHidden();
  await expect(warning).toBeHidden();
  await expect(page.locator("#last-fields")).toContainText("+963993012345");
  expect(await app.electron.evaluate(() => globalThis.boutyTestPhoneWrites)).toEqual([{ id: 9, phone: "+963993012345" }]);
  const previousScan = (await app.state()).lastMatch.scanId;
  scan();
  await expect.poll(async () => (await app.state()).lastMatch.scanId).not.toBe(previousScan);
  await expect(page.locator("#last-fields")).toContainText("+963993012345");
  await expect(prompt).toBeHidden();
});

test("a linked parent's number alone is shown without a phone warning", async ({ app }) => {
  await seedStudent(app);
  await app.electron.evaluate(() => {
    globalThis.boutyTestLinkedParent = true;
    globalThis.boutyTestStudentPhones[9] = "";
    globalThis.boutyTestParentPhone = "2025550124";
  });
  app.enqueue({ matchSid: templateId });
  await expect(app.page.locator("#last-fields")).toContainText("2025550124");
  await expect(app.page.locator("#last-fields")).not.toContainText("2025550199");
  await expect(app.page.locator("#phone-warning")).toBeHidden();
  await expect(app.page.locator("#phone-prompt")).toBeHidden();
});

test("a phone entered in disposable test mode disappears when live scans resume", async ({ app }) => {
  await seedStudent(app);
  const { page } = app;
  const prompt = page.locator("#phone-prompt");
  await app.electron.evaluate(() => { globalThis.boutyTestStudentPhones[9] = ""; });
  async function switchMode(enabled) {
    await page.locator("#settings").click();
    await page.getByRole("switch", { name: "Test mode" }).click();
    app.enqueue({ exitCode: 2, error: "timeout", events: [] });
    await expect(page.locator("#test-mode-indicator")).toBeVisible({ visible: enabled });
    await expect(page.locator("#ready")).toBeVisible();
  }
  await switchMode(true);
  app.enqueue({ matchSid: templateId });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Contact phone number").fill("+1 202 555 0125");
  await prompt.getByRole("button", { name: "Save number" }).click();
  await expect(page.locator("#last-fields")).toContainText("2025550125");
  await expect(prompt).toBeHidden();
  expect(await app.electron.evaluate(() => globalThis.boutyTestPhoneWrites)).toEqual([]);
  await switchMode(false);
  app.enqueue({ matchSid: templateId });
  await expect(prompt).toBeVisible();
  await expect(page.locator("#last-fields")).not.toContainText("2025550125");
});
