// Regression cover for the second review (classifier misclassifications, both directions).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBash } from '../scripts/lib/bash-policy.mjs';
import { checkBashRepoWrites } from '../scripts/lib/repo-write-policy.mjs';
import { checkMcp } from '../scripts/lib/mcp-policy.mjs';
import { checkEdit } from '../scripts/lib/edit-policy.mjs';
import { inside } from '../scripts/lib/paths.mjs';
import { newRun } from '../scripts/lib/state.mjs';

const tmp = (p) => realpathSync(mkdtempSync(path.join(tmpdir(), p)));
let HOME; let T2M; let REPO; let REPORT;
before(() => {
  HOME = tmp('r2-home-');
  T2M = path.join(HOME, '.claude', 'ticket2merge');
  mkdirSync(path.join(T2M, 'runs'), { recursive: true });
  writeFileSync(path.join(T2M, 'runs', 'abc.json'), '{}');
  REPO = tmp('r2-repo-');
  mkdirSync(path.join(REPO, '.git', 'hooks'), { recursive: true });
  writeFileSync(path.join(REPO, '.git', 'HEAD'), 'ref');
  mkdirSync(path.join(REPO, 'src'));
  writeFileSync(path.join(REPO, 'src', 'a.php'), '<?php');
  writeFileSync(path.join(REPO, 'package.json'), '{"scripts":{"test":"node --test"}}');
  writeFileSync(path.join(REPO, 'bad.sh'), '#!/bin/sh\ngit commit -am sneaky\n');
  chmodSync(path.join(REPO, 'bad.sh'), 0o755);
  writeFileSync(path.join(REPO, 'files.txt'), 'a\n');
  REPORT = tmp('r2-report-');
});

const env = () => ({ HOME, PATH: process.env.PATH });
const bash = (cmd, cwd = REPO) => checkBash(cmd, { t2mHome: T2M, cwd, home: HOME, env: env() });
const gate = (cmd, cwd = REPO) => checkBashRepoWrites(cmd, { repoRoots: [REPO], cwd, safeDirs: [REPORT], home: HOME, env: env() });

// ---------------------------------------------------------------- A: must be denied

const BASH_DENY = [
  // globs / braces
  'gi? push', '{git,commit} -am x', 'rm -rf .gi*', 'rm -rf ~/.claude/ticket2merge/*', 'echo x > .gi?/HEAD',
  // /dev/.. escapes
  'echo x >> /dev/..$HOME/.gitconfig', 'echo x > /dev/../REPO/.git/HEAD',
  // shells reading stdin / herestrings / process substitution
  "echo 'git commit -am x' | bash", "bash <<< 'git push'", 'bash < bad.sh', 'source <(echo git push)',
  "echo 'git push' | sh -s", "printf 'git push' | node",
  // wrappers with value options
  'sudo -u root git push', 'timeout -s KILL 5 git push', 'ionice -c 3 git push', 'env -u X git push',
  'env -S "git push"', 'exec -a x git push', 'time -p git push', 'coproc git push', 'nice -n 5 git push',
  // command strings in arguments
  "trap 'git push' EXIT", 'watch -n 5 git push', "su -c 'git push'", 'ssh host git push',
  "script -qc 'git push'", 'docker compose exec app git commit -am x', "find . -exec sh -c 'git commit -am x' \\;",
  // interpreters
  `node -e "require('child_process').spawnSync('git',['push'])"`, `node -pe "require('child_process').execSync('git push')"`,
  `perl -le 'system("git","push")'`, `python3 -Bc "import os; os.system('git push')"`,
  `awk 'BEGIN{system("git push")}'`, `python3 -c "open('.git/HEAD','w').write('x')"`,
  // forges
  'gh api -X PUT repos/o/r/pulls/3/merge', 'gh api repos/o/r/pulls/3/reviews -f event=APPROVE',
  `gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"x"}) { clientMutationId } }'`,
  'glab mr accept 5', 'curl -X PUT https://gl.example/api/v4/projects/1/merge_requests/$MR/merge',
  'gh pr checkout 12', 'glab mr checkout 5', 'gh pr update-branch 12', 'glab mr create --push', 'gh pr create --fill',
  'gh repo clone o/r', 'gh release create v1',
  // .git through find / sed / sort / sponge / xargs
  'find .git -name index -delete', 'find .git/hooks -type f -exec rm {} \\;', 'find .git | xargs rm',
  'sed -Ei s/a/b/ .git/config', 'sed -ri s/a/b/ .git/config', 'sort -o .git/HEAD files.txt',
  'cat files.txt | sponge .git/HEAD', 'gzip .git/HEAD',
  // executable scripts by path
  './bad.sh',
  // unresolvable paths, cd forms, exports
  'cd $(git rev-parse --git-dir) && echo x > HEAD', 'cd -P .git && echo x > HEAD', 'for d in .git; do echo x > $d/HEAD; done',
  'export D=.git; echo x > $D/HEAD', 'cd .git && cd - && cd .git && echo x > HEAD',
  'export GIT_EXTERNAL_DIFF=/tmp/x; git diff',
  // >& file target
  'echo x >& .git/HEAD',
  // arithmetic / ANSI-C / heredoc quoting
  'echo $(( $(git commit -am x) ))', "echo $'\\'' ; git push ; echo $'\\''", "cat <<EOF\nit's\nEOF\ngit push",
  // misc
  'git grep -O"git commit -am x" foo', 'npx release-it', 'npx standard-version',
  // lookalike parent
  `echo x > ${'RUNS'}/..fake.json`,
];

