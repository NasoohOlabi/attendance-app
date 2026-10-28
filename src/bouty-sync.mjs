import { randomUUID } from "node:crypto";
import { canonicalStudentId } from "./store.mjs";
import { parseBoutyMapping } from "./bouty-storage.mjs";

function damascusDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid attendance time.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The caller supplies the current day's ID and explicit roster-to-enrolment mapping. */
export function createBoutySync({ queue, credentials, client, settings, onStatus = () => {} }) {
  let running = null;
  async function drain() {
    const items = await queue.list();
    if (!items.length) { onStatus(""); return; }
    const account = await credentials.read();
    if (!account) { onStatus("Bouty: sign in to sync attendance."); return; }
    const config = await settings();
    const mapping = parseBoutyMapping(config.mapping);
    await client.login(account.username, account.password);
    for (const item of items) {
      const enrollmentId = mapping.get(canonicalStudentId(item.studentId));
      const dayId = config.days?.[damascusDate(item.at)];
      const statusId = item.kind === "absent" ? config.absentStatusId : config.presentStatusId;
      if (!enrollmentId || !dayId || !statusId) {
        onStatus("Bouty: an attendance day or student mapping is missing.");
        return;
      }
      await client.mark({ dayId, enrollmentId, statusId, changedAt: item.at, operationId: item.id });
      await queue.remove(item.id);
    }
    onStatus("");
  }
  return {
    async enqueue(studentId, kind, at = new Date().toISOString()) {
      const id = canonicalStudentId(studentId);
      if (!id || !["present", "absent"].includes(kind)) throw new Error("Invalid Bouty attendance.");
      damascusDate(at);
      await queue.enqueue({ id: randomUUID(), studentId: id, kind, at });
    },
    sync() {
      if (!running) {
        running = drain().catch(() => onStatus("Bouty: attendance is waiting to sync.")).finally(() => { running = null; });
      }
      return running;
    },
  };
}
