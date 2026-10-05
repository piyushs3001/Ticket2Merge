// Regression cover for the readiness-review findings (C1–C3, H1–H5, M1–M3).
// Every case here was a proven or suspected bypass before the fix.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBash } from '../scripts/lib/bash-policy.mjs';
import { checkBashRepoWrites } from '../scripts/lib/repo-write-policy.mjs';
import { checkEdit } from '../scripts/lib/edit-policy.mjs';
import { checkMcp } from '../scripts/lib/mcp-policy.mjs';
import { newRun, modelSetState, userApprove, reportTestCaseGaps } from '../scripts/lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (p) => realpathSync(mkdtempSync(path.join(tmpdir(), p)));

let HOME; let T2M; let REPO; let OUTSIDE; let SCRIPTS;
before(() => {
  HOME = tmp('t2m-fakehome-');
  T2M = path.join(HOME, '.claude', 'ticket2merge');
  mkdirSync(path.join(T2M, 'runs'), { recursive: true });
  REPO = tmp('t2m-repo-');
  mkdirSync(path.join(REPO, 'src'));
  mkdirSync(path.join(REPO, '.git'));
  writeFileSync(path.join(REPO, 'src', 'a.php'), '<?php');
  OUTSIDE = tmp('t2m-out-');
  symlinkSync(path.join(REPO, 'src'), path.join(OUTSIDE, 'link-to-src'));
  symlinkSync(path.join(REPO, '.git'), path.join(OUTSIDE, 'link-to-git'));
  SCRIPTS = tmp('t2m-scripts-');
  writeFileSync(path.join(SCRIPTS, 'bad.sh'), 'echo hi\ngit commit -m sneaky\n');
  writeFileSync(path.join(SCRIPTS, 'ok.sh'), 'echo hi\ngit status\n');
  writeFileSync(path.join(SCRIPTS, 'bad.js'), "require('child_process').execSync('git push')\n");
  writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', release: 'npm version patch && git push --follow-tags' } }));
});

const bash = (cmd, cwd = REPO) => checkBash(cmd, { t2mHome: T2M, cwd, home: HOME });

// --- H1: other spellings of git --------------------------------------------------
for (const cmd of [
  'git-commit -m x',
  '/usr/lib/git-core/git-commit -m x',
  'busybox git commit -m x',
  'toybox git push',
  'x=git; $x commit -m x',
  'g="git commit"; $g -m x',
  'git${IFS}commit -m x',
  "$'git' commit -m x",
  'alias g=git; g commit -m x',
  'GIT_EXTERNAL_DIFF=/tmp/evil git diff',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=sh git log',
]) {
  test(`H1 blocks git spelled as ${JSON.stringify(cmd)}`, () => assert.equal(bash(cmd).allow, false));
}

// --- H2: .git reached through cd / relative paths / symlinks ----------------------
for (const [cmd, cwd] of [
  ['cd .git && echo x > HEAD', () => REPO],
  ['echo x > HEAD', () => path.join(REPO, '.git')],
  ['cd .git && rm index', () => REPO],
  ['echo x > link-to-git/HEAD', () => OUTSIDE],
]) {
  test(`H2 blocks .git write: ${cmd}`, () => assert.equal(bash(cmd, cwd()).allow, false));
}
test('H2 reading .git through cd is still fine', () => assert.equal(bash('cd .git && cat HEAD').allow, true));

// --- H3: global git config --------------------------------------------------------
for (const cmd of [
  'echo "[alias] st = commit" >> ~/.gitconfig',
  'cat x > $HOME/.gitconfig',
  'mkdir -p ~/.config/git && echo x > ~/.config/git/config',
  'cp /tmp/evil ~/.gitconfig',
]) {
  test(`H3 blocks git config write: ${cmd}`, () => {
    const r = checkBash(cmd, { t2mHome: T2M, cwd: REPO, home: HOME, env: { HOME } });
    assert.equal(r.allow, false);
  });
}
test('H3 reading ~/.gitconfig is fine', () => assert.equal(bash('cat ~/.gitconfig').allow, true));
test('H3 Edit on ~/.gitconfig is denied', () => {
  const run = { ...newRun({ sessionId: 's', repoRoot: REPO }), approved: true };
  assert.equal(checkEdit(run, path.join(HOME, '.gitconfig'), { t2mHome: T2M, home: HOME }).allow, false);
});

