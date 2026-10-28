import { parse } from "parse5";
import { canonicalStudentId } from "./store.mjs";

function walk(node, test, out = []) {
  if (test(node)) out.push(node);
  for (const child of node.childNodes || []) walk(child, test, out);
  return out;
}
function attr(node, name) { return node.attrs?.find((item) => item.name === name)?.value || ""; }
function content(node) { return node.nodeName === "#text" ? node.value : (node.childNodes || []).map(content).join(" "); }
function document(html) { return parse(html); }
function component(html, name) {
  for (const node of walk(document(html), (entry) => Boolean(attr(entry, "wire:snapshot")))) {
    const snapshot = attr(node, "wire:snapshot");
    const value = JSON.parse(snapshot);
    if (value.memo?.name === name) return { snapshot, value };
  }
  throw new Error("Bouty page changed.");
}
function editIds(html) {
  const ids = walk(document(html), (node) => /^edit\(\d+\)$/.test(attr(node, "wire:click")))
    .map((node) => Number(attr(node, "wire:click").match(/\d+/)[0]));
  if (ids.length >= 15) throw new Error("Bouty search is ambiguous.");
  return [...new Set(ids)];
}
function sourceIds(notes) {
  const marker = "معرف المصدر:";
  return String(notes || "").split(/\r?\n/).filter((line) => line.includes(marker))
    .flatMap((line) => line.split(marker)[1].split(","))
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => /^\d+(?: \d+)*$/.test(value));
}

/** Roster IDs use grouped zero padding; imported Bouty source IDs are numeric. */
export function normalizeBoutySourceId(value) {
  const id = canonicalStudentId(value).replace(/\s+/g, "");
  return id.replace(/^0+(?=\d)/, "");
}

/** Only expose a site student when their source ID and local fingerprint identity are unambiguous. */
export function boutyStudentChoices(profiles, localStudents) {
  const candidates = (profiles || []).map((profile) => {
    const ids = [...new Set((profile.sourceIds || []).map(canonicalStudentId).filter(Boolean))];
    const normalized = [...new Set(ids.map(normalizeBoutySourceId))];
    return { profile, ids, normalized };
  }).filter((item) => item.profile.studentName && item.normalized.length === 1);
  const counts = new Map();
  for (const item of candidates) counts.set(item.normalized[0], (counts.get(item.normalized[0]) || 0) + 1);
  const choices = [];
  for (const item of candidates) {
    const identity = item.normalized[0];
    if (counts.get(identity) !== 1) continue;
    const local = Object.values(localStudents || {}).filter((student) => {
      const id = canonicalStudentId(student?.studentId);
      return id && normalizeBoutySourceId(id) === identity;
    });
    if (local.length > 1) continue;
    if (!local.length && identity.length > 10) continue;
    const padded = identity.padStart(10, "0");
    const rosterId = `${padded.slice(0, 2)} ${padded.slice(2, 4)} ${padded.slice(4, 7)} ${padded.slice(7)}`;
    choices.push({ siteId: item.profile.id, studentId: local[0]?.studentId || rosterId, studentName: item.profile.studentName,
      templateFile: local[0]?.templateFile || "", capturedAt: local[0]?.capturedAt || "" });
  }
  return choices;
}

/** A slower lookup must never replace the card for a later scan. */
export function applyBoutyProfile(match, at, studentId, profile, destination) {
  if (destination !== "bouty" || match?.at !== at || canonicalStudentId(match.studentId) !== canonicalStudentId(studentId)) return null;
  return { ...match, studentName: profile.studentName, fields: profile.fields, profileStatus: "" };
}

