import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"private_key"\s*:\s*"[^"\r\n]{64,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}/;
const forbidden = /(?:^|\/)(?:attendance\.config\.json|service-account\.enc(?:\..*)?|[^/]*service-account[^/]*\.json|fingerprints|release|staging|node_modules)(?:\/|$)|^scanner\/(?:AxInterop|Interop)\.ZKFPEngXControl\.dll$|(?:^|\/)s-[^/]+\.txt$/i;

function inspect(path, content) {
  if (forbidden.test(path)) throw new Error(`Private or undistributable tracked file: ${path}`);
  if (secret.test(content)) throw new Error(`Possible secret in ${path}. Review privately; values are suppressed.`);
  if (path.endsWith('.json')) {
    let value;
    try { value = JSON.parse(content); } catch { return; }
    if (value?.type === 'service_account' && value?.private_key) throw new Error(`Service account in ${path}`);
  }
}

function packaging(content) {
  const { build } = JSON.parse(content);
  if (JSON.stringify(build?.files) !== JSON.stringify(['out/**', 'package.json', 'LICENSE']) || build?.afterPack !== 'scripts/verify-package.cjs') {
    throw new Error('Restore the explicit package allowlist and scripts/verify-package.cjs guard.');
  }
}

function history(revision) {
  if (!/^[0-9a-f]{40,64}$/i.test(revision)) revision = git('rev-parse', '--verify', `${revision}^{commit}`).trim();
  const objects = git('rev-list', '--objects', revision).trim().split('\n');
  for (const entry of objects) {
    const split = entry.indexOf(' ');
    if (split < 0) continue;
    const oid = entry.slice(0, split), path = entry.slice(split + 1).replace(/\r$/, '');
    if (forbidden.test(path)) throw new Error(`Private or undistributable file in pushed history: ${path}`);
    if (git('cat-file', '-t', oid).trim() === 'blob') inspect(path, git('cat-file', 'blob', oid));
  }
  if (secret.test(git('log', revision, '--format=%B'))) throw new Error('Possible secret in commit messages. Values are suppressed.');
  packaging(git('show', `${revision}:package.json`));
}

try {
  if (process.argv.includes('--pre-push')) {
    for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const [localRef, oid, remoteRef] = line.trim().split(/\s+/);
      if (/^0+$/.test(oid)) continue;
      if (!/^refs\/(heads|tags)\//.test(localRef) || !/^refs\/(heads|tags)\//.test(remoteRef)) throw new Error('Only explicit branch or tag publication is allowed. Never push checkpoint refs or mirror this repository.');
      history(oid);
    }
  } else if (process.argv.includes('--history')) {
    history(process.argv[process.argv.indexOf('--history') + 1] || 'HEAD');
  } else {
    for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
      inspect(path, git('show', `:${path}`));
      inspect(path, readFileSync(path, 'utf8'));
    }
    packaging(git('show', ':package.json'));
    packaging(readFileSync('package.json', 'utf8'));
  }
  console.log('Security lint passed.');
} catch (error) {
  console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Security lint could not inspect Git objects. Push blocked.');
  process.exitCode = 1;
}
