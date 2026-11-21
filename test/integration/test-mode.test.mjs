import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createBoutyQueue } from "../../src/bouty-storage.mjs";
import { clearFingerprints, indexPath, loadIndex, pendingPath, saveIndex, templatePath } from "../../src/store.mjs";
import { createTestWorkspace, discardTestWorkspace } from "../../src/test-mode.mjs";

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "attendance-test-workspace-"));
  t.after(() => rm(base, { force: true, recursive: true }));
  return { userDataDir: path.join(base, "profile"), fingerprintDir: path.join(base, "live-prints") };
}

test("test sessions isolate scanner samples, pending captures, and attendance", async (t) => {
  const options = await fixture(t);
  const live = options.fingerprintDir;
  const student = { studentId: "bouty:123", studentName: "Example", templateFile: "s-123.txt" };
  await mkdir(path.join(live, "templates"), { recursive: true });
  await writeFile(templatePath(live, "s-123.txt"), "primary");
  await writeFile(templatePath(live, "s-123--2.txt"), "additional");
  await writeFile(templatePath(live, "notes.txt"), "unrelated");
  await writeFile(pendingPath(live), "live pending");
  await saveIndex(live, { students: { [student.studentId]: student }, pending: { at: 1 } });
  const originalIndex = await readFile(indexPath(live), "utf8");
  const before = { id: "pending-live", studentId: student.studentId };
  const workspace = await createTestWorkspace({ ...options, attendance: [before] });
  const prints = workspace.fingerprintDir;
  assert.deepEqual((await readdir(path.join(prints, "templates"))).sort(), ["s-123--2.txt", "s-123.txt"]);
  assert.equal(await readFile(templatePath(prints, "s-123--2.txt"), "utf8"), "additional");
  assert.equal((await loadIndex(prints)).students[student.studentId].templateFile, student.templateFile);
  assert.equal((await loadIndex(prints)).pending, null);
  await assert.rejects(access(pendingPath(prints)), { code: "ENOENT" });
  const queue = createBoutyQueue(workspace.queueFile);
  assert.deepEqual(await queue.attendance(), [before]);
  assert.deepEqual(await queue.list(), []);
  await queue.enqueue({ id: "practice", studentId: student.studentId });
  await writeFile(templatePath(prints, "s-123.txt"), "changed");
  await clearFingerprints(prints);
  await discardTestWorkspace(options.userDataDir);
  await assert.rejects(access(workspace.root), { code: "ENOENT" });
  assert.equal(await readFile(indexPath(live), "utf8"), originalIndex);
  assert.equal(await readFile(templatePath(live, "s-123.txt"), "utf8"), "primary");
  assert.equal(await readFile(pendingPath(live), "utf8"), "live pending");
  const next = await createTestWorkspace(options);
  assert.deepEqual(await createBoutyQueue(next.queueFile).attendance(), []);
  assert.equal(await readFile(templatePath(next.fingerprintDir, "s-123.txt"), "utf8"), "primary");
  await discardTestWorkspace(options.userDataDir);
});

test("failed seeding removes scratch data without changing the live index", async (t) => {
  const options = await fixture(t);
  await mkdir(options.fingerprintDir);
  await writeFile(indexPath(options.fingerprintDir), "invalid");
  await assert.rejects(createTestWorkspace(options), SyntaxError);
  assert.deepEqual(await readdir(options.userDataDir), []);
  assert.deepEqual(await readdir(options.fingerprintDir), ["index.json"]);
});

test("startup cleanup refuses unowned folders and junctions", async (t) => {
  const options = await fixture(t);
  const root = path.join(options.userDataDir, "test-mode");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "other"), "keep");
  await assert.rejects(discardTestWorkspace(options.userDataDir), /does not belong/);
  assert.equal(await readFile(path.join(root, "other"), "utf8"), "keep");
  const otherProfile = path.join(options.userDataDir, "other-profile");
  await mkdir(otherProfile);
  await symlink(root, path.join(otherProfile, "test-mode"), "junction");
  await assert.rejects(discardTestWorkspace(otherProfile), /does not belong/);
  assert.deepEqual(await readdir(root), ["other"]);
});

test("startup can finish interrupted removal of an empty test folder", async (t) => {
  const options = await fixture(t);
  const folder = path.join(options.userDataDir, "test-mode");
  await mkdir(folder, { recursive: true });
  await discardTestWorkspace(options.userDataDir);
  await assert.rejects(access(folder), { code: "ENOENT" });
  await createTestWorkspace(options);
  await discardTestWorkspace(options.userDataDir);
});