function siteProfile(data, html, studentNumber = "") {
  const fields = [];
  const add = (label, value, kind = "chip") => {
    const text = String(value ?? "").trim();
    if (text) fields.push({ label, value: text, kind });
  };
  const tree = document(html);
  const grade = walk(tree, (node) => attr(node, "id") === "student-grade-level")[0];
  const selected = grade && walk(grade, (node) => node.tagName === "option" && attr(node, "value") === String(data.grade_level_id ?? ""))[0];
  add("رقم الطالب", studentNumber);
  if (data.grade_level_id && selected) add("المرحلة الدراسية", content(selected));
  if (data.birth_date) add("سنة الميلاد", String(data.birth_date).slice(0, 4));
  add("المدرسة", data.school_name, "line");
  add("هاتف الطالب", data.student_phone, "phone");
  add("الجزء الحالي", data.quran_current_juz_number);
  add("الجنس", ({ male: "ذكر", female: "أنثى" })[data.gender] || data.gender);
  add("الحالة", ({ active: "نشط", inactive: "غير نشط", graduated: "متخرج", blocked: "موقوف" })[data.status] || data.status);
  add("تاريخ الانضمام", data.joined_at);
  return { studentName: [data.first_name, data.last_name].filter(Boolean).join(" ").trim(), fields };
}

