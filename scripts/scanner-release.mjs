import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(root, "scanner", "zk4500.csproj");
const out = path.join(root, "staging", "scanner");
const publishArgs = [
  "publish",
  project,
  "-c",
  "Release",
  "-r",
  "win-x86",
  "--self-contained",
  "true",
  "-p:PublishSingleFile=false",
  "-p:PublishTrimmed=false",
  "-p:DebugType=none",
  "-o",
  out,
];

for (const name of ["AxInterop.ZKFPEngXControl.dll", "Interop.ZKFPEngXControl.dll"]) {
  if (!existsSync(path.join(root, "scanner", name))) {
    console.error(`Missing scanner/${name}. Supply the interop wrappers from authorized SDK/tooling; see README.md. Existing staged output was preserved.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const result = spawnSync("dotnet", publishArgs, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

function filesIn(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesIn(full));
    else found.push(full);
  }
  return found;
}

const files = filesIn(out).map((full) => {
  const body = readFileSync(full);
  return {
    path: path.relative(out, full).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
});
const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const manifest = {
  sourceCommit: rev.stdout?.trim() || "",
  rid: "win-x86",
  selfContained: true,
  publishTrimmed: false,
  publishSingleFile: false,
  files,
};
writeFileSync(path.join(root, "staging", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (!files.some((file) => file.path === "zk4500.exe")) {
  console.error("publish finished without zk4500.exe");
  process.exit(1);
}
