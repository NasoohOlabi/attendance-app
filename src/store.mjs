import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function sanitizeToken(value) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/\.+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "student";
}

/** Student id wins. Names are only used when the sheet row has no id. */
export function templateFileForStudent(student) {
  const id = String(student?.studentId || "").trim();
  const source = id || String(student?.studentName || "").trim();
  return `s-${sanitizeToken(source)}.txt`;
}

export function templateStem(file) {
  return String(file || "").replace(/\.txt$/i, "").toLowerCase();
}

/** First print keeps s-name.txt. Later prints are s-name--2.txt so identify can load each one. */
export function nextSampleFile(primaryFile, existingNames) {
  const primary = String(primaryFile || "");
  if (!/^([st]-).+\.txt$/i.test(primary) || path.basename(primary) !== primary) {
    throw new Error(`Invalid template file name: ${primaryFile}`);
  }
  const names = new Set((existingNames || []).map((name) => String(name).toLowerCase()));
  if (!names.has(primary.toLowerCase())) return primary;
  const stem = templateStem(primary);
  let n = 2;
  while (names.has(`${stem}--${n}.txt`)) n += 1;
  return `${stem}--${n}.txt`;
}

/** Filenames for scans saved together, in order. The first free name is the primary template. */
export function planBatchFiles(primaryFile, existingNames, scanCount) {
  const count = Number(scanCount);
  if (!Number.isInteger(count) || count < 1) return [];
  const names = [...(existingNames || [])];
  const files = [];
  for (let i = 0; i < count; i += 1) {
    const file = nextSampleFile(primaryFile, names);
    files.push(file);
    names.push(file);
  }
  return files;
}

export function studentKey(student) {
  const id = String(student?.studentId || "").trim().toLowerCase();
  if (id) return id;
  return `name:${String(student?.studentName || "").trim().toLowerCase()}`;
}

export function templatePath(dir, templateFile) {
  if (!templateFile || path.basename(templateFile) !== templateFile) {
    throw new Error(`Invalid template file name: ${templateFile}`);
  }
  return path.join(dir, "templates", templateFile);
}

export function pendingPath(dir) {
  return path.join(dir, "pending.txt");
}

export function logPath(dir) {
  return path.join(dir, "log.json");
}

function isRosterTemplate(name) {
  if (!name || path.basename(name) !== name) return false;
  if (name.toLowerCase() === "pending.txt") return false;
  return /^[st]-.+\.txt$/i.test(name);
}

/** Students who currently have a template file on disk, sorted by name. */
export function buildRoster(students, templateFiles) {
  const onDisk = new Set((templateFiles || []).filter((name) => isRosterTemplate(name)));
  return Object.values(students || {})
    .filter((student) => student && isRosterTemplate(student.templateFile) && onDisk.has(student.templateFile))
    .map((student) => ({
      studentId: student.studentId || "",
      studentName: student.studentName || "",
      templateFile: student.templateFile,
      capturedAt: student.capturedAt || "",
    }))
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, "en") ||
        a.studentId.localeCompare(b.studentId, "en") ||
        a.templateFile.localeCompare(b.templateFile, "en"),
    );
}

