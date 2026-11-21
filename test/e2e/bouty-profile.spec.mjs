import { test, expect } from "./fixtures/app.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

test.use({ fixtureOptions: { config: { attendanceDestination: "bouty", zk4500Cli: "Z:/missing-test-scanner.exe" } } });

async function mockBouty(electron) {
  await electron.evaluate(({ session }) => {
    const origin = "https://albouty.saas.alkheir-platform.com";
    const escaped = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const snapshot = (name, data) => JSON.stringify({ memo: { name }, data });
    const html = (name, data, inner = "") => `<script data-update-uri="/livewire-test/update"></script><div wire:snapshot="${escaped(snapshot(name, data))}">${inner}</div>`;
    const roster = (page = 1, search = "") => {
      const rows = page === 2 ? '<tr><td>Another Student</td><td>91</td><td><button wire:click="edit(10)"></button></td></tr>'
        : `<tr><td>${globalThis.boutyTestName}</td><td>90</td><td><button wire:click="edit(9)"></button></td></tr>`;
      const next = !search && page === 1 ? '<button wire:click="nextPage(\'page\')"></button>' : "";
      return html("students.index", {}, `<table>${rows}</table>${next}`);
    };
    const enrollments = html("enrollments.index", { courseFilter: "1" },
      '<table><tr><td>1</td><td>Website Student</td><td>Website Group</td><td>Winter</td><td><button wire:click="edit(31)"></button></td></tr></table>');
    const attendanceDay = html("attendance.index", { course_id: "1" },
      '<select id="attendance-day-course"><option value="1">Winter</option></select><table><tr><td>12-10-2026</td><td>Winter</td><td><a href="/attendance/days/students/22">open</a></td></tr></table>');
    globalThis.boutyTestName = "Website Student";
    globalThis.boutyTestAttendance = [];
    for (const name of ["bouty-login-check", "bouty-students", "bouty-attendance"]) {
      session.fromPartition(name).fetch = async (url, opts = {}) => {
        if (new URL(url).origin !== origin) throw new Error("Unexpected synthetic Bouty origin");
        const pathname = new URL(url).pathname;
        if (pathname === "/login" && opts.method === "POST") return new Response("", { status: 302, headers: { location: origin + "/dashboard" } });
        if (pathname === "/login") return new Response('<input name="_token" value="token">');
        if (pathname === "/attendance") return new Response('<meta name="csrf-token" content="token"><body data-current-user-id="1">' + attendanceDay);
        if (pathname === "/students") return new Response(roster());
        if (pathname === "/enrollments") return new Response(enrollments);
        if (pathname === "/attendance/days/students/22") return new Response('<a href="/student-attendance/groups/8">group</a>');
        if (pathname === "/student-attendance/groups/8") {
          return new Response('<table><tr data-attendance-type="student" data-attendance-entity-id="31"><td><select><option value="1">حاضر</option></select></td></tr></table>');
        }
        if (pathname === "/attendance/offline-sync") {
          const [operation] = JSON.parse(opts.body).operations;
          globalThis.boutyTestAttendance.push(operation);
          return Response.json({ results: [{ client_operation_id: operation.client_operation_id, status: "synced" }] });
        }
        if (pathname === "/livewire-test/update") {
          const request = JSON.parse(opts.body).components[0], state = JSON.parse(request.snapshot);
          const action = request.calls[0];
          if (state.memo.name === "students.index" && action?.method === "edit") {
            Object.assign(state.data, { editingId: action.params[0], first_name: "Website", last_name: "Student", notes: "معرف المصدر: 5", school_name: "Website School" });
          }
          if (state.memo.name === "enrollments.index" && action?.method === "edit") Object.assign(state.data, { student_id: 9, status: "active" });
          const rendered = state.memo.name === "students.index" ? roster(action?.method === "gotoPage" ? action.params[0] : 1, request.updates.search)
            : state.memo.name === "enrollments.index" ? enrollments : attendanceDay;
          const body = { components: [{ snapshot: JSON.stringify(state), effects: { html: rendered } }] };
          return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected synthetic Bouty request: ${pathname}`);
      };
    }
  });
}

test("Bouty roster can refresh, open a profile, and mark attendance on the website", async ({ app }) => {
  await mockBouty(app.electron);
  await app.page.locator("#settings").click();
  await app.page.locator("#destination-bouty").click();
  await app.page.locator("#bouty-user").fill("synthetic-user");
  await app.page.locator("#bouty-password").fill("synthetic-password");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#bouty-status")).toContainText("saved");
  await app.page.locator("#attendance").click();
  await app.page.locator("#mark-manual").click();
  const list = app.page.locator("#manual-list");
  await expect(list).toContainText("Website Student");
  await app.page.locator("#bouty-roster-next").click();
  await expect(list).toContainText("Another Student");
  await app.electron.evaluate(() => { globalThis.boutyTestName = "Refreshed Student"; });
  await app.page.locator("#bouty-roster-refresh").click();
  await expect(list).toContainText("Refreshed Student");
  await list.getByRole("button").click();
  await expect(app.page.locator("#confirm-profile-fields")).toContainText("Website School");
  await expect(app.page.locator("#confirm-profile-chips")).toContainText("Website Group");
  await expect(app.page.locator("#confirm-name")).toHaveText("Website Student");
  await app.page.locator("#confirm-ok").click();
  await expect.poll(() => app.electron.evaluate(() => globalThis.boutyTestAttendance)).toEqual([
    expect.objectContaining({ day_id: 22, entity_id: 31, status_id: 1 }),
  ]);
  await expect(app.page.locator("#today-list")).toContainText("Website Student");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBeGreaterThan(1);
});

test("Bouty picker and scan card use website student information", async ({ app }) => {
  await mockBouty(app.electron);
  await app.page.locator("#settings").click();
  await app.page.locator("#destination-bouty").click();
  await app.page.locator("#bouty-user").fill("synthetic-user");
  await app.page.locator("#bouty-password").fill("synthetic-password");
  await app.page.locator("#save-bouty").click();
  await expect(app.page.locator("#bouty-status")).toContainText("saved");
  const index = await readFile(path.join(app.prints, "index.json"), "utf8").then(JSON.parse).catch(() => ({ students: {} }));
  index.pending = { capturedAt: "2026-10-12T13:55:03.000Z" };
  await writeFile(path.join(app.prints, "index.json"), JSON.stringify(index));
  await writeFile(path.join(app.prints, "pending.txt"), "synthetic-print");
  await app.restart();
  await mockBouty(app.electron);
  await expect(app.page.locator("#pending")).toBeVisible();
  await app.page.locator("#search").fill("Website");
  await expect(app.page.locator("#list button")).toHaveCount(1);
  await expect(app.page.locator("#list button")).toContainText("Website Student");
  await app.page.locator("#list button").click();
  await expect(app.page.locator("#last-name")).toHaveText("Website Student");
  await expect(app.page.locator("#last-fields")).toContainText("Website School");
  await expect.poll(() => app.sheets.grid("AttendanceLog").rows.length).toBeGreaterThan(1);
  expect(app.sheets.grid("AttendanceLog").rows[1][2]).toBe("12/10/2026 16:55:03");
  await expect.poll(() => app.sheets.grid("FingerPrints").rows.length).toBeGreaterThan(1);
  expect(app.sheets.requests.some((request) => String(request.url).includes("attendance-test"))).toBe(false);
});
