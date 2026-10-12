import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCredentialStore, credentialFile } from "../../src/credentials.mjs";
import { createGoogle } from "../../src/google.mjs";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
const account = { type: "service_account", client_email: "fixture@example.invalid", private_key: privateKey, token_uri: "https://example.invalid/ignored" };

function encryption() {
  const key = randomBytes(32);
  return {
    async isAsyncEncryptionAvailable() { return true; },
    async encryptStringAsync(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(buffer) {
      const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"), shouldReEncrypt: false };
    },
  };
}

test("an imported account is encrypted beside fingerprints and survives reopening", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "attendance-credentials-"));
  const source = path.join(root, "import.json");
  const file = credentialFile(path.join(root, "fingerprints"));
  const osEncryption = encryption();
  await writeFile(source, JSON.stringify(account));
  const store = createCredentialStore({ file, encryption: osEncryption, platform: "win32" });
  assert.deepEqual(await store.importFile(source), { email: "fixture@example.invalid" });
  const bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from(privateKey)), false);
  assert.equal(bytes.includes(Buffer.from(account.client_email)), false);
  const reopened = createCredentialStore({ file, encryption: osEncryption, platform: "win32" });
  const loaded = await reopened.read();
  assert.equal(loaded.private_key, privateKey);
  assert.equal(loaded.token_uri, undefined);
  assert.equal((await createGoogle({}, loaded)).email, account.client_email);
  assert.equal((await readdir(path.dirname(file))).length, 1);
});

test("invalid imports, unavailable encryption and damaged ciphertext keep secrets off disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "attendance-credentials-"));
  const source = path.join(root, "import.json");
  const file = credentialFile(path.join(root, "fingerprints"));
  const osEncryption = encryption();
  const store = createCredentialStore({ file, encryption: osEncryption, platform: "win32" });
  assert.equal(await store.read(), null);
  await writeFile(source, JSON.stringify(account));
  await store.importFile(source);
  const original = await readFile(file);
  await writeFile(source, '{"private_key":"secret text must not appear in errors"');
  await assert.rejects(store.importFile(source), /Choose a valid Google/);
  assert.deepEqual(await readFile(file), original);
  await writeFile(source, JSON.stringify(account));
  const unavailable = createCredentialStore({ file, encryption: { ...osEncryption, async isAsyncEncryptionAvailable() { return false; } }, platform: "win32" });
  await assert.rejects(unavailable.importFile(source), /secure storage is unavailable/);
  assert.deepEqual(await readFile(file), original);
  const failing = createCredentialStore({ file, encryption: { ...osEncryption, async encryptStringAsync() { throw new Error(privateKey); } }, platform: "win32" });
  await assert.rejects(failing.importFile(source), /previous account was kept/);
  assert.deepEqual(await readFile(file), original);
  const otherUser = createCredentialStore({ file, encryption: encryption(), platform: "win32" });
  await assert.rejects(otherUser.read(), /cannot be opened by this Windows user/);
  await writeFile(file, randomBytes(64));
  await assert.rejects(store.read(), /cannot be opened by this Windows user/);
});
