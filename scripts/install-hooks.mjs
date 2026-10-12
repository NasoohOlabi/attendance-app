import { execFileSync, spawnSync } from 'node:child_process';
const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
if (result.status !== 0 && result.status !== 1) throw new Error('Cannot read Git hook configuration.');
const current = result.stdout;
if (current.trim() && current.trim() !== '.githooks') throw new Error('Existing hooksPath found. Integrate the security pre-push hook without replacing your existing hooks.');
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
console.log('Security pre-push hook installed.');
