import { randomUUID } from "node:crypto";
import { canonicalStudentId } from "./store.mjs";
import { parseBoutyMapping } from "./bouty-storage.mjs";

function damascusDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid attendance time.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The caller supplies the current day's ID and explicit roster-to-enrolment mapping. */
export function createBoutySync({ queue, credentials, client, settings, studentName = async () => "", onStatus = () => {} }) {
  let running = null;
  let rerun = false;
  async function drain() {
    const items = await queue.list();
    if (!items.length) { onStatus(""); return; }
    const account = await credentials.read();
    if (!account) { onStatus("Bouty: sign in to sync attendance."); return; }
    const config = await settings();
    const mapping = parseBoutyMapping(config.mapping);
    await client.login(account.username, account.password);
    const blocked = new Set();
    let warning = "";
    for (const item of items) {
      if (blocked.has(item.studentId)) continue;
      let enrollmentId = mapping.get(canonicalStudentId(item.studentId));
      let dayId = config.days?.[damascusDate(item.at)];
      let statusId = item.kind === "absent" ? config.absentStatusId : config.presentStatusId;
      if ((!enrollmentId || !dayId || !statusId) && typeof client.resolve === "function") {
        try {
          ({ enrollmentId, dayId, statusId } = await client.resolve({ studentId: item.studentId,
            studentName: item.studentName || await studentName(item.studentId), date: damascusDate(item.at), kind: item.kind }));
        } catch (error) {
          if (!/^Bouty (student identity|active enrolment|enrolment is not|needs the student's name|search is ambiguous)/.test(error?.message || "")) throw error;
          blocked.add(item.studentId);
          warning = error.message;
          continue;
        }
      }
      if (!enrollmentId || !dayId || !statusId) { onStatus("Bouty: an attendance day or student mapping is missing."); return; }
      await client.mark({ dayId, enrollmentId, statusId, changedAt: item.at, operationId: item.id });
      await queue.remove(item.id);
    }
    onStatus(warning);
  }
  function sync() {
    if (running) { rerun = true; return running; }
    running = drain().catch((error) => onStatus(error?.message?.startsWith("Bouty ") ? error.message : "Bouty: attendance is waiting to sync.")).finally(() => {
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
      await queue.enqueue({ id: randomUUID(), studentId: id, studentName: String(name || "").trim(), kind, at });
    },
    sync,
  };
}
