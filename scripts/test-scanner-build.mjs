import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(scriptDir, "../test/e2e/fixtures/scanner/zk4500-fake.csproj");
const output = path.resolve(scriptDir, "../node_modules/.cache/attendance-test-scanner");
mkdirSync(output, { recursive: true });
execFileSync("dotnet", [
  "publish", project,
  "--configuration", "Release",
  "--runtime", "win-x64",
  "--self-contained", "false",
  "-p:UseAppHost=true",
  "--output", output,
], { stdio: "inherit" });