// --- C2: run state reached without its literal path -------------------------------
for (const [cmd, cwd] of [
  ['cd ~/.claude/ticket2merge && echo x > runs/abc.json', () => REPO],
  ['echo x > runs/abc.json', () => T2M],
  ['echo x > abc.json', () => path.join(T2M, 'runs')],
  ['cd ~/.claude && mv ticket2merge t2m-old', () => REPO],
  [`rm -rf ${T2M}`, () => REPO],
  [`D=${T2M}/runs; echo x > $D/abc.json`, () => REPO],
  [`python3 -c "open('runs/abc.json','w').write('{}')"`, () => T2M],
  [`node -e "require('fs').writeFileSync(process.env.HOME + '/.claude/ticket2merge/runs/x.json', '{}')"`, () => REPO],
]) {
  test(`C2 blocks run-state tampering: ${cmd}`, () => {
    const r = checkBash(cmd, { t2mHome: T2M, cwd: cwd(), home: HOME, env: { HOME } });
    assert.equal(r.allow, false);
  });
}

// --- scripts: the guard reads what it is asked to execute -------------------------
test('script files are scanned: bash bad.sh', () => assert.equal(bash(`bash ${SCRIPTS}/bad.sh`).allow, false));
test('script files are scanned: source / .', () => {
  assert.equal(bash(`source ${SCRIPTS}/bad.sh`).allow, false);
  assert.equal(bash(`. ${SCRIPTS}/bad.sh`).allow, false);
});
test('script files are scanned: node bad.js', () => assert.equal(bash(`node ${SCRIPTS}/bad.js`).allow, false));
test('a clean script still runs', () => assert.equal(bash(`bash ${SCRIPTS}/ok.sh`).allow, true));
test('a script written and executed in the same command is blocked', () => {
  assert.equal(bash(`printf 'git commit -m x' > ${SCRIPTS}/new.sh && sh ${SCRIPTS}/new.sh`).allow, false);
});
test('npm run <script> is expanded from package.json', () => {
  assert.equal(bash('npm run release').allow, false);
  assert.equal(bash('npm test').allow, true);
});

// --- C1 / H5 / M1: Gate 1 for the shell -------------------------------------------
const gate = (cmd, cwd = REPO, extra = {}) => checkBashRepoWrites(cmd, { repoRoots: [REPO], cwd, safeDirs: [OUTSIDE], ...extra });

for (const cmd of [
  'curl -s -o src/x.php https://example.com/x',
  'wget -O src/x.php https://example.com/x',
  'wget https://example.com/x.php',
  'tar -xf /tmp/a.tar -C src',
  'unzip /tmp/a.zip -d src',
  'patch -p1 < /tmp/fix.diff',
  `node -e "require('fs').writeFileSync('src/a.php','x')"`,
  `python3 -c "open('src/a.php','w').write('x')"`,
  'php artisan migrate',
  'php yii migrate/up',
  'install -D /tmp/x src/x.php',
  'truncate -s 0 src/a.php',
  'npx phpcbf src',
  'npm run build',
  'echo x > $UNSET_T2M_VAR/a.php',
]) {
  test(`Gate 1 (shell) blocks before approval: ${cmd}`, () => assert.equal(gate(cmd).allow, false));
}
test('M1: a symlink outside the repo that points into it is still the repo', () => {
  assert.equal(gate(`echo x > ${OUTSIDE}/link-to-src/a.php`, OUTSIDE).allow, false);
});
for (const cmd of [
  'curl -s https://gitlab.example/api/v4/projects/1/issues/2',
  'curl -s -o /tmp/issue.json https://gitlab.example/api/v4/projects/1/issues/2',
  'wget -qO- https://example.com',
  'gh issue view https://github.com/o/r/issues/1 --comments',
  'php artisan route:list',
  'php -l src/a.php',
  'npx eslint src',
  'npx tsc --noEmit',
  'composer show',
  `python3 ${SCRIPTS}/score.py --json < /tmp/ticket.txt`,
]) {
  test(`Gate 1 (shell) still allows inspection: ${cmd}`, () => assert.equal(gate(cmd).allow, true, gate(cmd).reason));
}
test('H5: with no repo recorded, shell writes outside the safe dirs are blocked', () => {
  const r = checkBashRepoWrites('echo x > a.php', { repoRoots: [], cwd: '/srv/some-project', safeDirs: [OUTSIDE] });
  assert.equal(r.allow, false);
});
test('H5: with no repo recorded, the report folder and tmp stay writable', () => {
  assert.equal(checkBashRepoWrites(`echo x > ${OUTSIDE}/plan.md`, { repoRoots: [], cwd: '/srv/p', safeDirs: [OUTSIDE] }).allow, true);
  assert.equal(checkBashRepoWrites('echo x > /tmp/scratch.txt', { repoRoots: [], cwd: '/srv/p', safeDirs: [OUTSIDE] }).allow, true);
});

