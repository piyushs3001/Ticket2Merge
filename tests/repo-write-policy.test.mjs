import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBashRepoWrites } from '../scripts/lib/repo-write-policy.mjs';

const REPO = '/work/repo';
const check = (cmd, cwd = REPO) => checkBashRepoWrites(cmd, { repoRoots: [REPO], cwd });

const ALLOWED_BEFORE_APPROVAL = [
  'grep -rn "foo(" src',
  'cat src/a.php',
  'cat src/a.php > /tmp/copy.php',
  'git diff > /tmp/d.diff',
  'cp src/a.php /tmp/',
  'ls -la src 2>&1',
  'php -l src/a.php > /dev/null',
  'npm ls --depth=0',
  'composer show',
  'find src -name "*.php"',
  'mkdir -p /tmp/t2m-scratch',
  'cd /tmp && echo x > out.txt',
  'npx eslint src',
  'sed -i s/a/b/ /tmp/x.txt',
  "sed -i -e 's/a/b/' /tmp/x.txt",
  'chmod +x /tmp/run.sh',
  'dd if=src/a.php of=/tmp/a.bak',
];

const BLOCKED_BEFORE_APPROVAL = [
  'echo x > src/a.php',
  'echo x >> /work/repo/src/a.php',
  'cat /tmp/x | tee src/a.php',
  'sed -i s/a/b/ src/a.php',
  "perl -pi -e 's/a/b/' src/a.php",
  'rm src/a.php',
  'mv src/a.php src/b.php',
  'cp /tmp/x.php src/a.php',
  'touch src/new.php',
  'mkdir -p src/new',
  'npm install lodash',
  'pnpm add zod',
  'yarn add zod',
  'composer require guzzlehttp/guzzle',
  'npx prettier --write src',
  'npx eslint --fix src',
  'php artisan make:controller X',
  'cd /tmp && echo x > /work/repo/src/a.php',
  'cd src && echo x > a.php',
  'chmod 644 src/a.php',
  'dd if=/tmp/x of=src/a.php',
];

for (const cmd of ALLOWED_BEFORE_APPROVAL) {
  test(`pre-approval allows: ${cmd}`, () => assert.equal(check(cmd).allow, true, check(cmd).reason));
}
for (const cmd of BLOCKED_BEFORE_APPROVAL) {
  test(`pre-approval blocks: ${cmd}`, () => {
    const r = check(cmd);
    assert.equal(r.allow, false, cmd);
    assert.match(r.reason, /Gate 1/);
  });
}

test('with no repo recorded, writes outside the safe dirs are blocked (was a fail-open)', () => {
  const r = checkBashRepoWrites('echo x > a.php', { repoRoots: [], cwd: REPO });
  assert.equal(r.allow, false);
});
