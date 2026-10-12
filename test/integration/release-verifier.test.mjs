import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyRelease } from '../../scripts/verify-release.mjs';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const version = '1.2.3';
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'attendance-release-'));
  const scannerDirectory = path.join(dir, 'scanner');
  await mkdir(scannerDirectory);
  const exe = Buffer.from('synthetic scanner executable');
  const runtime = Buffer.from('synthetic runtime');
  await writeFile(path.join(scannerDirectory, 'zk4500.exe'), exe);
  await writeFile(path.join(scannerDirectory, 'runtime.dll'), runtime);
  const installer = Buffer.from('synthetic installer');
  await writeFile(path.join(dir, 'installer.exe'), installer);
  const manifest = {
    sourceCommit,
    rid: 'win-x86',
    selfContained: true,
    publishTrimmed: false,
    publishSingleFile: false,
    files: [
      { path: 'zk4500.exe', sha256: hash(exe) },
      { path: 'runtime.dll', sha256: hash(runtime) },
    ],
  };
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const checks = {};
  for (const name of ['hardware', 'sheets', 'upgrade', 'package']) {
    const evidence = Buffer.from(`synthetic ${name} evidence`);
    const evidencePath = `${name}-evidence.txt`;
    await writeFile(path.join(dir, evidencePath), evidence);
    checks[name] = {
      status: 'pass',
      sourceCommit,
      version,
      installerSha256: hash(installer),
      evidence: { path: evidencePath, sha256: hash(evidence) },
    };
  }
  const receipt = {
    sourceCommit,
    version,
    installer: { path: 'installer.exe', sha256: hash(installer) },
    scannerManifest: { path: 'manifest.json' },
    scannerDirectory: 'scanner',
    checks,
  };
  const receiptsPath = path.join(dir, 'receipts.json');
  await writeFile(receiptsPath, `${JSON.stringify(receipt)}\n`, 'utf8');
  return { dir, receipt, receiptsPath, scannerDirectory, manifestPath };
}

async function writeReceipt(pathname, value) {
  await writeFile(pathname, `${JSON.stringify(value)}\n`, 'utf8');
}

test('verifies installer, scanner manifest, scanner files, and matching check receipts', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  const result = await verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version });
  assert.deepEqual(result, { sourceCommit, version, installerPath: path.join(f.dir, 'installer.exe') });
});

test('rejects an unproven hardware check', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.receipt.checks.hardware.status = 'manual';
  await writeReceipt(f.receiptsPath, f.receipt);
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /hardware/);
});

test('rejects an installer whose receipt hash is wrong', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.receipt.installer.sha256 = 'a'.repeat(64);
  await writeReceipt(f.receiptsPath, f.receipt);
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Installer SHA-256/);
});

test('rejects a release check tied to a different installer hash', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.receipt.checks.hardware.installerSha256 = 'a'.repeat(64);
  await writeReceipt(f.receiptsPath, f.receipt);
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /does not identify this installer: hardware/);
});

test('rejects missing evidence before reporting a verified release', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.receipt.checks.sheets.evidence.path = 'missing-evidence.txt';
  await writeReceipt(f.receiptsPath, f.receipt);
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Evidence file is missing/);
});

test('rejects tampered evidence before reporting a verified release', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  await writeFile(path.join(f.dir, f.receipt.checks.upgrade.evidence.path), 'changed evidence');
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Evidence SHA-256 does not match for release check: upgrade/);
});

test('accepts uppercase hexadecimal response hashes', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.receipt.installer.sha256 = f.receipt.installer.sha256.toUpperCase();
  for (const check of Object.values(f.receipt.checks)) {
    check.installerSha256 = check.installerSha256.toUpperCase();
    check.evidence.sha256 = check.evidence.sha256.toUpperCase();
  }
  const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  for (const entry of manifest.files) entry.sha256 = entry.sha256.toUpperCase();
  await writeFile(f.manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  await writeReceipt(f.receiptsPath, f.receipt);
  const result = await verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version });
  assert.deepEqual(result, { sourceCommit, version, installerPath: path.join(f.dir, 'installer.exe') });
});

test('rejects a tampered installer', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  await writeFile(path.join(f.dir, 'installer.exe'), 'changed installer');
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Installer SHA-256/);
});

test('rejects a scanner manifest from a different source commit', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  manifest.sourceCommit = 'f'.repeat(40);
  await writeFile(f.manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Scanner manifest/);
});

test('rejects scanner manifest path traversal', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  manifest.files[0].path = '../zk4500.exe';
  await writeFile(f.manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  await assert.rejects(verifyRelease({ receiptsPath: f.receiptsPath, sourceCommit, version }), /Unsafe scanner manifest path/);
});
