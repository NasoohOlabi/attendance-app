import { generateKeyPairSync } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures/app.mjs";

async function accountFile(root, email = "import-test@example.invalid") {
  const file = path.join(root, "account-import.json");
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  await writeFile(file, JSON.stringify({ type: "service_account", client_email: email, private_key: privateKey }));
  return { file, privateKey };
}

async function pick(app, file, canceled = false) {
  await app.electron.evaluate(({ dialog }, input) => {
    dialog.showOpenDialog = async () => ({ canceled: input.canceled, filePaths: input.canceled ? [] : [input.file] });
  }, { file, canceled });
}

async function accountPage(app) {
  await app.page.locator("#settings").click();
  await app.page.locator("#settings-account-tab").click();
  await expect(app.page.locator("#settings-account")).toBeVisible();
  await expect(app.page.locator("#save")).toBeHidden();
}

test("service account import uses Windows encryption and survives restart without the source file", async ({ app }) => {
  await app.ready();
  const imported = await accountFile(app.root);
  await accountPage(app);
  await pick(app, imported.file);
  await app.page.locator("#import-account").click();
  await expect(app.page.locator("#account-status")).toHaveText("Service account imported and encrypted.");
  await expect(app.page.locator("#account-email")).toHaveText("import-test@example.invalid");
  const encryptedFile = path.join(app.home, "Masjid/v1/config/service-account.enc");
  await expect(app.page.locator("#account-location")).toHaveText(encryptedFile);
  const bytes = await readFile(encryptedFile);
  expect(bytes.includes(Buffer.from(imported.privateKey))).toBe(false);
  expect(bytes.includes(Buffer.from("import-test@example.invalid"))).toBe(false);
  const config = JSON.parse(await readFile(app.configPath, "utf8"));
  expect(config.serviceAccountJson).toBe("");
  expect(JSON.stringify(await app.state())).not.toContain("private_key");
  expect(JSON.stringify(await app.state())).not.toContain(imported.privateKey);
  await rm(imported.file);
  await app.restart();
  await app.ready();
  await accountPage(app);
  await expect(app.page.locator("#account-email")).toHaveText("import-test@example.invalid");
  await app.page.locator("#settings-general-tab").click();
  await app.page.locator("#lang-ar").click();
  await app.page.locator("#settings-account-tab").click();
  await expect(app.page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(app.page.locator("#account-status")).toHaveText("استُورد حساب الخدمة وحُفظ مشفّرًا.");
});

test("cancelled and invalid imports preserve the encrypted account", async ({ app }) => {
  await app.ready();
  const imported = await accountFile(app.root);
  await accountPage(app);
  await pick(app, imported.file, true);
  await app.page.locator("#import-account").click();
  await expect(app.page.locator("#import-account")).toBeEnabled();
  expect((await app.state()).config.serviceAccount.status).toBe("external");
  await pick(app, imported.file);
  await app.page.locator("#import-account").click();
  await expect(app.page.locator("#account-status")).toHaveText("Service account imported and encrypted.");
  const encryptedFile = path.join(app.home, "Masjid/v1/config/service-account.enc");
  const before = await readFile(encryptedFile);
  await writeFile(imported.file, '{"private_key":"secret-text-that-must-not-be-displayed"');
  await app.page.locator("#import-account").click();
  await expect(app.page.locator("#error")).toHaveText("Choose a valid Google service-account JSON file with its private key.");
  expect(await readFile(encryptedFile)).toEqual(before);
  expect(JSON.stringify(await app.state())).not.toContain("secret-text-that-must-not-be-displayed");
  await writeFile(encryptedFile, "damaged ciphertext");
  await app.restart();
  await accountPage(app);
  await expect(app.page.locator("#account-status")).toHaveText("The saved account cannot be opened. Import it again for this Windows user.");
});