export async function listTemplateFiles(dir) {
  try {
    const entries = await readdir(path.join(dir, "templates"), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** Delete every saved print and the pending scan. The directory stays. Returns how many template files were removed. */
export async function clearFingerprints(dir) {
  const templates = path.join(dir, "templates");
  let names = [];
  try {
    names = await readdir(templates);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await mkdir(templates, { recursive: true });
  let removed = 0;
  for (const name of names) {
    const full = path.join(templates, name);
    if (path.relative(templates, full).startsWith("..")) continue;
    await rm(full, { force: true, recursive: true });
    removed += 1;
  }
  await rm(pendingPath(dir), { force: true });
  await saveIndex(dir, { students: {}, pending: null });
  return removed;
}

export async function writeLog(dir, index) {
  await mkdir(dir, { recursive: true });
  const roster = buildRoster(index?.students, await listTemplateFiles(dir));
  const dest = logPath(dir);
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, `${JSON.stringify(roster, null, 2)}\n`);
  await rename(tmp, dest);
  return roster;
}

export function indexPath(dir) {
  return path.join(dir, "index.json");
}

function persistable(student) {
  return {
    studentId: student.studentId || "",
    studentName: student.studentName || "",
    templateFile: student.templateFile || "",
    capturedAt: student.capturedAt || "",
  };
}

export async function loadIndex(dir) {
  await mkdir(path.join(dir, "templates"), { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(indexPath(dir), "utf8"));
    const raw = parsed?.students && typeof parsed.students === "object" ? parsed.students : {};
    const students = {};
    for (const [key, student] of Object.entries(raw)) {
      if (!student || typeof student !== "object") continue;
      students[key] = persistable(student);
    }
    const pending = parsed?.pending && typeof parsed.pending === "object" ? parsed.pending : null;
    return { students, pending };
  } catch (err) {
    if (err.code === "ENOENT") return { students: {}, pending: null };
    throw err;
  }
}

export async function saveIndex(dir, index) {
  await mkdir(dir, { recursive: true });
  const dest = indexPath(dir);
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, JSON.stringify({ students: index.students || {}, pending: index.pending || null }, null, 2));
  await rename(tmp, dest);
  await writeLog(dir, index);
}

export function putStudent(index, student) {
  if (!index.students) index.students = {};
  const key = studentKey(student);
  const prev = index.students[key] || {};
  index.students[key] = persistable({ ...prev, ...student });
  return index.students[key];
}

const calendarFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Damascus", year: "numeric", month: "numeric", day: "numeric", weekday: "short" });

function calendarDay(date) {
  const parts = calendarFormat.formatToParts(date instanceof Date ? date : new Date(date));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

function cells(row) {
  return (row || []).map((cell) => String(cell ?? "").trim());
}

export function sheetProblem(rows) {
  const first = cells(rows?.[0]).map((cell) => cell.toLowerCase());
  if (first[0] === "capture_id") {
    return "This sheet uses capture_id headers. Attendance is a date grid, and column A is the student name.";
  }
  return "";
}

export function columnLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function dateHeaderText(date) {
  const when = calendarDay(date);
  return `${when.weekday} ${when.day}/${when.month}`;
}

/** Google Sheets serial, 1899-12-30 epoch. Uses the calendar date, not the UTC instant. */
export function sheetsSerial(date) {
  const when = calendarDay(date);
  const utc = Date.UTC(when.year, when.month - 1, when.day);
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

export function shiftColumnFormula(formula, fromIndex, toIndex) {
  const from = columnLetter(fromIndex);
  const to = columnLetter(toIndex);
  return String(formula).replace(/(\$?)([A-Z]{1,3})(\$?)(\d*)/g, (match, dollar, col, dollar2, row, offset, full) => {
    if (col !== from) return match;
    const prev = offset > 0 ? full[offset - 1] : "";
    if (/[A-Z]/.test(prev)) return match;
    return `${dollar}${to}${dollar2}${row}`;
  });
}

/**
 * Place a missing date after the latest earlier date serial, so a new day stays with the current run.
 * ponytail: serial order, not a visual reorder. The sheet already mixes two seasons.
 */
export function planDateColumn(header, formulas, serials, date) {
  const existing = findDateColumn(header, date);
  const headerText = dateHeaderText(date);
  if (existing) return { op: "exists", columnIndex: existing.columnIndex, header: existing.header || headerText };
  const dates = [];
  for (let i = 0; i < (header || []).length; i++) {
    if (!parseDateHeader(header[i])) continue;
    const serial = Number(serials?.[i]);
    if (!Number.isFinite(serial)) continue;
    dates.push({ index: i, serial });
  }
  if (!dates.length) return null;
  const target = sheetsSerial(date);
  let anchor = null;
  for (const item of dates) {
    if (item.serial <= target && (!anchor || item.serial > anchor.serial)) anchor = item;
  }
  const sourceIndex = anchor ? anchor.index : dates[0].index;
  const insertIndex = anchor ? anchor.index + 1 : dates[0].index;
  const sourceFormula = String(formulas?.[sourceIndex] || "").trim();
  if (!sourceFormula.startsWith("=")) return null;
  return {
    op: "insert",
    insertIndex,
    sourceIndex,
    header: headerText,
    sourceFormula,
    formula: shiftColumnFormula(sourceFormula, sourceIndex, insertIndex),
  };
}

// ponytail: headers are "Sat 4/7" or "28/6" with no year. The workbook title carries the year.
export function parseDateHeader(value) {
  const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  const withDay = text.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})$/i);
  if (withDay) {
    const day = Number(withDay[2]);
    const month = Number(withDay[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const raw = withDay[1];
    return {
      weekday: raw.slice(0, 1).toUpperCase() + raw.slice(1, 3).toLowerCase(),
      day,
      month,
    };
  }
  const bare = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!bare) return null;
  const day = Number(bare[1]);
  const month = Number(bare[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { weekday: "", day, month };
}

function isCount(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,4}%$/.test(text)) return true;
  if (!/^-?\d{1,4}(\.\d+)?$/.test(text)) return false;
  return true;
}

function isSummaryRow(row) {
  const name = String(row?.[0] ?? "").trim();
  if (name && !isCount(name)) return false;
  const rest = (row || []).slice(1).map((cell) => String(cell ?? "").trim()).filter(Boolean);
  if (!rest.length) return true;
  return rest.every((cell) => isCount(cell) || /^(true|false)$/i.test(cell));
}

function headerText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function isIdHeader(text) {
  return text === "معرف" || text === "المعرف" || /^marif$/i.test(text) || /^id$/i.test(text);
}

function isFullNameHeader(text) {
  return text === "إسم كامل" || text === "اسم كامل" || text === "الإسم الكامل" || text === "الاسم الكامل";
}

function isGivenHeader(text) {
  return text === "الإسم" || text === "الاسم" || text === "إسم" || text === "اسم";
}

function isFamilyHeader(text) {
  return text === "كنية" || text === "الكنية";
}

function isLogTimeHeader(text) {
  return text === "حضور" || text === "الوقت" || text === "وقت" || /^time(stamp)?$/i.test(text);
}

function isTemplateHeader(text) {
  return text === "البصمة" || text === "بصمة" || text === "القالب" || text === "قالب" || /^template$/i.test(text);
}

function isFingerprintIdHeader(text) {
  return isIdHeader(text) || text.toLowerCase() === "student_id";
}

function isFingerprintTemplateHeader(text) {
  return isTemplateHeader(text) || text.toLowerCase() === "fingerprint";
}

function isCreatedAtHeader(text) {
  return text.toLowerCase() === "created_at";
}

/** Marif ids are digits, or digit groups such as "00 00 000 001". Anything else is not an id. */
export function canonicalStudentId(value) {
  const text = String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  if (!/^\d+(?: \d+)*$/.test(text)) return "";
  return text;
}

export function rosterColumns(header) {
  const cells = (header || []).map(headerText);
  let id = -1;
  let full = -1;
  let given = -1;
  let family = -1;
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i];
    if (id < 0 && isIdHeader(text)) id = i;
    else if (full < 0 && isFullNameHeader(text)) full = i;
    else if (given < 0 && isGivenHeader(text)) given = i;
    else if (family < 0 && isFamilyHeader(text)) family = i;
  }
  if (full < 0 && given < 0 && id !== 0 && !parseDateHeader(cells[0])) full = 0;
  return { id, full, given, family };
}

