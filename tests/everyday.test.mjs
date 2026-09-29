// Everyday developer commands must keep working — the guard's false-positive budget is zero.

import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBash } from '../scripts/lib/bash-policy.mjs';
import { checkBashRepoWrites } from '../scripts/lib/repo-write-policy.mjs';
const t = (p) => realpathSync(mkdtempSync(path.join(os.tmpdir(), p)));
const HOME = t('fp-home-'), T2M = path.join(HOME, '.claude/ticket2merge'); mkdirSync(T2M + '/runs', { recursive: true });
const REPO = t('fp-repo-'); mkdirSync(REPO + '/.git'); mkdirSync(REPO + '/src'); mkdirSync(REPO + '/tests');
writeFileSync(REPO + '/src/a.php', '<?php'); writeFileSync(REPO + '/package.json', JSON.stringify({ scripts: { test: 'jest', build: 'vite build', lint: 'eslint src' } }));
writeFileSync(REPO + '/Makefile', 'all:\n\techo hi\n');
const env = { HOME, PATH: process.env.PATH };
const post = (c) => checkBash(c, { t2mHome: T2M, cwd: REPO, home: HOME, env });
const pre = (c) => { const g = post(c); return g.allow ? checkBashRepoWrites(c, { repoRoots: [REPO], cwd: REPO, safeDirs: [], home: HOME, env }) : g; };
const PRE = ['ls -la', 'ls src | grep php', 'cat package.json | jq .scripts', 'grep -rn "function" src', 'rg TODO src',
  'find . -name "*.php" | head -20', 'find src -name "*.php" | xargs grep -l foo', 'find src -type f | xargs wc -l',
  'wc -l src/*.php', 'git log --oneline -10', 'git diff HEAD~1 -- src | head -50', 'git show --stat HEAD',
  'git blame -L 1,5 src/a.php', 'head -n 20 src/a.php', 'tail -f /tmp/app.log', 'diff src/a.php /tmp/b.php',
  "cat > /tmp/notes.md <<'EOF'\nline\nEOF", 'echo $PATH', 'pwd && ls', 'curl -s https://api.example.com/items | jq length',
  'gh pr view 12 --json title', 'gh issue view 3', 'php -l src/a.php', 'node --version', 'npm ls --depth=0',
  'composer show', 'which php node', 'stat src/a.php', 'du -sh src', 'tree -L 2 src'];
const POST = ['npm test', 'npm run build', 'npm run lint', 'npx jest tests/', 'npx playwright test tests/e2e/login.spec.ts',
  'php artisan test', 'vendor/bin/phpunit --filter Coupon', 'python3 -m pytest -q', 'make', 'docker compose up -d',
  'mkdir -p src/Service && touch src/Service/X.php', "cat > src/Service/X.php <<'EOF'\n<?php\nclass X {}\nEOF",
  'sed -i "s/old/new/" src/a.php', 'cp src/a.php src/b.php', 'rm src/b.php', 'for f in src/*.php; do php -l "$f"; done',
  'npm install', 'composer dump-autoload', 'php artisan migrate', 'git status && git diff --stat',
  'npx prettier --write src', 'ls ~/.claude', 'cat ~/.gitconfig', 'curl -s -o /tmp/x.json https://api.example.com/x'];
for (const c of PRE) test(`allowed before approval: ${JSON.stringify(c)}`, () => { const r = pre(c); assert.equal(r.allow, true, r.reason); });
for (const c of POST) test(`allowed after approval: ${JSON.stringify(c)}`, () => { const r = post(c); assert.equal(r.allow, true, r.reason); });