// --- C1 / M1: Gate 1 for file tools -----------------------------------------------
const ctx = () => ({ t2mHome: T2M, home: HOME });
test('C1: a report folder that contains the repo does not open the repo', () => {
  const run = { ...newRun({ sessionId: 's', repoRoot: REPO }), reportDir: '/' };
  assert.equal(checkEdit(run, path.join(REPO, 'src/a.php'), ctx()).allow, false);
});
test('M1: Edit through a symlink into the repo is denied before approval', () => {
  const run = newRun({ sessionId: 's', repoRoot: REPO });
  assert.equal(checkEdit(run, path.join(OUTSIDE, 'link-to-src', 'a.php'), ctx()).allow, false);
});
test('M1: Edit through a symlink into .git is denied even after approval', () => {
  const run = { ...newRun({ sessionId: 's', repoRoot: REPO }), approved: true };
  assert.equal(checkEdit(run, path.join(OUTSIDE, 'link-to-git', 'config'), ctx()).allow, false);
});
test('M1: relative Edit paths resolve against the tool call cwd', () => {
  const run = newRun({ sessionId: 's', repoRoot: REPO });
  assert.equal(checkEdit(run, 'a.php', { ...ctx(), cwd: path.join(REPO, 'src') }).allow, false);
  assert.equal(checkEdit(run, 'notes.md', { ...ctx(), cwd: OUTSIDE }).allow, true);
});

// --- M2: MCP tools under Gate 1 ---------------------------------------------------
test('M2: a filesystem MCP write into the repo is denied before approval', () => {
  const run = newRun({ sessionId: 's', repoRoot: REPO });
  const r = checkMcp('mcp__filesystem__write_file', { path: path.join(REPO, 'src/a.php'), content: 'x' }, { run });
  assert.equal(r.allow, false);
});
test('M2: an MCP read of a repo file is fine before approval', () => {
  const run = newRun({ sessionId: 's', repoRoot: REPO });
  assert.equal(checkMcp('mcp__filesystem__read_file', { path: path.join(REPO, 'src/a.php') }, { run }).allow, true);
});
test('M2: after approval the MCP write is allowed', () => {
  const run = { ...newRun({ sessionId: 's', repoRoot: REPO }), approved: true };
  assert.equal(checkMcp('mcp__filesystem__write_file', { path: path.join(REPO, 'src/a.php') }, { run }).allow, true);
});

// --- M3: stages cannot be skipped mechanically ------------------------------------
function approvedRun() {
  const run = newRun({ sessionId: 's', repoRoot: REPO });
  modelSetState(run, 'HUMAN_APPROVAL');
  userApprove(run, 'approve');
  return run;
}
const FULL_PASS = ['POSITIVE_AUDIT', 'NEGATIVE_ADVERSARIAL_AUDIT', 'TEST_CASE_GENERATION', 'UNIT_INTEGRATION_TESTING',
  'REGRESSION_TESTING', 'FINAL_VERIFICATION'];
