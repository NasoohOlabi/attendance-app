import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fullRun = process.argv.length === 2;
const env = { ...process.env };
delete env.ATTENDANCE_E2E_FULL;
if (fullRun) env.ATTENDANCE_E2E_FULL = "1";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: project, env, stdio: "inherit" });
  if (result.error) {
    console.error(`${command} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`${command} stopped by ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("bun", ["run", "build"]);
run(process.execPath, ["scripts/test-scanner-build.mjs"]);
run(process.execPath, [
  "node_modules/@playwright/test/cli.js",
  "test",
  "--config",
  "test/e2e/playwright.config.mjs",
  ...process.argv.slice(2),
]);
