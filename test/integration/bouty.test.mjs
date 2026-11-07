import assert from "node:assert/strict";
import test from "node:test";
import { createBoutyClient } from "../../src/bouty.mjs";
import { createBoutyCredentials, createBoutyQueue, parseBoutyMapping } from "../../src/bouty-storage.mjs";
import { createBoutySync } from "../../src/bouty-sync.mjs";
import { createBoutyResolver, boutyStudentChoices, applyBoutyProfile, normalizeBoutySourceId } from "../../src/bouty-resolve.mjs";
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

test("Electron's cancelled login redirect requires a successful authenticated attendance page", async () => {
  let signedIn = true;
  const fetch = async (url, options) => {
    if (url.endsWith("/login") && options.method === "POST") throw new Error("Redirect was cancelled");
    if (url.endsWith("/attendance") && !signedIn) throw new Error("Redirect was cancelled");
    const text = url.endsWith("/login") ? '<input name="_token" value="token">' : '<meta name="csrf-token" content="token"><body data-current-user-id="1">';
    return { ok: true, url: "", text: async () => text };
  };
  const client = createBoutyClient(fetch);
  await client.login("user", "password");
  signedIn = false;
  await assert.rejects(client.login("user", "password"));
  await assert.rejects(client.mark({}), /Sign in/);
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

test("student mapping refuses duplicate students and enrolments", () => {
  assert.equal(parseBoutyMapping([{ studentId: "00 00 000 001", enrollmentId: 7 }]).size, 1);
  assert.throws(() => parseBoutyMapping([{ studentId: "00 00 000 001", enrollmentId: 7 }, { studentId: "00 00 000 001", enrollmentId: 8 }]), /Duplicate/);
  assert.throws(() => parseBoutyMapping([{ studentId: "00 00 000 001", enrollmentId: 7 }, { studentId: "00 00 000 002", enrollmentId: 7 }]), /Duplicate/);
});

test("Bouty picker uses site names and refuses ambiguous source or local fingerprint IDs", () => {
  const profiles = [
    { id: 1, studentName: "Current site name", sourceIds: ["001"] },
    { id: 2, studentName: "Duplicate A", sourceIds: ["00 02"] },
    { id: 3, studentName: "Duplicate B", sourceIds: ["0002"] },
    { id: 4, studentName: "Missing ID", sourceIds: [] },
  ];
  assert.deepEqual(boutyStudentChoices(profiles, { old: { studentId: "00 1", studentName: "Old sheet name", templateFile: "print.txt" } }), [
    { siteId: 1, studentId: "00 1", studentName: "Current site name", templateFile: "print.txt", capturedAt: "" },
  ]);
  assert.deepEqual(boutyStudentChoices([profiles[0]], { a: { studentId: "001" }, b: { studentId: "00 1" } }), []);
});

test("padded roster IDs match numeric site IDs without accepting nonnumeric values", () => {
  assert.equal(normalizeBoutySourceId("00 00 000 005"), "5");
  assert.equal(normalizeBoutySourceId("5"), "5");
  assert.equal(normalizeBoutySourceId("not an ID"), "");
  assert.deepEqual(boutyStudentChoices([{ id: 9, studentName: "Site", sourceIds: ["5"] }],
    { x: { studentId: "00 00 000 005", templateFile: "print.txt" } }).map((p) => p.studentId), ["00 00 000 005"]);
  assert.deepEqual(boutyStudentChoices([{ id: 9, studentName: "Site", sourceIds: ["5"] }], {}).map((p) => p.studentId), ["00 00 000 005"]);
  assert.deepEqual(boutyStudentChoices([{ id: 9, studentName: "Site", sourceIds: ["12345678901"] }], {}), []);
  assert.deepEqual(boutyStudentChoices([{ id: 9, studentName: "One", sourceIds: ["5"] }, { id: 10, studentName: "Two", sourceIds: ["0005"] }], {}), []);
});

test("a delayed Bouty profile cannot replace a newer scan", () => {
  const match = { at: "later", studentId: "002", studentName: "", fields: [] };
  const oldProfile = { studentName: "Previous student", fields: [{ label: "المدرسة", value: "Old", kind: "line" }] };
  assert.equal(applyBoutyProfile(match, "earlier", "001", oldProfile, "bouty"), null);
  assert.equal(applyBoutyProfile(match, "later", "002", oldProfile, "sheet"), null);
  assert.equal(applyBoutyProfile(match, "later", "002", oldProfile, "bouty").studentName, "Previous student");
});

test("Bouty scans remain queued until their day and enrolment are mapped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-sync-"));
  const queue = createBoutyQueue(path.join(dir, "queue.json"));
  const calls = [], messages = [];
  let days = {};
  const worker = createBoutySync({
    queue, credentials: { read: async () => ({ username: "user", password: "secret" }) },
    client: { login: async () => {}, mark: async (entry) => calls.push(entry) },
    settings: async () => ({ mapping: [{ studentId: "00 00 000 001", enrollmentId: 7 }], days, presentStatusId: 1, absentStatusId: 2 }),
    onStatus: (message) => messages.push(message),
  });
  await worker.enqueue("00 00 000 001", "present", "2026-10-31T06:15:00Z");
  await worker.sync();
  assert.equal((await queue.list()).length, 1);
  assert.match(messages.at(-1), /missing/);
  days = { "2026-10-31": 9 };
  await worker.sync();
  assert.equal((await queue.list()).length, 0);
  assert.equal(calls[0].dayId, 9);
  assert.equal(calls[0].enrollmentId, 7);
  assert.equal(calls[0].changedAt, "2026-10-31T06:15:00Z");
});