/** Resolves only exact source IDs and an active enrolment in the site's default course. */
export function createBoutyResolver({ page, csrf }) {
  const groupCache = new Map();
  async function load(path, name) {
    const html = await (await page(path)).text();
    const tree = document(html);
    const script = walk(tree, (node) => Boolean(attr(node, "data-update-uri")))[0];
    const url = new URL(attr(script || {}, "data-update-uri"));
    if (url.origin !== "https://albouty.saas.hassiba.tech") throw new Error("Unexpected Bouty update URL.");
    const found = component(html, name);
    return { html, snapshot: found.snapshot, data: found.value.data, url: url.href };
  }
  async function call(ctx, method, updates = {}, params = []) {
    const response = await page(new URL(ctx.url).pathname, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Livewire": "true" },
      body: JSON.stringify({ _token: csrf(), components: [{ snapshot: ctx.snapshot, updates, calls: method ? [{ path: "", method, params }] : [] }] }),
    });
    const value = await response.json();
    const updated = value.components?.[0];
    if (!updated?.snapshot) throw new Error("Bouty did not return the page state.");
    ctx.snapshot = updated.snapshot;
    ctx.data = JSON.parse(updated.snapshot).data;
    ctx.html = updated.effects?.html || ctx.html;
  }
  async function studentsFor(query) {
    if (!query?.trim()) return [];
    const ctx = await load("/students", "students.index");
    await call(ctx, null, { search: query });
    const numbers = new Map();
    for (const row of walk(document(ctx.html), (node) => node.tagName === "tr")) {
      const button = walk(row, (node) => /^edit\(\d+\)$/.test(attr(node, "wire:click")))[0];
      const cells = walk(row, (node) => node.tagName === "td");
      if (button && cells[1]) numbers.set(Number(attr(button, "wire:click").match(/\d+/)[0]), content(cells[1]).replace(/\s+/g, " ").trim());
    }
    const profiles = [];
    for (const id of editIds(ctx.html)) {
      await call(ctx, "edit", {}, [id]);
      profiles.push({ id, sourceIds: sourceIds(ctx.data.notes), ...siteProfile(ctx.data, ctx.html, numbers.get(id)) });
    }
    return profiles;
  }
  async function student({ studentId, studentName }) {
    const wanted = normalizeBoutySourceId(studentId);
    if (!wanted) throw new Error("Bouty student identity is missing or ambiguous.");
    const queries = [...new Set([String(studentName || "").trim(), wanted].filter(Boolean))];
    for (const query of queries) {
      const matched = (await studentsFor(query)).filter((profile) => profile.sourceIds.some((id) => normalizeBoutySourceId(id) === wanted));
      if (matched.length > 1) throw new Error("Bouty student identity is missing or ambiguous.");
      if (matched.length === 1) {
        if (!matched[0].studentName) throw new Error("Bouty student information is unavailable.");
        return matched[0];
      }
    }
    throw new Error("Bouty student identity is missing or ambiguous.");
  }
  async function enrollment(matched) {
    const enrollments = await load("/enrollments", "enrollments.index");
    await call(enrollments, null, { search: matched.studentName });
    const groups = new Map();
    for (const row of walk(document(enrollments.html), (node) => node.tagName === "tr")) {
      const button = walk(row, (node) => /^edit\(\d+\)$/.test(attr(node, "wire:click")))[0];
      const cells = walk(row, (node) => node.tagName === "td");
      if (button && cells[2]) groups.set(Number(attr(button, "wire:click").match(/\d+/)[0]), content(cells[2]).replace(/\s+/g, " ").trim());
    }
    const found = [];
    for (const id of editIds(enrollments.html)) {
      await call(enrollments, "edit", {}, [id]);
      if (String(enrollments.data.student_id) === String(matched.id) && enrollments.data.status === "active") found.push(id);
    }
    if (found.length !== 1) throw new Error("Bouty active enrolment is missing or ambiguous.");
    return { id: found[0], group: groups.get(found[0]) || "" };
  }
  async function resolve({ studentId, studentName, date, kind }) {
    const matched = await student({ studentId, studentName });
    const enrolled = await enrollment(matched);
    const attendance = await load("/attendance", "attendance.index");
    const course = String(attendance.data.course_id || "");
    await call(attendance, "openCreateModal", { search: date });
    const tree = document(attendance.html);
    const select = walk(tree, (node) => attr(node, "id") === "attendance-day-course")[0];
    const option = select && walk(select, (node) => node.tagName === "option" && attr(node, "value") === course)[0];
    const courseName = option && content(option).replace(/\s+/g, " ").trim();
    if (!courseName) throw new Error("Bouty default course is unavailable.");
    const formatted = date.split("-").reverse().join("-");
    const rows = walk(tree, (node) => node.tagName === "tr");
    const days = [];
    for (const row of rows) {
      const cells = walk(row, (node) => node.tagName === "td").map((cell) => content(cell).replace(/\s+/g, " ").trim());
      if (!cells.some((cell) => cell.includes(formatted)) || !cells.includes(courseName)) continue;
      for (const link of walk(row, (node) => node.tagName === "a")) {
        const match = attr(link, "href").match(/\/attendance\/days\/students\/(\d+)(?:[?#]|$)/);
        if (match) days.push(Number(match[1]));
      }
    }
    if (days.length !== 1) throw new Error("Bouty attendance day is missing or ambiguous.");
    const detail = await (await page(`/attendance/days/students/${days[0]}`)).text();
    const links = walk(document(detail), (node) => node.tagName === "a").map((node) => attr(node, "href").match(/\/student-attendance\/groups\/(\d+)(?:[?#]|$)/)?.[1]).filter(Boolean);
    const matches = [];
    for (const group of new Set(links)) {
      let cached = groupCache.get(group);
      if (!cached || cached.until <= Date.now()) {
        const html = await (await page(`/student-attendance/groups/${group}`)).text();
        const entries = new Map();
        for (const row of walk(document(html), (node) => attr(node, "data-attendance-type") === "student" && attr(node, "data-attendance-entity-id"))) {
          const id = attr(row, "data-attendance-entity-id");
          const statuses = {};
          for (const option of walk(row, (node) => node.tagName === "option")) {
            const label = content(option).trim().toLowerCase();
            if (["present", "حاضر"].includes(label)) statuses.present = Number(attr(option, "value"));
            if (["absent", "غائب"].includes(label)) statuses.absent = Number(attr(option, "value"));
          }
          entries.set(id, entries.has(id) ? null : statuses);
        }
        // ponytail: short cache avoids loading every group for every scan; expiry refreshes changes.
        cached = { until: Date.now() + 30000, entries };
        groupCache.set(group, cached);
      }
      const status = cached.entries.get(String(enrolled.id))?.[kind === "absent" ? "absent" : "present"];
      if (status) matches.push(status);
    }
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] < 1) throw new Error("Bouty enrolment is not in the attendance day.");
    return { dayId: days[0], enrollmentId: enrolled.id, statusId: matches[0] };
  }
  resolve.student = async (input) => {
    const profile = await student(input);
    try {
      const current = await enrollment(profile);
      if (current.group) profile.fields.push({ label: "المجموعة", value: current.group, kind: "chip" });
    } catch { /* The profile remains useful if no unique active enrolment is available. */ }
    return profile;
  };
  resolve.studentsFor = studentsFor;
  return resolve;
}