for (const raw of BASH_DENY) {
  test(`denies: ${JSON.stringify(raw).slice(0, 90)}`, () => {
    const cmd = raw.replace('REPO', REPO.slice(1)).replace('RUNS', path.join(T2M, 'runs'));
    const r = bash(cmd);
    assert.equal(r.allow, false, `allowed: ${cmd}`);
  });
}

const GATE_DENY = [
  'python3 manage.py makemigrations', 'node gen.js', './setup.sh', './yii migrate', 'bin/console cache:clear',
  'tsc', 'npx prisma migrate dev', 'vendor/bin/rector process', 'uv sync', 'tox', 'deno fmt', 'yq -i .a=1 cfg.yml',
  'uniq files.txt src/out.txt', 'tree -o src/t.txt', `node -e "require('fs').rmSync('src',{recursive:true})"`,
  `python3 -c "import shutil; shutil.rmtree('src')"`, 'echo x >& src/a.php', 'mysql -e "DROP TABLE x"',
];
for (const cmd of GATE_DENY) {
  test(`Gate 1 denies: ${cmd}`, () => assert.equal(gate(cmd).allow, false, cmd));
}
test('Gate 1 denies inline code that writes into the repo by absolute path from outside it', () => {
  assert.equal(gate(`cd /tmp && python3 -c "open('${REPO}/src/a.php','w').write('x')"`).allow, false);
});

test('inside(): a sibling named "..foo" is not a parent escape', () => {
  assert.equal(inside('/a/b/..foo', '/a/b'), true);
  assert.equal(inside('/a/b..foo', '/a/b'), false);
  assert.equal(inside('/a', '/a/b'), false);
});

// MCP
const run = () => newRun({ sessionId: 's', repoRoot: REPO });
const approved = () => ({ ...run(), approved: true });
for (const tool of [
  'mcp__git__git_add', 'mcp__git__git_init', 'mcp__github__create_pull_request_review',
  'mcp__github__pull_request_review_write', 'mcp__github__submit_pending_pull_request_review',
  'mcp__github__update_pull_request_branch', 'mcp__github__create_pull_request', 'mcp__gitlab__create_merge_request',
]) {
  test(`git-capable MCP tool is denied even after approval: ${tool}`, () => {
    assert.equal(checkMcp(tool, {}, { run: approved(), cwd: REPO }).allow, false);
  });
}
test('MCP writes to protected paths are denied even after approval', () => {
  const r = approved();
  for (const p of [path.join(REPO, '.git/hooks/pre-commit'), path.join(T2M, 'runs/abc.json'), path.join(HOME, '.gitconfig')]) {
    assert.equal(checkMcp('mcp__filesystem__write_file', { path: p }, { run: r, cwd: REPO, t2mHome: T2M, home: HOME }).allow, false, p);
  }
});
test('MCP relative and file:// paths are resolved before approval', () => {
  for (const p of ['src/a.php', `file://${REPO}/src/a.php`]) {
    assert.equal(checkMcp('mcp__filesystem__write_file', { path: p }, { run: run(), cwd: REPO }).allow, false, p);
  }
  assert.equal(checkMcp('mcp__ide__edit', { pathInProject: 'src/a.php' }, { run: run(), cwd: REPO }).allow, false);
});