function nameFromRow(row, cols) {
  const full = cols.full >= 0 ? String(row?.[cols.full] ?? "").trim() : "";
  if (full) return full;
  const given = cols.given >= 0 ? String(row?.[cols.given] ?? "").trim() : "";
  const family = cols.family >= 0 ? String(row?.[cols.family] ?? "").trim() : "";
  return [given, family].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function cellText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

/** Phone-like cells stay on their own row. Short facts become chips. */
function profileKind(value) {
  if (/^(true|false)$/i.test(value)) return "flag";
  if (/^\d{1,4}%$/.test(value)) return "meter";
  const compact = value.replace(/\s/g, "");
  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length / compact.length >= 0.7) return "phone";
  if (value.length > 24) return "line";
  return "chip";
}

function profileRank(kind) {
  if (kind === "meter") return 0;
  if (kind === "flag") return 1;
  if (kind === "chip") return 2;
  if (kind === "phone") return 3;
  return 4;
}

/**
 * Profile for one Info row. Date columns, the full name, the id, and empty cells stay out.
 * TRUE/FALSE becomes Yes/No so the card does not show a checkbox literal.
 */
export function studentProfile(header, row) {
  const cells = (header || []).map(headerText);
  const cols = rosterColumns(header);
  const fields = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || parseDateHeader(cells[i])) continue;
    if (i === cols.full || i === cols.id) continue;
    const raw = cellText(row?.[i]);
    if (!raw) continue;
    const kind = profileKind(raw);
    const value = /^true$/i.test(raw) ? "Yes" : /^false$/i.test(raw) ? "No" : raw;
    fields.push({ label: cells[i], value, kind });
  }
  fields.sort((a, b) => profileRank(a.kind) - profileRank(b.kind));
  return {
    name: cols.full >= 0 ? cellText(row?.[cols.full]) : "",
    id: cols.id >= 0 ? canonicalStudentId(row?.[cols.id]) : "",
    fields,
  };
}

const EMPTY_GRID = { headerRowNumber: 0, summaryRowNumber: 0, header: [], idColumn: -1, students: [], duplicates: [] };

