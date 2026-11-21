import { randomUUID } from "node:crypto";
import { createBoutyResolver } from "./bouty-resolve.mjs";

// This endpoint is the one used by the site's manual attendance controls.
const ORIGIN = "https://albouty.saas.alkheir-platform.com";

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Invalid ${field}.`);
  return number;
}

/** The supplied fetch must use an isolated, cookie-enabled Electron session. */
export function createBoutyClient(fetch) {
  let csrf = "";
  let userId = "";

  async function page(path, options = {}) {
    const expired = () => Object.assign(new Error("Bouty session expired."), { code: "BOUTY_SESSION_EXPIRED" });
    // Electron can cancel a manual redirect after receiving headers.
    const response = await fetch(`${ORIGIN}${path}`, { ...options, credentials: "include", redirect: "manual", signal: AbortSignal.timeout(30000) })
      .catch((error) => { throw error?.message === "Redirect was cancelled" ? expired() : new Error("Bouty connection failed."); });
    if ([301, 302, 303, 307, 308, 401, 419].includes(response.status) || response.type === "opaqueredirect") throw expired();
    if (!response.ok || (response.url && new URL(response.url).origin !== ORIGIN)) throw new Error("Bouty connection failed.");
    return response;
  }

  const resolve = createBoutyResolver({ origin: ORIGIN, page, csrf: () => csrf });
  return {
    async logout() {
      const token = csrf;
      csrf = "";
      userId = "";
      if (!token) return;
      await fetch(`${ORIGIN}/logout`, {
        method: "POST", credentials: "include", redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ _token: token }).toString(),
      });
    },
    async login(username, password) {
      csrf = "";
      userId = "";
      if (!String(username || "").trim() || !password) throw new Error("Enter the Bouty username and password.");
      const login = await (await page("/login")).text();
      const token = login.match(/<input\b[^>]*name=["']_token["'][^>]*value=["']([^"']+)["']/i)?.[1];
      if (!token) throw new Error("Bouty login form changed.");
      let response;
      try {
        response = await fetch(`${ORIGIN}/login`, {
          method: "POST",
          credentials: "include",
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ _token: token, login: String(username).trim(), password: String(password) }).toString(),
        });
      } catch (error) {
        // Electron cancels manual redirects after receiving the session cookie.
        if (error?.message !== "Redirect was cancelled") throw new Error("Bouty connection failed.");
      }
      if (response && response.status !== 302 && response.status !== 303 && response.type !== "opaqueredirect") throw new Error("Bouty login failed.");
      const location = response?.headers.get("location");
      if (location) {
        const destination = new URL(location, ORIGIN);
        if (destination.origin !== ORIGIN || ["/login", "/change-temporary-password"].includes(destination.pathname)) throw new Error("Bouty login failed.");
      }
      const attendanceResponse = await page("/attendance").catch(() => { throw new Error("Bouty could not verify the sign-in."); });
      const attendance = await attendanceResponse.text();
      const nextCsrf = attendance.match(/<meta\b[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)?.[1];
      const nextUser = attendance.match(/\bdata-current-user-id=["'](\d+)["']/i)?.[1];
      if (!nextCsrf || !nextUser) throw new Error("Bouty attendance page is unavailable.");
      csrf = nextCsrf;
      userId = nextUser;
    },

    async resolve(input) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve(input);
    },
    async student(input) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve.student(input);
    },
    async studentsFor(query) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve.studentsFor(query);
    },
    async roster(query, pageNumber) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve.roster(query, positiveInteger(pageNumber, "roster page"));
    },
    async rosterProfiles(pageNumber) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve.rosterProfiles(positiveInteger(pageNumber, "roster page"));
    },
    async studentById(id, studentNumber) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      return resolve.studentById(positiveInteger(id, "student ID"), studentNumber);
    },
    async mark({ dayId, enrollmentId, statusId, changedAt, operationId }) {
      if (!csrf || !userId) throw new Error("Sign in to Bouty first.");
      const day = positiveInteger(dayId, "attendance day");
      const entity = positiveInteger(enrollmentId, "enrolment");
      const status = positiveInteger(statusId, "attendance status");
      const timestamp = new Date(changedAt);
      if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid attendance time.");
      const id = operationId || randomUUID();
      if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("Invalid operation ID.");
      const operation = {
        key: `${userId}:student:${day}:${entity}`,
        client_operation_id: id,
        user_id: userId,
        type: "student",
        day_id: day,
        entity_id: entity,
        status_id: status,
        changed_at: timestamp.toISOString(),
        queued_offline: true,
        state: "pending",
      };
      const response = await page("/attendance/offline-sync", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-TOKEN": csrf },
        body: JSON.stringify({ operations: [operation] }),
      });
      const result = await response.json();
      const item = result.results?.find((entry) => entry.client_operation_id === id);
      if (item?.status !== "synced") throw new Error("Bouty did not confirm the attendance change.");
    },
  };
}
