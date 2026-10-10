import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (status.status !== 0) process.exit(status.status ?? 1);
if (status.stdout.trim()) {
  console.error("Commit the code first. A release commit only bumps the version on that code, then the installer is built from it.");
  process.exit(1);
}

run("bun", ["pm", "version", "patch", "--no-git-tag-version"]);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
run("git", ["add", "package.json", "bun.lock"]);
run("git", ["commit", "-m", `Release ${version}.\n\nThe installer for this commit is Masjid Attendance ${version}.`]);
run("bun", ["run", "dist"]);
console.log(`Released ${version}`);