export function parseAttendanceGrid(rows) {
  const list = rows || [];
  if (sheetProblem(list)) return { ...EMPTY_GRID };
  const headerIndex = list.findIndex((row) => (row || []).some((cell) => parseDateHeader(cell)));
  if (headerIndex < 0) return { ...EMPTY_GRID };
  const header = list[headerIndex] || [];
  const cols = rosterColumns(header);
  let start = headerIndex + 1;
  let summaryRowNumber = 0;
  if (start < list.length && isSummaryRow(list[start])) {
    summaryRowNumber = start + 1;
    start += 1;
  }
  const students = [];
  const counts = new Map();
  for (let i = start; i < list.length; i++) {
    const studentId = cols.id < 0 ? "" : canonicalStudentId(list[i]?.[cols.id]);
    const studentName = nameFromRow(list[i], cols);
    if (!studentId && !studentName) continue;
    if (studentId) counts.set(studentId, (counts.get(studentId) || 0) + 1);
    students.push({ studentId, studentName, rowNumber: i + 1 });
  }
  const duplicates = [];
  for (const [id, count] of counts) {
    if (count >= 2) duplicates.push(id);
  }
  return { headerRowNumber: headerIndex + 1, summaryRowNumber, header, idColumn: cols.id, students, duplicates };
}

export function readStudents(rows) {
  return parseAttendanceGrid(rows).students;
}

function isPresentMark(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim();
  return text === "حاضر" || text.toLowerCase() === "true";
}

/** Students whose cell in today's date column is حاضر, in sheet order. */
export function presentToday(rows, date = new Date()) {
  const grid = parseAttendanceGrid(rows);
  const column = findDateColumn(grid.header, date);
  if (!column) return [];
  const list = rows || [];
  const people = [];
  for (const student of grid.students) {
    const row = list[student.rowNumber - 1] || [];
    if (!isPresentMark(row[column.columnIndex])) continue;
    people.push({
      name: student.studentName || student.studentId,
      studentId: student.studentId,
      rowNumber: student.rowNumber,
    });
  }
  return people;
}

/** Clear one date cell by sheet row. The id selects the person; the row selects the cell. */
export function planClearRow(rows, rowNumber, date) {
  const grid = parseAttendanceGrid(rows);
  const student = grid.students.find((item) => item.rowNumber === Number(rowNumber));
  if (!student) return { op: "missing-student" };
  const column = findDateColumn(grid.header, date);
  if (!column) return { op: "missing-date", name: student.studentName || student.studentId, studentId: student.studentId, studentName: student.studentName };
  return {
    op: "update",
    name: student.studentName || student.studentId,
    studentId: student.studentId,
    studentName: student.studentName,
    rowNumber: student.rowNumber,
    a1: `${columnLetter(column.columnIndex)}${student.rowNumber}`,
    value: "",
  };
}

export function parseClock(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function clockFromStamp(stamp) {
  const match = String(stamp || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  return `${match[4]}:${match[5]}`;
}

export function isStampOnDay(stamp, date, timeZone = "Asia/Damascus") {
  const day = attendanceStamp(date, timeZone).split(" ")[0];
  return String(stamp || "").trim().startsWith(`${day} `);
}

/** Identity column, then the timestamp. معرف wins; otherwise الطالب. إسم is only a review column. */
export function logLayout(header) {
  const cells = (header || []).map(headerText);
  let id = -1;
  let student = -1;
  let name = -1;
  let time = -1;
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i];
    if (id < 0 && isIdHeader(text)) id = i;
    else if (time < 0 && isLogTimeHeader(text)) time = i;
    else if (student < 0 && text === "الطالب") student = i;
    else if (name < 0 && (isFullNameHeader(text) || isGivenHeader(text))) name = i;
  }
  const identity = id >= 0 ? id : student >= 0 ? student : name >= 0 ? name : 0;
  if (time < 0) time = identity === 0 ? 1 : 0;
  if (name === identity) name = -1;
  return { id, name, time, identity };
}

function sameIdentity(cell, studentId) {
  const wantedId = canonicalStudentId(studentId);
  const gotId = canonicalStudentId(cell);
  if (wantedId || gotId) return Boolean(wantedId) && wantedId === gotId;
  const wanted = String(studentId || "").trim().toLowerCase();
  return Boolean(wanted) && String(cell || "").trim().toLowerCase() === wanted;
}

/** Today's log rows for one id, oldest first. Row 1 is the header. */
export function logHits(rows, studentId, date) {
  const layout = logLayout(rows?.[0]);
  const hits = [];
  for (let i = 1; i < (rows || []).length; i++) {
    const who = String(rows[i]?.[layout.identity] ?? "").trim();
    const stamp = String(rows[i]?.[layout.time] ?? "").trim();
    if (!sameIdentity(who, studentId) || !isStampOnDay(stamp, date)) continue;
    hits.push({ rowNumber: i + 1, stamp });
  }
  return hits;
}

