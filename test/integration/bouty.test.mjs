import assert from "node:assert/strict";
import test from "node:test";
import { createBoutyClient } from "../../src/bouty.mjs";
import { createBoutyCredentials, createBoutyQueue, parseBoutyMapping } from "../../src/bouty-storage.mjs";
import { createBoutySync } from "../../src/bouty-sync.mjs";
import { createBoutyResolver, boutyStudentChoices, applyBoutyProfile, migrateBoutyPrintLinks } from "../../src/bouty-resolve.mjs";
import { captureScreen, loadIndex, saveIndex, studentsWithPrints } from "../../src/store.mjs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

test("manual attendance sends only the enrolment operation and requires confirmation", async () => {
  const requests = [];
  const origin = "https://albouty.saas.alkheir-platform.com";
  const fetch = async (url, options) => {
    assert.equal(new URL(url).origin, origin);
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

test("migration preserves linked samples and leaves ambiguous IDs alone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bouty-migrate-"));
  const primary = "s-00-1.txt";
  const profiles = [
    { id: 1, studentName: "Current site name", sourceIds: ["001"] },
    { id: 2, studentName: "Duplicate A", sourceIds: ["00 02"] },
    { id: 3, studentName: "Duplicate B", sourceIds: ["0002", "3"] },
    { id: 4, studentName: "Missing ID", sourceIds: [] },
    { id: 5, studentName: "Conflicting local IDs", sourceIds: ["5"] },
  ];
  const index = await loadIndex(dir);
  index.students = { "00 1": { studentId: "00 1", templateFile: primary },
    "2": { studentId: "2" }, "5": { studentId: "5" }, "005": { studentId: "005" } };
  await writeFile(path.join(dir, "templates", primary), "first");
  await writeFile(path.join(dir, "templates", "s-00-1--2.txt"), "second");
  assert.equal(migrateBoutyPrintLinks(index, profiles), true);
  await saveIndex(dir, index);
  const saved = await loadIndex(dir);
  assert.deepEqual(Object.keys(saved.students).sort(), ["005", "2", "5", "bouty:1"]);
  assert.equal(migrateBoutyPrintLinks(saved, profiles), false);
  const scan = captureScreen(saved.students, { ok: true, matchScore: 12, matchSid: "s-00-1--2" });
  assert.equal(scan.student.studentId, "bouty:1");
  assert.deepEqual(studentsWithPrints(saved.students, [primary, "s-00-1--2.txt"])[0].localFiles, [primary, "s-00-1--2.txt"]);
  const choices = boutyStudentChoices(profiles, saved.students);
  assert.deepEqual(choices[0], { siteId: 1, studentId: "bouty:1", studentName: "Current site name", templateFile: primary, capturedAt: "" });
  assert.equal(choices.find((choice) => choice.siteId === 4).studentId, "bouty:4");
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
  const origin = "https://albouty.saas.alkheir-platform.com";
  const snapshot = (name, data) => JSON.stringify({ memo: { name }, data });
  const escaped = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const pageHtml = (name, data, inner = "") => `<script data-update-uri="/livewire-test/update"></script><div wire:snapshot="${escaped(snapshot(name, data))}">${inner}</div>`;
  const rows = '<table><tr><td>Other</td><td>7001</td><td><button wire:click="edit(11)"></button></td></tr><tr><td>Site Name</td><td>7002</td><td><button wire:click="edit(12)"></button></td></tr></table>';
  const student = pageHtml("students.index", {}, rows);
  const enrollments = pageHtml("enrollments.index", { courseFilter: "1" }, '<table><tr><td>1</td><td>Site Name</td><td>Website Group</td><td>Winter</td><td><button wire:click="edit(31)"></button></td></tr></table>');
  const attendance = pageHtml("attendance.index", { course_id: "1" });
  const dayRows = '<select id="attendance-day-course"><option value="1">Winter</option></select><table><tr><td>31-10-2026</td><td>Winter</td><td><a href="https://albouty.saas.alkheir-platform.com/attendance/days/students/22">open</a></td></tr></table>';
  const calls = [];
  let hasAttendanceDay = true;
  const page = async (url, opts = {}) => {
    calls.push(url);
    if (url === "/students") return { text: async () => student };
    if (url === "/enrollments") return { text: async () => enrollments };
    if (url === "/attendance") return { text: async () => attendance };
    if (url === "/attendance/days/students/22") return { text: async () => '<a href="https://albouty.saas.alkheir-platform.com/student-attendance/groups/8">group</a>' };
    if (url === "/student-attendance/groups/8") return { text: async () => '<table><tr data-attendance-type="student" data-attendance-entity-id="31"><td><select><option value="1">Present</option><option value="2">Absent</option></select></td></tr></table>' };
    assert.equal(url, "/livewire-test/update");
    const body = JSON.parse(opts.body), request = body.components[0], state = JSON.parse(request.snapshot);
    const method = request.calls[0]?.method, id = request.calls[0]?.params[0];
    if (state.memo.name === "students.index" && method === "edit") Object.assign(state.data, { editingId: id, notes: `معرف المصدر: ${id === 11 ? "002" : "001"}`, first_name: "Same", last_name: "Name", school_name: "From Bouty" });
    if (state.memo.name === "enrollments.index" && method === "edit") Object.assign(state.data, { student_id: 12, status: "active" });
    const html = state.memo.name === "students.index" ? student : state.memo.name === "enrollments.index" ? enrollments :
      pageHtml("attendance.index", state.data, hasAttendanceDay ? dayRows : dayRows.split("<table>")[0]);
    return { json: async () => ({ components: [{ snapshot: JSON.stringify(state), effects: { html } }] }) };
  };
  const resolve = createBoutyResolver({ origin, page, csrf: () => "token" });
  assert.deepEqual(await resolve.student({ studentId: "001", studentName: "Old Name" }), {
    id: 12, studentNumber: "7002", sourceIds: ["001"], studentName: "Same Name", parentId: null, phoneMissing: true, fields: [
      { label: "رقم الطالب", value: "7002", kind: "chip" },
      { label: "المدرسة", value: "From Bouty", kind: "line" },
      { label: "ملاحظات", value: "معرف المصدر: 001", kind: "line" },
      { label: "المجموعة", value: "Website Group", kind: "chip" },
      { label: "الدورة", value: "Winter", kind: "chip" },
    ],
  });
  assert.deepEqual(await resolve({ studentId: "001", studentName: "Same Name", date: "2026-10-31", kind: "present" }), { dayId: 22, enrollmentId: 31, statusId: 1 });
  assert.deepEqual(await resolve({ studentId: "bouty:12", date: "2026-10-31", kind: "present" }), { dayId: 22, enrollmentId: 31, statusId: 1 });
  assert.deepEqual(await resolve({ studentId: "001", studentName: "Same Name", date: "2026-10-31", kind: "absent" }), { dayId: 22, enrollmentId: 31, statusId: 2 });
  await assert.rejects(resolve({ studentId: "003", studentName: "Same Name", date: "2026-10-31", kind: "present" }), /identity is missing/);
  hasAttendanceDay = false;
  await assert.rejects(resolve({ studentId: "001", studentName: "Same Name", date: "2026-10-31", kind: "present" }), /no attendance day/);
  assert.equal(calls.includes("/attendance/offline-sync"), false);
});
