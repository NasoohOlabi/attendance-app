import { copyFile, lstat, mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { indexPath, isRosterTemplate, listTemplateFiles, loadIndex, saveIndex, templatePath } from "./store.mjs";

const marker = ".masjid-attendance-test-workspace-v1";

function sessionDirectory(userDataDir) {
  if (!path.isAbsolute(userDataDir)) throw new Error("Test mode requires an absolute profile directory.");
  return path.join(userDataDir, "test-mode");
}

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return null;
  }
}

// Called after the single-instance lock is acquired, and after a test session stops.
export async function discardTestWorkspace(userDataDir) {
  const directory = sessionDirectory(userDataDir);
  const stat = await statIfPresent(directory);
  if (!stat) return;
  const markerPath = path.join(directory, marker);
  const markerStat = stat.isDirectory() ? await statIfPresent(markerPath) : null;
  // The app can stop between creating/removing the marker and creating/removing its folder.
  if (stat.isDirectory() && !markerStat && (await readdir(directory)).length === 0) {
    await rmdir(directory);
    return;
  }
  if (!markerStat?.isDirectory()) {
    throw new Error("The test-mode folder does not belong to this app.");
  }
  // Keep the marker until all biometric data has been removed, so cleanup can be retried.
  await rm(path.join(directory, "data"), { recursive: true, force: true, maxRetries: 3 });
  await rmdir(markerPath);
  await rmdir(directory);
}

export async function createTestWorkspace({ userDataDir, fingerprintDir, attendance = [] }) {
  const directory = sessionDirectory(userDataDir);
  const root = path.join(directory, "data");
  const prints = path.join(root, "fingerprints");
  const queueFile = path.join(root, "bouty-outbox.json");

  await mkdir(userDataDir, { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  try {
    await mkdir(path.join(directory, marker), { mode: 0o700 });
  } catch (err) {
    await rmdir(directory);
    throw err;
  }
  try {
    await mkdir(path.join(prints, "templates"), { recursive: true, mode: 0o700 });
    const source = await statIfPresent(fingerprintDir);
    if (source) {
      if (!source.isDirectory()) throw new Error("The fingerprint folder must be a local directory.");
      const index = await statIfPresent(indexPath(fingerprintDir));
      if (index && !index.isFile()) throw new Error("The fingerprint index must be a regular file.");
      if (index) await copyFile(indexPath(fingerprintDir), indexPath(prints));
      const templates = await statIfPresent(path.join(fingerprintDir, "templates"));
      if (templates && !templates.isDirectory()) throw new Error("The template folder must be a local directory.");
      for (const name of await listTemplateFiles(fingerprintDir)) {
        if (isRosterTemplate(name)) await copyFile(templatePath(fingerprintDir, name), templatePath(prints, name));
      }
    }
    const { students } = await loadIndex(prints);
    await saveIndex(prints, { students, pending: null });
    await writeFile(queueFile, JSON.stringify({ items: [], confirmed: attendance }), { mode: 0o600 });
    return { root, fingerprintDir: prints, queueFile };
  } catch (err) {
    await discardTestWorkspace(userDataDir);
    throw err;
  }
}