/** The logged id and today's stamp, or null when this row is someone else. */
export function matchingLogRow(rows, rowNumber, studentId, date) {
  const layout = logLayout(rows?.[0]);
  const row = rows?.[Number(rowNumber) - 1];
  if (!row) return null;
  const who = String(row[layout.identity] ?? "").trim();
  const stamp = String(row[layout.time] ?? "").trim();
  if (!sameIdentity(who, studentId) || !isStampOnDay(stamp, date)) return null;
  return { stamp, timeColumn: layout.time };
}

/** Use a remembered scan clock when today's log row has no time. A shared name is left blank. */
export function withScanTimes(people, byRow = {}, byName = {}) {
  const counts = new Map();
  for (const item of people || []) {
    const key = String(item.name || "").trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return (people || []).map((item) => {
    if (item.time) return item;
    const rowClock = byRow[item.rowNumber] || byRow[String(item.rowNumber)] || "";
    if (rowClock) return { ...item, time: rowClock };
    const key = String(item.name || "").trim().toLowerCase();
    if (counts.get(key) !== 1) return item;
    const named = byName[key] || "";
    return named ? { ...item, time: named } : item;
  });
}

/** Clocks from `matched` and `linked` lines in today's bug log. The last line for a name wins. */
export function clocksFromAppLog(text) {
  const found = {};
  const re = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):\d{2} info (?:matched|linked) (.+)$/gm;
  for (const match of String(text || "").matchAll(re)) {
    const name = match[3].replace(/ ·[\s\S]*$/, "").replace(/ file=[\s\S]*$/, "").trim().toLowerCase();
    if (name) found[name] = `${match[1]}:${match[2]}`;
  }
  return found;
}

/** Pair each present student with one of today's log rows, in sheet order. */
export function attachLogTimes(present, logRows, date) {
  const cursor = new Map();
  return (present || []).map((item) => {
    const key = canonicalStudentId(item.studentId) || String(item.studentId || item.name || "").trim().toLowerCase();
    const hits = logHits(logRows, item.studentId || item.name, date);
    const index = cursor.get(key) || 0;
    cursor.set(key, index + 1);
    const hit = hits[index];
    return {
      name: item.name,
      studentId: item.studentId || "",
      rowNumber: item.rowNumber,
      time: hit ? clockFromStamp(hit.stamp) : "",
      logRow: hit?.rowNumber || 0,
    };
  });
}

/** Keep today's Damascus date and replace the clock. */
export function stampFromClock(date, clock, timeZone = "Asia/Damascus") {
  const parsed = parseClock(clock);
  if (!parsed) return "";
  const day = attendanceStamp(date, timeZone).split(" ")[0];
  const hour = String(parsed.hour).padStart(2, "0");
  const minute = String(parsed.minute).padStart(2, "0");
  return `${day} ${hour}:${minute}:00`;
}

/** Damascus day for a queued mark, so a late sync still hits the day it was scanned. */
export function outboxDay(at, timeZone = "Asia/Damascus") {
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return attendanceStamp(when, timeZone).split(" ")[0];
}

function attendanceKey(item) {
  const id = canonicalStudentId(item?.studentId);
  if (id) return `id:${id}`;
  const row = Number(item?.rowNumber) || 0;
  return row ? `row:${row}` : "";
}

function sameAttendance(a, b) {
  const left = attendanceKey(a);
  const right = attendanceKey(b);
  return Boolean(left) && left === right;
}

export function attendanceListed(people, person) {
  return (people || []).some((item) => sameAttendance(item, person));
}

function queuedPerson(person, kind) {
  return {
    kind,
    studentId: canonicalStudentId(person.studentId) || String(person.studentId || "").trim(),
    studentName: String(person.studentName || "").trim(),
    rowNumber: Number(person.rowNumber) || 0,
    at: person.at,
    time: String(person.time || "").trim(),
    logRow: Number(person.logRow) || 0,
    cell: false,
    log: false,
  };
}

/** One present mark per student per day. A waiting undo for that day is dropped. */
export function queuePresent(items, person, active = null) {
  const list = items || [];
  const day = outboxDay(person.at);
  if (!attendanceKey(person) || !day) return list;
  const rest = list.filter((item) => item === active || !(item.kind === "absent" && sameAttendance(item, person) && outboxDay(item.at) === day));
  if (rest.some((item) => item.kind === "present" && sameAttendance(item, person) && outboxDay(item.at) === day)) return rest;
  return [...rest, queuedPerson(person, "present")];
}

