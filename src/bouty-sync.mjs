import { randomUUID } from "node:crypto";
import { canonicalStudentId } from "./store.mjs";
import { parseBoutyMapping } from "./bouty-storage.mjs";

function damascusDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid attendance time.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The caller supplies the current day's ID and explicit roster-to-enrolment mapping. */
export function createBoutySync({ queue, credentials, client, settings, studentName = async () => "", onStatus = () => {},
  withSession = (run) => run(client), accountKey = () => undefined }) {
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
    await api.login(account.username, account.password);
    const blocked = new Set();
    const unavailableDays = new Set();
    let warning = "";
    for (const item of items) {
      const date = damascusDate(item.at);
      const key = `${date}:${item.studentId}`;
      if (blocked.has(key) || unavailableDays.has(date)) continue;
      let enrollmentId = mapping.get(canonicalStudentId(item.studentId));
      let dayId = config.days?.[date];
      let statusId = item.kind === "absent" ? config.absentStatusId : config.presentStatusId;
      if ((!enrollmentId || !dayId || !statusId) && typeof api.resolve === "function") {
        try {
          ({ enrollmentId, dayId, statusId } = await api.resolve({ studentId: item.studentId,
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
      const id = canonicalStudentId(studentId);
      if (!id || !["present", "absent"].includes(kind)) throw new Error("Invalid Bouty attendance.");
      damascusDate(at);
      await queue.enqueue({ id: randomUUID(), studentId: id, studentName: String(name || "").trim(), kind, at, owner: accountKey() });
    },
    sync,
  };
}