// ---------------------------------------------------------------- B: must be allowed

const GATE_ALLOW = [
  `cat > ${REPORT}/r.md <<'EOF'\n# Report\nEOF`, "cat <<'EOF'\nhello\nEOF", 'jq . < package.json', 'wc -l < src/a.php',
  'while read f; do echo $f; done < files.txt', `jq . <<< '{"a":1}'`, 'npm --version', 'npm -v', 'yarn --version',
  'composer --version', "awk '{print $1}' src/a.php", "awk -F, '{print $2}' files.txt",
  `node -e "console.log(require('./package.json').name)"`, 'python3 -c "print(1/2)"', "php -r 'echo PHP_VERSION;'",
  'for f in src/*.php; do php -l $f; done', "find . -name '*.php' -exec grep -l foo {} \\;", 'pip list', 'pip show requests',
  'go version', 'npm audit', 'composer audit', 'php artisan migrate:status', 'bat src/a.php', 'ls -la', 'git log --oneline -5',
  `python3 ${REPORT}/score.py --json < /tmp/ticket.txt`, 'cd /tmp && docker ps',
];
for (const cmd of GATE_ALLOW) {
  test(`Gate 1 allows: ${JSON.stringify(cmd).slice(0, 80)}`, () => {
    const r = gate(cmd);
    assert.equal(r.allow, true, r.reason);
    assert.equal(bash(cmd).allow, true, bash(cmd).reason);
  });
}

const BASH_ALLOW = [
  'wc -l < .git/HEAD', 'git stash list', 'git stash show', 'git describe --tags', 'git tag -l', 'git tag --list "v*"',
  'git config --get user.name', 'git config --list', 'git reflog', 'git show-ref', 'git rev-list --count HEAD',
  'git for-each-ref --format="%(refname)"', 'git shortlog -sn', 'echo $T2M_HOME', 'alias gs="git status"',
  'cp .gitignore /tmp/.git-blame-ignore-revs', 'npm test', 'npx playwright test', 'php artisan test', 'vendor/bin/phpunit',
  'npm run build', 'mkdir -p src/x', 'cp src/a.php /tmp/b.php', 'python3 -m pytest', 'docker compose up -d', 'ls ~/.claude',
  'cat ~/.gitconfig', 'rg TODO', 'npm t',
];
for (const cmd of BASH_ALLOW) {
  test(`git guard allows: ${cmd}`, () => assert.equal(bash(cmd).allow, true, bash(cmd).reason));
}
for (const cmd of ['git stash drop', 'git tag v2', 'git tag -d v1', 'git config user.name x', 'git config --unset x', 'git reflog expire --all', 'git reflog delete HEAD@{1}', 'alias gc="git commit"']) {
  test(`read-only git forms stay narrow: ${cmd}`, () => assert.equal(bash(cmd).allow, false));
}
test('Playwright file upload (reads a file) is allowed before approval', () => {
  assert.equal(checkMcp('mcp__playwright__browser_file_upload', { paths: [path.join(REPO, 'src/a.php')] }, { run: run(), cwd: REPO }).allow, true);
});
test('Edit on a lookalike ..fake.json next to runs/ is still protected', () => {
  const r = approved();
  assert.equal(checkEdit(r, path.join(T2M, 'runs', '..fake.json'), { t2mHome: T2M, home: HOME }).allow, false);
});

test('servers merely containing "git" in a longer word are not treated as git servers', () => {
  const r = { ...newRun({ sessionId: 's', repoRoot: REPO }), approved: true };
  assert.equal(checkMcp('mcp__digitalocean__create_droplet', { name: 'x' }, { run: r, cwd: REPO }).allow, true);
  assert.equal(checkMcp('mcp__claude_ai_GitHub__create_issue', {}, { run: r, cwd: REPO }).allow, false);
});