/** Undo before the sheet write drops the mark. After the write, queue a clear. */
export function queueAbsent(items, person, active = null) {
  const list = items || [];
  const day = outboxDay(person.at);
  if (!attendanceKey(person) || !day) return list;
  const open = list.find((item) => item.kind === "present" && sameAttendance(item, person) && outboxDay(item.at) === day);
  if (open && open !== active && !open.cell && !open.log) {
    return list.filter((item) => item !== open && !(item.kind === "time" && sameAttendance(item, person) && outboxDay(item.at) === day));
  }
  const kept = list.filter((item) => {
    if (item === active) return true;
    if (sameAttendance(item, person) && outboxDay(item.at) === day && (item.kind === "time" || item === open)) return false;
    return true;
  });
  if (kept.some((item) => item.kind === "absent" && sameAttendance(item, person) && outboxDay(item.at) === day)) return kept;
  const absent = queuedPerson({ ...person, studentName: person.studentName || open?.studentName || "" }, "absent");
  return [...kept, absent];
}

/** A clock change before the log row exists stays on the present mark. */
export function queueClock(items, person, active = null) {
  const list = items || [];
  const day = outboxDay(person.at);
  if (!attendanceKey(person) || !day) return list;
  const open = list.find((item) => item.kind === "present" && sameAttendance(item, person) && outboxDay(item.at) === day && !item.log);
  if (open && open !== active) return list.map((item) => (item === open ? { ...item, time: String(person.time || "").trim() } : item));
  const rest = list.filter((item) => item === active || !(item.kind === "time" && sameAttendance(item, person) && outboxDay(item.at) === day));
  return [...rest, queuedPerson(person, "time")];
}

/** Today's sheet list plus marks that have not been written yet. */
export function overlayPresent(people, items, day) {
  const list = (people || []).map((person) => ({ ...person }));
  for (const item of items || []) {
    if (outboxDay(item.at) !== day) continue;
    if (item.kind === "absent") {
      for (let i = list.length - 1; i >= 0; i--) {
        if (sameAttendance(list[i], item)) list.splice(i, 1);
      }
      continue;
    }
    const hit = list.find((person) => sameAttendance(person, item));
    if (item.kind === "present" && !hit) {
      list.push({
        name: item.studentName || item.studentId,
        studentId: item.studentId,
        rowNumber: item.rowNumber,
        time: item.time || "",
        logRow: 0,
      });
    } else if (hit && item.time) {
      hit.time = item.time;
    }
  }
  return list;
}

export function findDateColumn(header, date) {
  const when = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(when.getTime())) return null;
  const { day, month, weekday } = calendarDay(when);
  let bare = null;
  for (let i = 0; i < (header || []).length; i++) {
    const parsed = parseDateHeader(header[i]);
    if (!parsed || parsed.day !== day || parsed.month !== month) continue;
    const hit = { columnIndex: i, header: String(header[i]).trim() };
    if (!parsed.weekday) {
      bare = bare || hit;
      continue;
    }
    if (parsed.weekday.toLowerCase() === weekday.toLowerCase()) return hit;
  }
  return bare;
}

/** The date checkbox's checked value is حاضر. An absent cell is empty. Boolean TRUE is a different box. */
export function attendanceValue(present) {
  return present ? "حاضر" : "";
}

/** Local clock for the log sheet. Day/month, same order as the date headers. */
export function attendanceStamp(date, timeZone = "Asia/Damascus") {
  const when = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(when);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${Number(get("day"))}/${Number(get("month"))}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** One log row keyed by Marif id. إسم is filled when that column is already on the sheet. */
export function attendanceLogRow(studentId, date, header = ["الطالب", "حضور"], studentName = "") {
  const layout = logLayout(header);
  const id = canonicalStudentId(studentId) || String(studentId ?? "").trim();
  const size = Math.max((header || []).length, layout.identity + 1, layout.time + 1, layout.name + 1);
  const values = Array.from({ length: size }, () => "");
  values[layout.identity] = id;
  values[layout.time] = attendanceStamp(date);
  if (layout.name >= 0) values[layout.name] = String(studentName ?? "").trim();
  return values;
}

export const FINGERPRINT_HEADER = ["student_id", "fingerprint", "created_at"];

export function fingerprintLayout(header) {
  const cells = (header || []).map(headerText);
  let id = -1;
  let template = -1;
  let created = -1;
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i];
    if (id < 0 && isFingerprintIdHeader(text)) id = i;
    else if (template < 0 && isFingerprintTemplateHeader(text)) template = i;
    else if (created < 0 && isCreatedAtHeader(text)) created = i;
  }
  if (id < 0) id = 0;
  if (template < 0 || template === id) template = id === 0 ? 1 : 0;
  if (created === id || created === template) created = -1;
  return { id, template, created };
}

export function fingerprintHeaderMissing(rows) {
  return !(rows || []).some((row) => (row || []).some((cell) => String(cell ?? "").trim()));
}

