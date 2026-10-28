import assert from "node:assert/strict";
import test from "node:test";
import { createBoutyClient } from "../../src/bouty.mjs";
import { createBoutyCredentials, createBoutyQueue } from "../../src/bouty-storage.mjs";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

test("manual attendance sends only the enrolment operation and requires confirmation", async () => {
  const requests = [];
  const origin = "https://albouty.saas.hassiba.tech";
  const fetch = async (url, options) => {
    requests.push({ url, options });
    let body = "";
    let finalUrl = url;
    if (url.endsWith("/login") && options.method !== "POST") body = '<input name="_token" value="login-token">';
    else if (url.endsWith("/login")) finalUrl = `${origin}/dashboard`;
    else if (url.endsWith("/attendance")) body = '<meta name="csrf-token" content="session-token"><body data-current-user-id="7">';
    else {
      const operation = JSON.parse(options.body).operations[0];
      body = JSON.stringify({ results: [{ client_operation_id: operation.client_operation_id, status: "synced" }] });
    }
    return { ok: true, status: url.endsWith("/login") && options.method === "POST" ? 302 : 200,
      headers: { get: () => finalUrl }, url: finalUrl, text: async () => body, json: async () => JSON.parse(body) };
  };
  const client = createBoutyClient(fetch);
  await assert.rejects(client.mark({}), /Sign in/);
  await client.login("teacher", "example");
  await client.mark({ dayId: 4, enrollmentId: 8, statusId: 1, changedAt: "2026-10-31T07:01:00Z", operationId: "test-operation" });
  const request = requests.at(-1);
  assert.equal(request.url, `${origin}/attendance/offline-sync`);
  assert.equal(request.options.headers["X-CSRF-TOKEN"], "session-token");
  assert.deepEqual(JSON.parse(request.options.body).operations[0], {
    key: "7:student:4:8", client_operation_id: "test-operation", user_id: "7", type: "student", day_id: 4,
    entity_id: 8, status_id: 1, changed_at: "2026-10-31T07:01:00.000Z", queued_offline: true, state: "pending",
  });
  await assert.rejects(client.mark({ dayId: 4, enrollmentId: 0, statusId: 1, changedAt: new Date() }), /Invalid enrolment/);
  const failing = createBoutyClient(async (url, options) => {
    if (url.endsWith("/attendance/offline-sync")) return { ok: true, url, json: async () => ({ results: [] }) };
    return fetch(url, options);
  });
  await failing.login("teacher", "example");
  await assert.rejects(failing.mark({ dayId: 4, enrollmentId: 8, statusId: 1, changedAt: new Date() }), /did not confirm/);
});

test("Bouty credentials are encrypted and the independent queue survives concurrent changes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-"));
  const key = randomBytes(32);
  const encryption = {
    async isAsyncEncryptionAvailable() { return true; },
    async encryptStringAsync(text) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(data) {
      const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString() };
    },
  };
  const file = path.join(dir, "account.enc");
  const store = createBoutyCredentials({ file, encryption, platform: "win32" });
  await store.save({ username: "user", password: "private-test-value" });
  assert.equal((await readFile(file)).includes(Buffer.from("private-test-value")), false);
  assert.deepEqual(await store.read(), { username: "user", password: "private-test-value" });
  const queueFile = path.join(dir, "outbox.json");
  const queue = createBoutyQueue(queueFile);
  await Promise.all([queue.enqueue({ id: "one" }), queue.enqueue({ id: "two" })]);
  await Promise.all([queue.remove("one"), queue.enqueue({ id: "three" })]);
  assert.deepEqual(await createBoutyQueue(queueFile).list(), [{ id: "two" }, { id: "three" }]);
});
