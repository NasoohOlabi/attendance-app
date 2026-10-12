import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/security-lint.mjs', import.meta.url));
test('security lint blocks staged secrets, deleted historical secrets, unsafe packaging and checkpoint pushes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'attendance-security-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  const lint = (args = [], input) => spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: 'utf8' });
  const packageFile = { build: { files: ['out/**', 'package.json', 'LICENSE'], afterPack: 'scripts/verify-package.cjs' } };
  try {
    git('init'); git('config', 'user.name', 'Security test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify(packageFile));
    git('add', '.'); git('commit', '-m', 'Clean baseline');
    assert.equal(lint().status, 0);
    assert.equal(lint(['--history', 'HEAD']).status, 0);
    const oid = git('rev-parse', 'HEAD');
    assert.equal(lint(['--pre-push'], `refs/heads/master ${oid} refs/heads/master ${'0'.repeat(40)}\n`).status, 0);
    assert.equal(lint(['--pre-push'], `refs/t3/checkpoints/test ${oid} refs/t3/checkpoints/test ${'0'.repeat(40)}\n`).status, 1);
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ build: { files: ['**/*'] } }));
    assert.equal(lint().status, 1);
    writeFileSync(join(cwd, 'package.json'), JSON.stringify(packageFile));
    const token = ['gh', 'p_', 'a'.repeat(30)].join('');
    writeFileSync(join(cwd, 'notes.txt'), token); git('add', '.');
    const rejected = lint();
    assert.equal(rejected.status, 1);
    assert.ok(!rejected.stderr.includes(token));
    git('commit', '-m', 'Accidental credential');
    git('rm', 'notes.txt'); git('commit', '-m', 'Delete credential');
    assert.equal(lint().status, 0);
    assert.equal(lint(['--history', 'HEAD']).status, 1);
    writeFileSync(join(cwd, 'attendance.config.json'), '{}'); git('add', '.');
    assert.equal(lint().status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
