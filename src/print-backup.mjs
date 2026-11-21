import { readFile } from "node:fs/promises";
import { appendSheetRows, getSheetGrid } from "./google.mjs";
import {
  fingerprintSheetRow, isFingerprintHeader, listTemplateFiles, loadIndex,
  parseFingerprintSheet, studentsWithPrints, templatePath,
} from "./store.mjs";

export async function readPrintBackup(dir) {
  const index = await loadIndex(dir);
  const students = studentsWithPrints(index.students, await listTemplateFiles(dir));
  const owners = new Map();
  for (const student of students) {
    if (!student.studentId) continue;
    for (const file of student.localFiles) {
      const key = file.toLowerCase();
      owners.set(key, owners.has(key) ? null : { file, studentId: student.studentId });
    }
  }
  const prints = [];
  for (const owner of owners.values()) {
    if (!owner) continue;
    const template = await readFile(templatePath(dir, owner.file), "utf8");
    if (template.trim()) prints.push({ studentId: owner.studentId, template });
  }
  return prints;
}

/** Keep prior backups and fill in missing student/template pairs. Re-read the sheet after a failed write. */
export async function backupPrints(client, spreadsheetId, tabId, prints) {
  if (!prints.length) return 0;
  const { rows } = await getSheetGrid(client, spreadsheetId, tabId);
  const existing = parseFingerprintSheet(rows);
  if (!existing.empty && !isFingerprintHeader(rows[0])) throw new Error("Invalid fingerprint backup tab header.");
  const keys = new Set(existing.prints.map(({ studentId, template }) => JSON.stringify([studentId, template.trim()])));
  const missing = [];
  for (const { studentId, template } of prints) {
    const key = JSON.stringify([studentId, template.trim()]);
    if (keys.has(key)) continue;
    missing.push(fingerprintSheetRow(studentId, template, existing.header));
    keys.add(key);
  }
  const count = missing.length;
  if (existing.empty) missing.unshift(existing.header);
  for (let i = 0; i < missing.length; i += 40) {
    await appendSheetRows(client, spreadsheetId, tabId, missing.slice(i, i + 40));
  }
  return count;
}
