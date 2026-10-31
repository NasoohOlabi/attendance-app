import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const releaseDir = path.resolve("release");
const metadataPath = path.join(releaseDir, "latest.yml");
const metadata = await readFile(metadataPath, "utf8");
const artifactName = metadata.match(/^path:\s*(.+)$/m)?.[1]?.trim();
const expectedHash = metadata.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
if (!artifactName || !expectedHash) throw new Error("latest.yml is missing path or sha512.");

const artifactPath = path.resolve(releaseDir, artifactName);
if (!artifactPath.startsWith(`${releaseDir}${path.sep}`)) throw new Error("latest.yml points outside the release directory.");
const actualHash = createHash("sha512").update(await readFile(artifactPath)).digest("base64");
if (actualHash !== expectedHash) throw new Error(`Installer hash does not match latest.yml for ${artifactName}.`);
const blockmapPath = path.join(releaseDir, `${artifactName}.blockmap`);
if ((await stat(blockmapPath)).size === 0) throw new Error("Installer blockmap is empty.");

console.log(`Verified ${artifactName} and its blockmap against latest.yml.`);
