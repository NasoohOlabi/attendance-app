export function mockBouty(session) {
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
  globalThis.boutyTestLogins = 0;
  globalThis.boutyTestLogouts = 0;
  let connected = false;
  session.fromPartition("bouty-students").fetch = async (url, opts = {}) => {
    if (new URL(url).origin !== origin) throw new Error("Unexpected synthetic Bouty origin");
    const pathname = new URL(url).pathname;
    if (globalThis.boutyTestDisconnected) throw new Error("Synthetic network unavailable");
    if (pathname === "/login" && opts.method === "POST") {
      const form = new URLSearchParams(opts.body);
      if (!form.get("login")?.startsWith("synthetic-") || form.get("password") !== "synthetic-password") {
        return new Response("", { status: 302, headers: { location: origin + "/login" } });
      }
      globalThis.boutyTestLogins += 1;
      connected = true;
      return new Response("", { status: 302, headers: { location: origin + "/dashboard" } });
    }
    if (pathname === "/login") return new Response('<input name="_token" value="token">');
    if (!connected || globalThis.boutyTestExpired) {
      globalThis.boutyTestExpired = false;
      connected = false;
      return new Response("", { status: 302, headers: { location: origin + "/login" } });
    }
    if (pathname === "/logout" && opts.method === "POST") {
      globalThis.boutyTestLogouts += 1;
      connected = false;
      return new Response("", { status: 302, headers: { location: origin + "/login" } });
    }
    if (pathname === "/attendance") return new Response('<meta name="csrf-token" content="token"><body data-current-user-id="1">' + attendanceDay);
    if (pathname === "/students") return new Response(roster());
    if (pathname === "/enrollments") return new Response(enrollments);
    if (pathname === "/attendance/days/students/22") return new Response('<a href="/student-attendance/groups/8">group</a>');
    if (pathname === "/student-attendance/groups/8") {
      return new Response('<table><tr data-attendance-type="student" data-attendance-entity-id="31"><td><select><option value="1">حاضر</option><option value="2">غائب</option></select></td></tr></table>');
    }
    if (pathname === "/attendance/offline-sync") {
      if (globalThis.boutyTestOffline) throw new Error("Synthetic network unavailable");
      const [operation] = JSON.parse(opts.body).operations;
      globalThis.boutyTestAttendance.push(operation);
      return Response.json({ results: [{ client_operation_id: operation.client_operation_id, status: "synced" }] });
    }
    if (pathname === "/livewire-test/update") {
      const request = JSON.parse(opts.body).components[0], state = JSON.parse(request.snapshot);
      const action = request.calls[0];
      if (state.memo.name === "students.index" && action?.method === "edit") {
        const [first_name, last_name] = action.params[0] === 9
          ? globalThis.boutyTestProfileName || ["Website", "Student"]
          : ["Another", "Student"];
        const sourceId = action.params[0] === 9 ? 5 : 6;
        Object.assign(state.data, { editingId: action.params[0], first_name, last_name, notes: `معرف المصدر: ${sourceId}`, school_name: "Website School" });
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
