import { test as base, expect, _electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSheets } from "./sheets.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const scannerExe = path.join(repo, "node_modules/.cache/attendance-test-scanner/zk4500-fake.exe");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

async function jsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

export const test = base.extend({
  fixtureOptions: [{}, { option: true }],
  app: async ({ fixtureOptions }, use, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "attendance-e2e-"));
    const home = path.join(root, "home");
    const temp = path.join(root, "temp");
    const prints = path.join(home, "Masjid/v1/fingerprints");
    await Promise.all([mkdir(temp, { recursive: true }), mkdir(path.join(prints, "templates"), { recursive: true })]);
    const key = path.join(root, "synthetic-key.json");
    const configPath = path.join(root, "attendance.config.json");
    await writeFile(key, JSON.stringify({ client_email: "test@example.invalid", private_key: "synthetic-not-a-real-key" }));
    const config = {
      serviceAccountJson: key,
      spreadsheetId: "attendance-test",
      sheetGid: 1,
      logSpreadsheetId: "pages-test",
      logSheetGid: 2,
      fingerprintSheetGid: 3,
      zk4500Cli: scannerExe,
      scanTimeoutSeconds: 20,
      syncIntervalSeconds: 1,
      ...fixtureOptions.config,
    };
    await writeFile(configPath, fixtureOptions.configText ?? JSON.stringify(config));
    const sheets = createSheets(fixtureOptions.sheets);
    const scripts = [];
    const waiters = [];
    const captures = [];
    const transcript = [];
    const runtimeErrors = [];
    const gates = [];
    const liveScannerPids = () => [...new Set(captures.filter((item) => item.type === "started").map((item) => item.pid))].filter((pid) => {
      try { process.kill(pid, 0); return true; }
      catch (error) { if (error.code === "ESRCH") return false; throw error; }
    });
    let stopping = false;
    const send = (response, value) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const server = createServer(async (request, response) => {
      try {
        if (request.url === "/request" && request.method === "POST") {
          try {
            const options = await jsonBody(request);
            for (const gate of gates) {
              if (gate.predicate(options)) {
                gate.hits += 1;
                gate.hit();
                await gate.wait;
              }
            }
            send(response, await sheets.request(options));
          } catch (error) {
            if (/^(Unknown|Unsupported|Invalid range)/.test(error.message)) runtimeErrors.push(error.message);
            send(response, { error: { message: error.message, status: error.response?.status, data: error.response?.data } });
          }
        } else if (request.url === "/scanner/next") {
          if (stopping) send(response, { exitCode: 2, error: "timeout" });
          else if (scripts.length) send(response, scripts.shift());
          else {
            waiters.push(response);
            response.on("close", () => {
              const index = waiters.indexOf(response);
              if (index >= 0) waiters.splice(index, 1);
            });
          }
        } else if (["/scanner/started", "/scanner/exited"].includes(request.url)) {
          captures.push({ at: Date.now(), type: request.url.endsWith("started") ? "started" : "exited", ...await jsonBody(request) });
          send(response, {});
        } else {
          throw new Error(`Unknown fixture endpoint ${request.method} ${request.url}`);
        }
      } catch (error) {
        runtimeErrors.push(error.message);
        response.writeHead(500);
        response.end(error.message);
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/`;
    const inherited = { ...process.env };
    for (const name of Object.keys(inherited)) {
      if (/^(ATTENDANCE_|GOOGLE_|SPREADSHEET_ID|SHEET_GID|LOG_|FINGERPRINT_|ZK4500_|SCAN_TIMEOUT_|SYNC_INTERVAL_|ELECTRON_RENDERER_URL|ELECTRON_RUN_AS_NODE)/.test(name)) delete inherited[name];
    }
    const env = {
      ...inherited,
      USERPROFILE: home,
      HOME: home,
      APPDATA: path.join(root, "appdata"),
      TEMP: temp,
      TMP: temp,
      TZ: fixtureOptions.timezone || "Asia/Damascus",
      ATTENDANCE_CONFIG: configPath,
      FINGERPRINT_DIR: prints,
      ZK4500_CLI: config.zk4500Cli,
      ATTENDANCE_E2E_ROOT: root,
      ATTENDANCE_E2E_ENDPOINT: endpoint,
      ATTENDANCE_E2E_CLOCK: fixtureOptions.clock || "2026-10-12T13:55:03.000Z",
    };
    let electron;
    let page;
    const connect = async () => {
      stopping = false;
      electron = await _electron.launch({ executablePath: electronPath, args: [path.join(repo, "test/e2e/entry.mjs")], cwd: repo, env, timeout: 20_000 });
      electron.process().stdout?.on("data", (chunk) => transcript.push(String(chunk)));
      electron.process().stderr?.on("data", (chunk) => transcript.push(String(chunk)));
      await electron.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await electron.firstWindow();
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await expect(page.locator("#settings")).toBeVisible();
    };
    const stop = async () => {
      stopping = true;
      if (page && !page.isClosed()) await page.evaluate(() => window.attendance.openSettings());
      for (const gate of gates.splice(0)) gate.release();
      for (const response of waiters.splice(0)) send(response, { exitCode: 2, error: "timeout" });
      scripts.length = 0;
      await expect.poll(liveScannerPids).toEqual([]);
      if (electron) {
        const trace = testInfo.outputPath(`trace-${Date.now()}.zip`);
        await electron.context().tracing.stop({ path: trace }).catch((error) => runtimeErrors.push(error.message));
        await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
        await electron.close();
        electron = null;
      }
      await expect.poll(liveScannerPids).toEqual([]);
    };
    const driver = {
      root, home, prints, configPath, sheets, captures, transcript,
      get electron() { return electron; },
      get page() { return page; },
      block(predicate) {
        let hit;
        let release;
        const waiting = new Promise((resolve) => { hit = resolve; });
        const wait = new Promise((resolve) => { release = resolve; });
        const gate = { predicate, wait, hit, release, hits: 0 };
        gates.push(gate);
        return { waiting, release, get hits() { return gate.hits; } };
      },
      enqueue(script = {}) {
        const value = { events: [{ line: "finger=detected" }], template: "synthetic-print", score: 20, ...script };
        const response = waiters.shift();
        if (response) send(response, value);
        else scripts.push(value);
      },
      async restart() { await stop(); await connect(); },
      async state() { return page.evaluate(() => window.attendance.getState()); },
      async outbox() {
        try { return JSON.parse(await readFile(path.join(home, "Masjid/attendance-outbox.json"), "utf8")); }
        catch (error) { if (error.code === "ENOENT") return { items: [] }; throw error; }
      },
      async index() { return JSON.parse(await readFile(path.join(prints, "index.json"), "utf8")); },
      async files() { return readdir(path.join(prints, "templates")); },
      async ready() {
        await expect(page.locator("#today-count")).toHaveText("0");
        await expect.poll(async () => (await driver.state()).syncNote).toMatch(/^Synced /);
      },
      async mark(id = "00 00 000 001") {
        driver.enqueue({ matchSid: `s-${id.replaceAll(" ", "-")}` });
      },
      async seedPrint(id = "00 00 000 001", name = "أحمد طالب") {
        const file = `s-${id.replaceAll(" ", "-")}.txt`;
        const index = await driver.index();
        index.students[id] = { studentId: id, studentName: name, templateFile: file, capturedAt: env.ATTENDANCE_E2E_CLOCK };
        await writeFile(path.join(prints, "templates", file), "synthetic-print");
        await writeFile(path.join(prints, "index.json"), JSON.stringify(index));
      },
    };
    try {
      await connect();
      await use(driver);
    } finally {
      if (page && !page.isClosed()) {
        const screenshot = testInfo.outputPath("window.png");
        await page.screenshot({ path: screenshot }).catch(() => {});
        await testInfo.attach("window", { path: screenshot, contentType: "image/png" }).catch(() => {});
      }
      let shutdownError;
      try { await stop(); } catch (error) { shutdownError = error; }
      finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      const disk = {};
      const logNames = await readdir(path.join(home, "Masjid/logs")).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
      for (const file of ["home/Masjid/attendance-outbox.json", "home/Masjid/scan-times.json", "home/Masjid/v1/fingerprints/index.json", ...logNames.map((name) => `home/Masjid/logs/${name}`)]) {
        try { disk[file] = await readFile(path.join(root, file), "utf8"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      const receipts = { sourceCommit, versions: { node: process.version, electron: require("electron/package.json").version, playwright: require("@playwright/test/package.json").version }, root, config, captures, requests: sheets.requests, grids: sheets.grids, disk, runtimeErrors, transcript, shutdownError: shutdownError?.message };
      const receiptPath = testInfo.outputPath("receipts.json");
      await writeFile(receiptPath, JSON.stringify(receipts, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value, 2));
      await testInfo.attach("receipts", { path: receiptPath, contentType: "application/json" });
      await testInfo.attach("test-root", { body: Buffer.from(root), contentType: "text/plain" });
      if (shutdownError) throw shutdownError;
      expect(runtimeErrors, "Unexpected runtime or fixture errors").toEqual([]);
      expect(transcript.join(""), "Unexpected external request").not.toContain("E2E blocked external request");
      expect(transcript.join(""), "Unexpected application failure").not.toMatch(/uncaught exception|unhandled rejection|renderer gone|window failed to load/i);
    }
  },
});

export { expect };
