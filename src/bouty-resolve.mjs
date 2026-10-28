import { parse } from "parse5";

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
    .map((value) => value.trim().replace(/\s+/g, ""));
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
  return async ({ studentId, studentName, date, kind }) => {
    if (!studentName?.trim()) throw new Error("Bouty needs the student's name to identify the enrolment.");
    const students = await load("/students", "students.index");
    await call(students, null, { search: studentName });
    const matched = [];
    for (const id of editIds(students.html)) {
      await call(students, "edit", {}, [id]);
      if (sourceIds(students.data.notes).includes(studentId.replace(/\s+/g, ""))) matched.push(id);
    }
    if (matched.length !== 1) throw new Error("Bouty student identity is missing or ambiguous.");
    const enrollments = await load("/enrollments", "enrollments.index");
    await call(enrollments, null, { search: studentName });
    const found = [];
    for (const id of editIds(enrollments.html)) {
      await call(enrollments, "edit", {}, [id]);
      if (String(enrollments.data.student_id) === String(matched[0]) && enrollments.data.status === "active") found.push(id);
    }
    if (found.length !== 1) throw new Error("Bouty active enrolment is missing or ambiguous.");
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
      const status = cached.entries.get(String(found[0]))?.[kind === "absent" ? "absent" : "present"];
      if (status) matches.push(status);
    }
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] < 1) throw new Error("Bouty enrolment is not in the attendance day.");
    return { dayId: days[0], enrollmentId: found[0], statusId: matches[0] };
  };
}