test('M3: READY_FOR_MANUAL_COMMIT needs audits, test stages, regression and final verification after approval', () => {
  const run = approvedRun();
  assert.throws(() => modelSetState(run, 'READY_FOR_MANUAL_COMMIT'), /NEGATIVE_ADVERSARIAL_AUDIT|POSITIVE_AUDIT/);
  for (const s of FULL_PASS) modelSetState(run, s);
  modelSetState(run, 'READY_FOR_MANUAL_COMMIT');
  assert.equal(run.state, 'READY_FOR_MANUAL_COMMIT');
});
test('M3: audits from before a re-approval do not count', () => {
  const run = approvedRun();
  for (const s of FULL_PASS) modelSetState(run, s);
  modelSetState(run, 'HUMAN_APPROVAL', 'deviation');
  userApprove(run, 'approved');
  assert.throws(() => modelSetState(run, 'READY_FOR_MANUAL_COMMIT'));
});
test('M3: writing and running test cases cannot be skipped', () => {
  for (const skipped of ['TEST_CASE_GENERATION', 'UNIT_INTEGRATION_TESTING']) {
    const run = approvedRun();
    for (const s of FULL_PASS.filter((x) => x !== skipped)) modelSetState(run, s);
    assert.throws(() => modelSetState(run, 'READY_FOR_MANUAL_COMMIT'), new RegExp(skipped));
  }
});
test('M3: a rework loop after re-approval must write and run tests again', () => {
  const run = approvedRun();
  for (const s of FULL_PASS) modelSetState(run, s);
  modelSetState(run, 'HUMAN_APPROVAL', 'deviation');
  userApprove(run, 'approved');
  for (const s of ['POSITIVE_AUDIT', 'NEGATIVE_ADVERSARIAL_AUDIT', 'REGRESSION_TESTING', 'FINAL_VERIFICATION']) modelSetState(run, s);
  assert.throws(() => modelSetState(run, 'READY_FOR_MANUAL_COMMIT'), /TEST_CASE_GENERATION, UNIT_INTEGRATION_TESTING/);
});
test('M3: tests must run again after a bug fix', () => {
  const run = approvedRun();
  for (const s of FULL_PASS.slice(0, -1)) modelSetState(run, s);
  modelSetState(run, 'BUG_FIX_LOOP');
  modelSetState(run, 'FINAL_VERIFICATION');
  assert.throws(() => modelSetState(run, 'READY_FOR_MANUAL_COMMIT'), /UNIT_INTEGRATION_TESTING, REGRESSION_TESTING again after the last code change \(BUG_FIX_LOOP\)/);
  for (const s of ['UNIT_INTEGRATION_TESTING', 'REGRESSION_TESTING', 'FINAL_VERIFICATION']) modelSetState(run, s);
  modelSetState(run, 'READY_FOR_MANUAL_COMMIT');
  assert.equal(run.state, 'READY_FOR_MANUAL_COMMIT');
});

// --- M4: the report must hold both positive and negative test cases ----------------
test('M4: a report without a Test cases section is refused', () => {
  assert.match(reportTestCaseGaps('# Report\n\n## Plan\nPositive and negative things\n').join(' '), /Test cases/);
  assert.match(reportTestCaseGaps(null).join(' '), /report\.md/);
});
test('M4: the Test cases section needs both positive and negative cases', () => {
  const only = (type) => `## 6. Test cases\n\n| ID | Type |\n|---|---|\n| TC-1 | ${type} |\n\n## 7. Test runs\nNegative words here do not count\n`;
  assert.match(reportTestCaseGaps(only('Positive')).join(' '), /negative/i);
  assert.match(reportTestCaseGaps(only('Negative')).join(' '), /positive/i);
});
test('M4: a sub-heading inside the Test cases section still counts', () => {
  const text = '## Test cases\n\n### Positive\n| TC-1 | Positive |\n\n### Negative\n| TC-2 | Negative |\n\n## Final\n';
  assert.deepEqual(reportTestCaseGaps(text), []);
});

// --- C1 / C3 / H4 end to end through the real hook scripts ------------------------
function e2e() {
  const home = tmp('t2m-e2e-home-');
  const repo = tmp('t2m-e2e-repo-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(path.join(repo, 'src'));
  const env = { ...process.env, T2M_HOME: home, CLAUDE_PLUGIN_ROOT: ROOT };
  const hook = (script, payload, session = 'e2e') => {
    const r = spawnSync('node', [path.join(ROOT, 'scripts/hooks', script)], {
      input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: session, cwd: repo, ...payload }), env, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const cli = (session, ...args) => spawnSync('node', [path.join(ROOT, 'scripts/t2m.mjs'), ...args, '--run', session], { env, encoding: 'utf8' });
  const denied = (o) => o?.hookSpecificOutput?.permissionDecision === 'deny';
  const ctxOf = (o) => o?.hookSpecificOutput?.additionalContext || '';
  return { home, repo, hook, cli, denied, ctxOf };
}

test('C1: the CLI refuses a report folder that contains (or is) a repo', () => {
  const { hook, cli, repo } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  assert.notEqual(cli('e2e', 'set', '--report-dir', '/').status, 0);
  assert.notEqual(cli('e2e', 'set', '--report-dir', path.dirname(repo)).status, 0);
  assert.notEqual(cli('e2e', 'set', '--report-dir', repo).status, 0);
});

test('C1: adding a repo that contains the report folder is refused', () => {
  const { hook, cli } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  const parent = tmp('t2m-parent-');
  const report = path.join(parent, 'report');
  mkdirSync(report);
  assert.equal(cli('e2e', 'set', '--report-dir', report).status, 0);
  assert.notEqual(cli('e2e', 'set', '--repo', parent).status, 0);
});

test('C3: a corrupted run file fails closed, not open', () => {
  const { home, hook, denied } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  writeFileSync(path.join(home, 'runs', 'e2e.json'), 'garbage');
  assert.ok(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } })));
  assert.ok(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'git status' } })));
});