test("an uncertain Bouty write is retried with the same operation ID", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-retry-"));
  const queue = createBoutyQueue(path.join(dir, "queue.json"));
  const ids = [];
  let fail = true;
  const sync = createBoutySync({ queue,
    credentials: { read: async () => ({ username: "user", password: "secret" }) },
    settings: async () => ({ mapping: [{ studentId: "00 00 000 001", enrollmentId: 7 }], days: { "2026-10-31": 9 }, presentStatusId: 1 }),
    client: { login: async () => {}, mark: async (item) => { ids.push(item.operationId); if (fail) throw new Error(); } },
  });
  await sync.enqueue("00 00 000 001", "present", "2026-10-31T06:15:00Z");
  await sync.sync();
  assert.equal((await queue.list()).length, 1);
  fail = false;
  await sync.sync();
  assert.equal((await queue.list()).length, 0);
  assert.equal(ids[0], ids[1]);
});

test("Bouty automatically resolves the student and day from a queued scan", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-auto-"));
  const queue = createBoutyQueue(path.join(dir, "queue.json"));
  const calls = [];
  const sync = createBoutySync({ queue,
    credentials: { read: async () => ({ username: "user", password: "secret" }) },
    settings: async () => ({ mapping: [], days: {} }),
    client: { login: async () => {}, resolve: async (query) => { calls.push(query); return { dayId: 9, enrollmentId: 7, statusId: 1 }; },
      mark: async (item) => calls.push(item) },
  });
  await sync.enqueue("001", "present", "2026-10-31T06:15:00Z", "One");
  await sync.sync();
  assert.deepEqual(calls[0], { studentId: "001", studentName: "One", date: "2026-10-31", kind: "present" });
  assert.equal(calls[1].enrollmentId, 7);
  assert.equal((await queue.list()).length, 0);
});

test("an ambiguous student stays queued without blocking other students", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-blocked-"));
  const queue = createBoutyQueue(path.join(dir, "queue.json")), sent = [], messages = [];
  const sync = createBoutySync({ queue, credentials: { read: async () => ({ username: "user", password: "secret" }) },
    settings: async () => ({ mapping: [], days: {} }), onStatus: (message) => messages.push(message),
    client: { login: async () => {}, resolve: async ({ studentId }) => {
      if (studentId === "001") throw new Error("Bouty student identity is missing or ambiguous.");
      return { dayId: 9, enrollmentId: 7, statusId: 1 };
    }, mark: async (item) => sent.push(item) },
  });
  await sync.enqueue("001", "present", "2026-10-31T06:15:00Z", "One");
  await sync.enqueue("001", "absent", "2026-10-31T06:16:00Z", "One");
  await sync.enqueue("002", "present", "2026-10-31T06:17:00Z", "Two");
  await sync.sync();
  assert.equal(sent.length, 1);
  assert.equal((await queue.list()).length, 2);
  assert.match(messages.at(-1), /ambiguous/);
});

