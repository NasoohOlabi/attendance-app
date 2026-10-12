import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256Pattern = /^[a-f0-9]{64}$/i;
const commitPattern = /^[a-f0-9]{40,64}$/i;
const checkNames = ['hardware', 'sheets', 'upgrade', 'package'];

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

async function hashFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`Expected a non-empty regular file: ${file}`);
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function artifactPath(receiptsDir, value, label) {
  requiredString(value, label);
  return path.resolve(receiptsDir, value);
}

export async function verifyRelease({ receiptsPath, sourceCommit, version }) {
  requiredString(sourceCommit, 'Current source commit');
  requiredString(version, 'Current package version');
  if (!commitPattern.test(sourceCommit)) throw new Error('Current source commit must be a full git SHA.');

  const absoluteReceipts = path.resolve(receiptsPath);
  const receipts = JSON.parse(await readFile(absoluteReceipts, 'utf8'));
  const receiptDir = path.dirname(absoluteReceipts);
  if (receipts.sourceCommit !== sourceCommit || receipts.version !== version) {
    throw new Error('Receipts do not match the current source commit and package version.');
  }

  const installerPath = artifactPath(receiptDir, receipts.installer?.path, 'Installer path');
  const installerHash = requiredString(receipts.installer?.sha256, 'Installer SHA-256');
  if (!sha256Pattern.test(installerHash) || (await hashFile(installerPath)).toLowerCase() !== installerHash.toLowerCase()) {
    throw new Error('Installer SHA-256 does not match the receipt.');
  }

  for (const name of checkNames) {
    const check = receipts.checks?.[name];
    if (check?.status !== 'pass' || check.sourceCommit !== sourceCommit || check.version !== version) {
      throw new Error(`Release check is missing or does not prove this source and version: ${name}.`);
    }
    if (typeof check.installerSha256 !== 'string' || !sha256Pattern.test(check.installerSha256) || check.installerSha256.toLowerCase() !== installerHash.toLowerCase()) {
      throw new Error(`Release check does not identify this installer: ${name}.`);
    }
    const evidencePathValue = requiredString(check.evidence?.path, `Evidence path for ${name}`);
    if (path.isAbsolute(evidencePathValue)) throw new Error(`Evidence path must be relative to the receipts file: ${name}.`);
    const evidencePath = path.resolve(receiptDir, evidencePathValue);
    const evidenceRelative = path.relative(receiptDir, evidencePath);
    if (!evidenceRelative || evidenceRelative.startsWith('..') || path.isAbsolute(evidenceRelative)) {
      throw new Error(`Evidence path must stay within the receipts directory: ${name}.`);
    }
    const evidenceHash = requiredString(check.evidence?.sha256, `Evidence SHA-256 for ${name}`);
    if (!sha256Pattern.test(evidenceHash)) throw new Error(`Invalid evidence SHA-256 for release check: ${name}.`);
    let actualEvidenceHash;
    try {
      actualEvidenceHash = await hashFile(evidencePath);
    } catch {
      throw new Error(`Evidence file is missing, unreadable, or not a non-empty regular file: ${name}.`);
    }
    if (actualEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
      throw new Error(`Evidence SHA-256 does not match for release check: ${name}.`);
    }
  }

  const manifestPath = artifactPath(receiptDir, receipts.scannerManifest?.path, 'Scanner manifest path');
  const scannerDir = artifactPath(receiptDir, receipts.scannerDirectory, 'Packaged scanner directory');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.sourceCommit !== sourceCommit || manifest.rid !== 'win-x86' || manifest.selfContained !== true || manifest.publishTrimmed !== false || manifest.publishSingleFile !== false) {
    throw new Error('Scanner manifest does not match the required release source and publish settings.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Scanner manifest has no files.');

  const scannerRoot = await realpath(scannerDir);
  const seen = new Set();
  let hasScannerExe = false;
  for (const entry of manifest.files) {
    const relative = requiredString(entry?.path, 'Scanner manifest file path');
    const segments = relative.split('/');
    if (relative.includes('\\') || relative.startsWith('/') || /^[a-z]:/i.test(relative) || segments.some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Unsafe scanner manifest path: ${relative}`);
    }
    if (seen.has(relative)) throw new Error(`Duplicate scanner manifest path: ${relative}`);
    seen.add(relative);
    const expectedHash = requiredString(entry.sha256, `SHA-256 for ${relative}`);
    if (!sha256Pattern.test(expectedHash)) throw new Error(`Invalid scanner SHA-256 for ${relative}.`);
    const file = path.resolve(scannerRoot, ...segments);
    const actual = await realpath(file);
    if (!actual.startsWith(`${scannerRoot}${path.sep}`)) throw new Error(`Scanner file escapes its directory: ${relative}`);
    if ((await hashFile(actual)).toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`Scanner file hash does not match the manifest: ${relative}`);
    if (relative === 'zk4500.exe') hasScannerExe = true;
  }
  if (!hasScannerExe) throw new Error('Scanner manifest does not include zk4500.exe.');
  return { sourceCommit, version, installerPath };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || `git ${args.join(' ')} failed`).trim());
  return result.stdout.trim();
}

async function runCli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const receiptsArg = process.argv[2];
  if (!receiptsArg || process.argv.length !== 3) throw new Error('Usage: bun run verify:release <receipts.json>');
  if (git(root, ['status', '--porcelain'])) throw new Error('Release verification requires a clean git tree.');
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const currentPackageText = await readFile(path.join(root, 'package.json'), 'utf8');
  const currentPackage = JSON.parse(currentPackageText);
  const committedPackage = JSON.parse(git(root, ['show', 'HEAD:package.json']));
  const parentPackage = JSON.parse(git(root, ['show', 'HEAD^:package.json']));
  if (currentPackage.version !== committedPackage.version || committedPackage.version === parentPackage.version) {
    throw new Error('HEAD must be the package version commit, and the working package version must match it.');
  }
  const result = await verifyRelease({ receiptsPath: path.resolve(receiptsArg), sourceCommit, version: currentPackage.version });
  console.log(`Verified release candidate ${result.version} at ${result.sourceCommit}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
