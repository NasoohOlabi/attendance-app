import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required to publish a release.");
const builder = path.join(root, "node_modules", "electron-builder", "cli.js");
const files = [
  path.join(root, "release", "Masjid-Attendance-Setup.exe"),
  path.join(root, "release", "Masjid-Attendance-Setup.exe.blockmap"),
  path.join(root, "release", "latest.yml"),
];
const args = ["publish", "--version", packageJson.version, "--policy", "always"];
for (const file of files) args.push("--files", file);

for (const file of files) {
  if ((await stat(file)).size === 0) throw new Error(`Release artifact is empty: ${file}`);
}

const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).stdout.trim();
const repository = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
if (!repository) throw new Error("Could not determine the GitHub repository from origin.");
const api = `https://api.github.com/repos/${repository[1]}/${repository[2]}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
};
const tag = `v${packageJson.version}`;
const prerelease = /-[0-9A-Za-z.-]+$/.test(packageJson.version);
if (/-nightly\.\d+$/.test(packageJson.version)) {
  // GitHub targets its default branch when electron-builder creates an untagged release.
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (head.status !== 0) throw new Error("Could not determine the nightly build commit.");
  const sha = head.stdout.trim();
  let ref = await fetch(`${api}/git/ref/tags/${tag}`, { headers });
  if (ref.status === 404) {
    ref = await fetch(`${api}/git/refs`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
    });
  }
  if (!ref.ok || (await ref.json()).object?.sha !== sha) throw new Error(`Nightly tag ${tag} does not point to the build commit.`);
}

const publishEnv = { ...process.env };
if (prerelease) publishEnv.EP_PRE_RELEASE = "true";
const result = spawnSync(process.execPath, [builder, ...args], {
  cwd: root,
  stdio: "inherit",
  env: publishEnv,
});
if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const response = await fetch(`${api}/releases/tags/${tag}`, { headers });
if (!response.ok) throw new Error(`GitHub release verification failed with HTTP ${response.status}.`);
const release = await response.json();
try {
  if (release.draft || release.prerelease !== prerelease) throw new Error(`Release type does not match ${tag}.`);
  for (const file of files) {
    const name = path.basename(file);
    const size = (await stat(file)).size;
    const asset = (release.assets || []).find((item) => item.name === name);
    if (!asset || asset.size !== size) throw new Error(`GitHub release asset was not verified: ${name}`);
    const assetResponse = await fetch(asset.url, {
      headers: { ...headers, Accept: "application/octet-stream" },
    });
    if (!assetResponse.ok) throw new Error(`Could not download GitHub asset for verification: ${name}`);
    const uploaded = Buffer.from(await assetResponse.arrayBuffer());
    const local = await readFile(file);
    const uploadedHash = createHash("sha512").update(uploaded).digest("base64");
    const localHash = createHash("sha512").update(local).digest("base64");
    if (uploadedHash !== localHash) throw new Error(`GitHub release asset bytes do not match: ${name}`);
  }
} catch (error) {
  const cleanup = await fetch(`${api}/releases/${release.id}`, { method: "DELETE", headers });
  if (!cleanup.ok) console.error(`Could not delete the unverified GitHub release (HTTP ${cleanup.status}).`);
  throw error;
}
console.log(`Verified ${files.length} uploaded release assets for v${packageJson.version}.`);