test("Bouty resolves the exact source ID, active enrolment, day and group without guessing by name", async () => {
  const snapshot = (name, data) => JSON.stringify({ memo: { name }, data });
  const escaped = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const pageHtml = (name, data, inner = "") => `<script data-update-uri="https://albouty.saas.hassiba.tech/livewire/update"></script><div wire:snapshot="${escaped(snapshot(name, data))}">${inner}</div>`;
  const rows = '<table><tr><td>Other</td><td>7001</td><td><button wire:click="edit(11)"></button></td></tr><tr><td>Site Name</td><td>7002</td><td><button wire:click="edit(12)"></button></td></tr></table>';
  const student = pageHtml("students.index", {}, rows);
  const enrollments = pageHtml("enrollments.index", { courseFilter: "1" }, '<table><tr><td>1</td><td>Site Name</td><td>Website Group</td><td><button wire:click="edit(31)"></button></td></tr></table>');
  const attendance = pageHtml("attendance.index", { course_id: "1" });
  const dayRows = '<select id="attendance-day-course"><option value="1">Winter</option></select><table><tr><td>31-10-2026</td><td>Winter</td><td><a href="https://albouty.saas.hassiba.tech/attendance/days/students/22">open</a></td></tr></table>';
  const calls = [];
  const page = async (url, opts = {}) => {
    calls.push(url);
    if (url === "/students") return { text: async () => student };
    if (url === "/enrollments") return { text: async () => enrollments };
    if (url === "/attendance") return { text: async () => attendance };
    if (url === "/attendance/days/students/22") return { text: async () => '<a href="https://albouty.saas.hassiba.tech/student-attendance/groups/8">group</a>' };
    if (url === "/student-attendance/groups/8") return { text: async () => '<table><tr data-attendance-type="student" data-attendance-entity-id="31"><td><select><option value="1">Present</option><option value="2">Absent</option></select></td></tr></table>' };
    const body = JSON.parse(opts.body), request = body.components[0], state = JSON.parse(request.snapshot);
    const method = request.calls[0]?.method, id = request.calls[0]?.params[0];
    if (state.memo.name === "students.index" && method === "edit") Object.assign(state.data, { notes: `معرف المصدر: ${id === 11 ? "002" : "001"}`, first_name: "Same", last_name: "Name", school_name: "From Bouty" });
    if (state.memo.name === "enrollments.index" && method === "edit") Object.assign(state.data, { student_id: 12, status: "active" });
    const html = state.memo.name === "students.index" ? student : state.memo.name === "enrollments.index" ? enrollments : pageHtml("attendance.index", state.data, dayRows);
    return { json: async () => ({ components: [{ snapshot: JSON.stringify(state), effects: { html } }] }) };
  };
  const resolve = createBoutyResolver({ page, csrf: () => "token" });
  assert.deepEqual(await resolve.student({ studentId: "001", studentName: "Old Name" }), {
    id: 12, sourceIds: ["001"], studentName: "Same Name", fields: [{ label: "رقم الطالب", value: "7002", kind: "chip" }, { label: "المدرسة", value: "From Bouty", kind: "line" }, { label: "المجموعة", value: "Website Group", kind: "chip" }],
  });
  assert.deepEqual(await resolve({ studentId: "001", studentName: "Same Name", date: "2026-10-31", kind: "present" }), { dayId: 22, enrollmentId: 31, statusId: 1 });
  assert.deepEqual(await resolve({ studentId: "001", studentName: "Same Name", date: "2026-10-31", kind: "absent" }), { dayId: 22, enrollmentId: 31, statusId: 2 });
  await assert.rejects(resolve({ studentId: "003", studentName: "Same Name", date: "2026-10-31", kind: "present" }), /identity is missing/);
  assert.equal(calls.includes("/attendance/offline-sync"), false);
});