/** One id and one template per row. Several rows may share an id. */
export function parseFingerprintSheet(rows) {
  const list = rows || [];
  if (fingerprintHeaderMissing(list)) return { empty: true, header: FINGERPRINT_HEADER, prints: [] };
  const first = list[0] || [];
  const headerLike = first.some((cell) => {
    const text = headerText(cell);
    return isFingerprintIdHeader(text) || isFingerprintTemplateHeader(text) || isCreatedAtHeader(text);
  });
  const header = headerLike ? first : FINGERPRINT_HEADER;
  const layout = fingerprintLayout(header);
  const prints = [];
  for (let i = headerLike ? 1 : 0; i < list.length; i++) {
    const row = list[i] || [];
    const studentId = canonicalStudentId(row[layout.id]);
    const template = String(row[layout.template] ?? "");
    if (!studentId || !template.trim()) continue;
    prints.push({ studentId, template });
  }
  return { empty: false, header, prints };
}

/** One fingerprints-tab row. created_at is the Damascus stamp when that column is already on the sheet. */
export function fingerprintSheetRow(studentId, template, header = FINGERPRINT_HEADER, date = new Date()) {
  const layout = fingerprintLayout(header);
  const size = Math.max((header || []).length, layout.id + 1, layout.template + 1, layout.created + 1);
  const values = Array.from({ length: size }, () => "");
  values[layout.id] = canonicalStudentId(studentId) || String(studentId ?? "").trim();
  values[layout.template] = String(template ?? "");
  if (layout.created >= 0) values[layout.created] = attendanceStamp(date);
  return values;
}

/** Local names for sheet templates, in sheet order. The second print of an id is s-{id}--2.txt. */
export function fingerprintFiles(rows) {
  const { prints } = parseFingerprintSheet(rows);
  const seen = new Map();
  return prints.map((print) => {
    const primary = templateFileForStudent({ studentId: print.studentId });
    const n = (seen.get(print.studentId) || 0) + 1;
    seen.set(print.studentId, n);
    const file = n === 1 ? primary : `${templateStem(primary)}--${n}.txt`;
    return { studentId: print.studentId, template: print.template, file };
  });
}

/**
 * One cell. Never a whole row. present writes the checkbox value حاضر; anything else clears the cell.
 * The student id is the Marif value. A missing id or two rows with that id write nothing.
 * @returns {{op:string, a1?:string, value?:string, values?:string[][], rowNumber?:number, columnIndex?:number, studentId?:string}}
 */
export function planAttendance(rows, studentId, date, present, layout = {}) {
  const grid = parseAttendanceGrid(rows);
  const id = canonicalStudentId(studentId);
  if (grid.idColumn < 0 || !id) return { op: "missing-id" };
  const matches = grid.students.filter((student) => student.studentId === id);
  if (matches.length > 1 || grid.duplicates.includes(id)) return { op: "duplicate", studentId: id };
  if (!matches.length) return { op: "missing-student" };
  const column = findDateColumn(grid.header, date);
  const value = attendanceValue(present);
  if (column) {
    return {
      op: "update",
      studentId: id,
      rowNumber: matches[0].rowNumber,
      columnIndex: column.columnIndex,
      a1: `${columnLetter(column.columnIndex)}${matches[0].rowNumber}`,
      value,
      values: [[value]],
    };
  }
  const insert = planDateColumn(grid.header, layout.formulas, layout.serials, date);
  if (!insert || insert.op !== "insert") return { op: "missing-date" };
  return {
    op: "update",
    studentId: id,
    rowNumber: matches[0].rowNumber,
    columnIndex: insert.insertIndex,
    a1: `${columnLetter(insert.insertIndex)}${matches[0].rowNumber}`,
    value,
    values: [[value]],
    insert,
  };
}

export function mergeStudents(index, rows) {
  const grid = parseAttendanceGrid(rows);
  const duplicateKeys = new Set(grid.duplicates.map((id) => String(id).trim().toLowerCase()));
  const students = {};
  for (const local of Object.values(index?.students || {})) {
    if (!local) continue;
    if (!String(local.studentId || "").trim() && !String(local.studentName || "").trim()) continue;
    if (duplicateKeys.has(studentKey(local))) continue;
    students[studentKey(local)] = persistable(local);
  }
  for (const sheet of grid.students) {
    if (duplicateKeys.has(String(sheet.studentId).trim().toLowerCase())) continue;
    const key = studentKey(sheet);
    const existing = students[key];
    students[key] = persistable({
      studentId: sheet.studentId,
      studentName: sheet.studentName,
      capturedAt: existing?.capturedAt || "",
      templateFile: existing?.templateFile || "",
    });
  }
  return { students, pending: index?.pending || null, duplicates: grid.duplicates };
}

