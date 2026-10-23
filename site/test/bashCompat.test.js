// @ts-check
/**
 * macOS ships Bash 3.2, where expanding an EMPTY array as "${a[@]}" under
 * `set -u` fails with "unbound variable" (fixed in Bash 4.4). A preview
 * deploy hit exactly that (2026-10-23). Every array expansion in the site
 * scripts must use the guarded form ${a[@]+"${a[@]}"}.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));

test('no unguarded "${array[@]}" expansion in site scripts (Bash 3.2 + set -u)', () => {
  const offenders = [];
  for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith('.sh'))) {
    const lines = readFileSync(path.join(SCRIPTS, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('#')) return;
      for (const m of line.matchAll(/"\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}"/g)) {
        if (!line.includes(`\${${m[1]}[@]+`)) offenders.push(`${file}:${i + 1}: ${m[0]}`);
      }
    });
  }
  // VERCEL_ENV_CMD is always non-empty; still allowed only when guarded or listed here.
  const allowed = ['create-app-role.sh: "${VERCEL_ENV_CMD[@]}"'];
  const unexpected = offenders.filter((o) => !allowed.some((a) => o.startsWith(a.split(':')[0]) && o.endsWith(a.split(': ')[1])));
  assert.deepEqual(unexpected, []);
});

test('the guarded form works on this machine\'s bash with set -u and an empty array', () => {
  const out = execFileSync('bash', ['-c', 'set -euo pipefail; a=(); printf "[%s]" x ${a[@]+"${a[@]}"}; echo ok'], { encoding: 'utf8' });
  assert.equal(out.trim(), '[x]ok');
});
