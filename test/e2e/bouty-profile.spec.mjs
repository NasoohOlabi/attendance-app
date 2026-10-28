import { test, expect } from "./fixtures/app.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

test.use({ fixtureOptions: { config: { attendanceDestination: "bouty", zk4500Cli: "Z:/missing-test-scanner.exe" } } });

async function mockBouty(electron) {
  await electron.evaluate(({ session }) => {
    const escaped = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const snapshot = (name, data) => JSON.stringify({ memo: { name }, data });
    const html = (name, data, inner = "") => `<script data-update-uri="https://albouty.saas.hassiba.tech/livewire/update"></script><div wire:snapshot="${escaped(snapshot(name, data))}">${inner}</div>`;
    const rows = '<table><tr><td>Website Student</td><td>90</td><td><button wire:click="edit(9)"></button></td></tr></table>';
    const students = html("students.index", {}, rows);
    for (const name of ["bouty-login-check", "bouty-students", "bouty-attendance"]) {
      session.fromPartition(name).fetch = async (url, opts = {}) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/login" && opts.method === "POST") return new Response("", { status: 302, headers: { location: "https://albouty.saas.hassiba.tech/dashboard" } });
        if (pathname === "/login") return new Response('<input name="_token" value="token">');
        if (pathname === "/attendance") return new Response('<meta name="csrf-token" content="token"><body data-current-user-id="1">');
        if (pathname === "/students") return new Response(students);
        if (pathname === "/enrollments") return new Response(html("enrollments.index", { courseFilter: "1" }));
        if (pathname === "/livewire/update") {
          const request = JSON.parse(opts.body).components[0], state = JSON.parse(request.snapshot);
          if (state.memo.name === "students.index" && request.calls[0]?.method === "edit") {
            Object.assign(state.data, { first_name: "Website", last_name: "Student", notes: "معرف المصدر: 5", school_name: "Website School" });
          }
          const body = { components: [{ snapshot: JSON.stringify(state), effects: { html: state.memo.name === "students.index" ? students : html("enrollments.index", state.data) } }] };
          return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected synthetic Bouty request: ${pathname}`);
      };
    }
  });
}

test("Bouty picker and scan card use website student information", async ({ app }) => {
  await mockBouty(app.electron);
  await app.page.locator("#settings").click();
  await app.page.locator("#settings-bouty-tab").click();
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