function scoreText(query, text) {
  if (!text) return 0;
  if (text === query) return 5000;
  const at = text.indexOf(query);
  if (at !== -1) return 3000 - at;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      qi += 1;
      streak += 1;
      score += 1 + streak;
    } else if (streak) {
      streak = 0;
    }
  }
  return qi === query.length ? score : 0;
}

export function fuzzyScore(query, student) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 1;
  const name = String(student?.studentName || "").toLowerCase();
  const id = String(student?.studentId || "").toLowerCase();
  if (id && id === q) return 10000;
  return Math.max(scoreText(q, name), id ? scoreText(q, id) : 0);
}

/** The student search list is reread from the sheet at most this often. */
export const CATALOG_REFRESH_MS = 10_000;

export function catalogDue(lastAt, now, intervalMs = CATALOG_REFRESH_MS) {
  return Number(now) - Number(lastAt || 0) >= intervalMs;
}

export function fuzzyStudents(students, query) {
  const list = Array.isArray(students) ? students : Object.values(students || {});
  return list
    .filter((student) => student && (student.studentId || student.studentName))
    .map((student) => ({ student, score: fuzzyScore(query, student) }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.student.studentName).localeCompare(String(b.student.studentName)) ||
        String(a.student.studentId).localeCompare(String(b.student.studentId)),
    )
    .map((hit) => hit.student);
}

export function studentByTemplateSid(students, matchSid) {
  const sid = templateStem(matchSid);
  if (!sid) return null;
  const list = Array.isArray(students) ? students : Object.values(students || {});
  const exact = list.find((student) => templateStem(student?.templateFile) === sid);
  if (exact) return exact;
  return (
    list.find((student) => {
      const stem = templateStem(student?.templateFile);
      return stem && sid.startsWith(`${stem}--`);
    }) || null
  );
}

/** ZK 1:N default is 10. 8 still requires a real hit and accepts a partial scan. */
export const PARTIAL_THRESHOLD = 8;

/** Highest score wins. A weaker print cannot take the match. */
export function bestCandidate(candidates, threshold = PARTIAL_THRESHOLD) {
  let best = null;
  for (const candidate of candidates || []) {
    const score = Number(candidate?.score);
    if (!Number.isFinite(score)) continue;
    const sid = String(candidate?.sid || "");
    if (!best || score > best.score) best = { sid, score };
  }
  const limit = Number(threshold);
  if (!best || !best.sid || best.score < limit) {
    return { matched: false, sid: "", score: best ? best.score : 0, threshold: limit };
  }
  return { matched: true, sid: best.sid, score: best.score, threshold: limit };
}

function judgedPrint(students, judged) {
  if (!judged.matched) return { kind: "new", ...judged };
  const student = studentByTemplateSid(students, judged.sid);
  return student ? { kind: "known", student, ...judged } : { kind: "new", ...judged };
}

/** Known only when identify hit a template that is already linked to a student. */
export function decidePrint(students, outcome) {
  if (outcome?.timedOut) return { kind: "timeout" };
  const threshold = outcome?.matchThreshold ?? outcome?.threshold ?? PARTIAL_THRESHOLD;
  if (Array.isArray(outcome?.candidates)) return judgedPrint(students, bestCandidate(outcome.candidates, threshold));
  if (outcome?.matchScore !== null && outcome?.matchScore !== undefined && outcome?.matchScore !== "") {
    const sid = outcome.matchSid || outcome.matchBestSid || "";
    return judgedPrint(students, bestCandidate([{ sid, score: outcome.matchScore }], threshold));
  }
  if (!outcome?.matched || !outcome.matchSid) return { kind: "new" };
  const student = studentByTemplateSid(students, outcome.matchSid);
  return student ? { kind: "known", student } : { kind: "new" };
}

/**
 * Attendance is the default. The picker opens only when the print matches no stored template.
 * A timeout is not a success and carries no image.
 */
export function captureScreen(students, result) {
  if (!result?.ok || result.timedOut || result?.kind === "timeout") {
    return { attendance: false, picker: false, imagePath: "" };
  }
  const imagePath = String(result.imagePath || "").trim();
  const decision = decidePrint(students, result);
  if (decision.kind === "timeout") return { attendance: false, picker: false, imagePath: "" };
  if (decision.kind === "known") {
    return { attendance: true, picker: false, imagePath, student: decision.student, score: decision.score, threshold: decision.threshold };
  }
  const reason =
    result.matchLoaded === 0
      ? "No stored prints were loaded."
      : Number.isFinite(decision.score)
        ? `Best score ${decision.score} vs threshold ${decision.threshold}.`
        : "";
  return { attendance: false, picker: true, imagePath, reason, score: decision.score, threshold: decision.threshold };
}