test('C3: a run file with a valid shape but invalid content fails closed', () => {
  const { home, hook, denied } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  writeFileSync(path.join(home, 'runs', 'e2e.json'), JSON.stringify({ state: 'NOPE' }));
  assert.ok(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } })));
});

test('C3: the user can still recover a corrupted run with /ticket2merge stop', () => {
  const { home, hook, denied, ctxOf } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  writeFileSync(path.join(home, 'runs', 'e2e.json'), 'garbage');
  assert.match(ctxOf(hook('user-prompt.mjs', { prompt: '/ticket2merge stop' })), /closed/i);
  assert.equal(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'git status' } })), false);
});

test('an unreadable hook event while any run is active fails closed', () => {
  const { hook, denied } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  assert.ok(denied(hook('pre-tool.mjs', '{not json')));
});

test('H4: resuming a CLOSED approved run starts over without approval', () => {
  const { hook, cli } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-7' }, 'old');
  cli('old', 'state', 'HUMAN_APPROVAL');
  hook('user-prompt.mjs', { prompt: 'approve' }, 'old');
  hook('user-prompt.mjs', { prompt: '/ticket2merge stop' }, 'old');
  hook('user-prompt.mjs', { prompt: '/ticket2merge resume ABC-7' }, 'new');
  const r = JSON.parse(cli('new', 'status').stdout);
  assert.equal(r.approved, false);
  assert.equal(r.state, 'TICKET_RECEIVED');
});

test('H4: resuming an active run moves it — the old session no longer has it', () => {
  const { hook, cli, denied } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-8' }, 'old');
  hook('user-prompt.mjs', { prompt: '/ticket2merge resume ABC-8' }, 'new');
  assert.equal(JSON.parse(cli('new', 'status').stdout).ticket.key, 'ABC-8');
  assert.notEqual(cli('old', 'status').status, 0);
  assert.equal(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, 'old')), false);
});

test('PowerShell tool calls go through the same git guard', () => {
  const { hook, denied } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  assert.ok(denied(hook('pre-tool.mjs', { tool_name: 'PowerShell', tool_input: { command: 'git add .; git commit -m x' } })));
});

test('activation context carries the effective config', () => {
  const { hook, ctxOf, repo } = e2e();
  writeFileSync(path.join(repo, '.ticket2merge.json'), JSON.stringify({ gitlabUrl: 'https://gl.example', jiraSite: 'acme.atlassian.net' }));
  const out = ctxOf(hook('user-prompt.mjs', { prompt: 'ABC-1' }));
  assert.match(out, /gitlabUrl: https:\/\/gl\.example/);
  assert.match(out, /jiraSite: acme\.atlassian\.net/);
});

test('an explicit t2m mention bypasses projectKeys (documented as "always")', () => {
  const { hook, ctxOf, repo } = e2e();
  writeFileSync(path.join(repo, '.ticket2merge.json'), JSON.stringify({ projectKeys: ['XYZ'] }));
  assert.match(ctxOf(hook('user-prompt.mjs', { prompt: 't2m ABC-1' })), /ticket2merge:ticket2merge/);
});

test('the t2m-adversary subagent stays read-only even after approval', () => {
  const { hook, cli, denied, repo } = e2e();
  hook('user-prompt.mjs', { prompt: 'ABC-1' });
  cli('e2e', 'state', 'HUMAN_APPROVAL');
  hook('user-prompt.mjs', { prompt: 'approve' });
  const asAdversary = { agent_id: 'a1', agent_type: 'ticket2merge:t2m-adversary' };
  assert.ok(denied(hook('pre-tool.mjs', { ...asAdversary, tool_name: 'Bash', tool_input: { command: 'echo x > src/a.php' } })));
  assert.ok(denied(hook('pre-tool.mjs', { ...asAdversary, tool_name: 'Write', tool_input: { file_path: path.join(repo, 'src/a.php') } })));
  assert.equal(denied(hook('pre-tool.mjs', { ...asAdversary, tool_name: 'Bash', tool_input: { command: 'git diff && cat src/a.php' } })), false);
  // the main agent is unaffected
  assert.equal(denied(hook('pre-tool.mjs', { tool_name: 'Bash', tool_input: { command: 'echo x > src/a.php' } })), false);
});
