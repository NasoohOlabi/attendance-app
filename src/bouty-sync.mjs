import { randomUUID } from "node:crypto";
import { canonicalPrintStudentId } from "./store.mjs";
import { parseBoutyMapping } from "./bouty-storage.mjs";
import { normalizeBoutySourceId } from "./bouty-resolve.mjs";

function damascusDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid attendance time.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The caller supplies the current day's ID and explicit roster-to-enrolment mapping. */
export function createBoutySync({ queue, credentials, client, settings, studentName = async () => "", onStatus = () => {},
  withSession = (run) => run(client), accountKey = () => undefined, sourceLinks = () => new Map() }) {
  let running = null;
  let rerun = false;
  async function drain(api) {
    const owner = accountKey();
    const items = (await queue.list()).filter((item) => item.owner === owner);
    if (!items.length) { onStatus(""); return; }
    const account = await credentials.read();
    if (!account) { onStatus("Bouty: sign in to sync attendance."); return; }
    const config = await settings();
    const mapping = parseBoutyMapping(config.mapping);
    const links = sourceLinks();
    const migratedMapping = new Map();
    for (const [legacyId, enrollmentId] of mapping) {
      const id = links.get(normalizeBoutySourceId(legacyId));
      if (id) migratedMapping.set(id, migratedMapping.has(id) ? null : enrollmentId);
    }
    await api.login(account.username, account.password);
    const blocked = new Set();
    const unavailableDays = new Set();
    let warning = "";
    for (const item of items) {
      const date = damascusDate(item.at);
      const link = links.get(normalizeBoutySourceId(item.studentId));
      const studentId = link || item.studentId;
      const key = `${date}:${studentId}`;
      if (blocked.has(key) || unavailableDays.has(date)) continue;
      let enrollmentId = mapping.get(studentId) || mapping.get(item.studentId) || migratedMapping.get(studentId);
      let dayId = config.days?.[date];
      let statusId = item.kind === "absent" ? config.absentStatusId : config.presentStatusId;
      if ((!enrollmentId || !dayId || !statusId) && typeof api.resolve === "function") {
        if (link === null) {
          blocked.add(key);
          warning = "Bouty student identity is missing or ambiguous.";
          continue;
        }
        try {
          ({ enrollmentId, dayId, statusId } = await api.resolve({ studentId,
            studentName: item.studentName || await studentName(item.studentId), date, kind: item.kind }));
        } catch (error) {
          if (/^Bouty (has no attendance day|attendance day is missing or ambiguous)/.test(error?.message || "")) unavailableDays.add(date);
          else if (/^Bouty (student identity|active enrolment|enrolment is not|needs the student's name|search is ambiguous)/.test(error?.message || "")) blocked.add(key);
          else throw error;
          warning = error.message;
          continue;
        }
      }
      if (!enrollmentId || !dayId || !statusId) { onStatus("Bouty: an attendance day or student mapping is missing."); return; }
      await api.mark({ dayId, enrollmentId, statusId, changedAt: item.at, operationId: item.id });
      await queue.confirm(item.id);
    }
    onStatus(warning);
  }
  function sync() {
    if (running) { rerun = true; return running; }
    running = withSession(drain).catch((error) => onStatus(error?.message?.startsWith("Bouty ") ? error.message : "Bouty: attendance is waiting to sync.")).finally(() => {
      running = null;
      if (rerun) { rerun = false; void sync(); }
    });
    return running;
  }
  return {
    async enqueue(studentId, kind, at = new Date().toISOString(), name = "") {
      const id = canonicalPrintStudentId(studentId);
      if (!id || !["present", "absent"].includes(kind)) throw new Error("Invalid Bouty attendance.");
      damascusDate(at);
      await queue.enqueue({ id: randomUUID(), studentId: id, studentName: String(name || "").trim(), kind, at, owner: accountKey() });
    },
    sync,
  };
}
