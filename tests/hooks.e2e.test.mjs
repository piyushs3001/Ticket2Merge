import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let home;
let repo;
let env;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 't2m-home-'));
  repo = mkdtempSync(path.join(tmpdir(), 't2m-repo-'));
  mkdirSync(path.join(repo, 'src'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  env = { ...process.env, T2M_HOME: home, CLAUDE_PLUGIN_ROOT: ROOT };
});

const SESSION = 'sess-1';

function hook(script, payload) {
  const r = spawnSync('node', [path.join(ROOT, 'scripts/hooks', script)], {
    input: JSON.stringify({ session_id: SESSION, cwd: repo, ...payload }),
    env,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const prompt = (text) => hook('user-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text });
const bash = (command) => hook('pre-tool.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
const write = (file) => hook('pre-tool.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'x' } });
const mcp = (tool) => hook('pre-tool.mjs', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} });
const cli = (...args) => spawnSync('node', [path.join(ROOT, 'scripts/t2m.mjs'), ...args, '--run', SESSION], { env, encoding: 'utf8' });
const runState = () => JSON.parse(readFileSync(path.join(home, 'runs', `${SESSION}.json`), 'utf8'));
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const context = (out) => out?.hookSpecificOutput?.additionalContext || '';

test('without an active run the guard stays out of the way', () => {
  assert.equal(bash('git commit -m x'), null);
  assert.equal(write(path.join(repo, 'src/a.php')), null);
});

test('dropping a Jira key activates Ticket2Merge and tells Claude to load the skill', () => {
  const out = prompt('PROJ-3502');
  assert.match(context(out), /ticket2merge:ticket2merge/);
  assert.match(context(out), /PROJ-3502/);
  const run = runState();
  assert.equal(run.ticket.key, 'PROJ-3502');
  assert.equal(run.repoRoots[0], repo);
});

test('an ordinary prompt does not activate anything', () => {
  assert.equal(prompt('post a comment on PROJ-3502 saying deployed'), null);
  assert.equal(bash('git commit -m x'), null);
});

test('active run: state-changing git is denied, read-only git allowed', () => {
  prompt('PROJ-1');
  assert.ok(denied(bash('git add . && git commit -m x')));
  assert.equal(bash('git status && git diff --cached'), null);
});

test('Gate 1: repo edits wait for an explicit approval from the user', () => {
  prompt('PROJ-1');
  const file = path.join(repo, 'src/a.php');
  assert.ok(denied(write(file)));

  assert.equal(cli('state', 'HUMAN_APPROVAL').status, 0);
  assert.doesNotMatch(context(prompt('looks fine I guess')), /APPROVED/);
  assert.ok(denied(write(file)));

  assert.match(context(prompt('approved but rename the service')), /not recorded as approval/i);
  assert.ok(denied(write(file)));

  assert.match(context(prompt('approved')), /APPROVED/);
  assert.equal(write(file), null);
  assert.equal(runState().approved, true);
});

test('Gate 1 also covers shell writes into the repo, and lifts after approval', () => {
  prompt('PROJ-1');
  assert.ok(denied(bash('echo x > src/a.php')));
  assert.equal(bash('cat src/a.php > /tmp/t2m-copy.txt'), null);
  cli('state', 'HUMAN_APPROVAL');
  prompt('approved');
  assert.equal(bash('echo x > src/a.php'), null);
});

test('the model cannot approve through the CLI or by editing state', () => {
  prompt('PROJ-1');
  const r = cli('state', 'APPROVED');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /only the user/i);
  assert.ok(denied(write(path.join(home, 'runs', `${SESSION}.json`))));
  assert.ok(denied(bash(`sed -i 's/false/true/' ${home}/runs/${SESSION}.json`)));
});

test('the report folder is writable before approval but may not sit inside the repo', () => {
  prompt('PROJ-1');
  const report = mkdtempSync(path.join(tmpdir(), 't2m-report-'));
  assert.equal(cli('set', '--report-dir', report).status, 0);
  assert.equal(write(path.join(report, 'plan.md')), null);
  assert.notEqual(cli('set', '--report-dir', path.join(repo, 'docs')).status, 0);
});

test('repos can only be added before approval', () => {
  prompt('PROJ-1');
  const other = mkdtempSync(path.join(tmpdir(), 't2m-fe-'));
  assert.equal(cli('set', '--repo', other).status, 0);
  assert.deepEqual(runState().repoRoots, [repo, other]);
  cli('state', 'HUMAN_APPROVAL');
  prompt('approve');
  assert.notEqual(cli('set', '--repo', '/elsewhere').status, 0);
});

test('git-capable MCP tools cannot merge or commit; others are untouched', () => {
  prompt('PROJ-1');
  assert.ok(denied(mcp('mcp__gitlab__merge_merge_request')));
  assert.ok(denied(mcp('mcp__github__create_or_update_file')));
  assert.ok(denied(mcp('mcp__git__git_commit')));
  assert.equal(mcp('mcp__github__get_pull_request'), null);
  assert.equal(mcp('mcp__claude_ai_Atlassian__getJiraIssue'), null);
  assert.equal(mcp('mcp__playwright__browser_click'), null);
});

test('reporting a manual commit at the commit gate prompts verification', () => {
  prompt('PROJ-1');
  cli('state', 'HUMAN_APPROVAL');
  prompt('approved');
  for (const s of ['POSITIVE_AUDIT', 'NEGATIVE_ADVERSARIAL_AUDIT', 'REGRESSION_TESTING', 'FINAL_VERIFICATION']) cli('state', s);
  assert.equal(cli('state', 'READY_FOR_MANUAL_COMMIT').status, 0);
  assert.match(context(prompt('I committed the changes')), /verify/i);
});

test('/ticket2merge stop closes the run and releases the guard', () => {
  prompt('PROJ-1');
  assert.match(context(prompt('/ticket2merge stop')), /closed/i);
  assert.equal(bash('git commit -m x'), null);
});

test('a second ticket while one is active is not silently swapped in', () => {
  prompt('PROJ-1');
  assert.match(context(prompt('PROJ-2')), /already active/i);
  assert.equal(runState().ticket.key, 'PROJ-1');
});

test('explicit /ticket2merge with plain text starts a run without a key', () => {
  const out = prompt('/ticket2merge Add a CSV export to the invoice list');
  assert.match(context(out), /ticket2merge:ticket2merge/);
  assert.equal(runState().ticket.text, 'Add a CSV export to the invoice list');
});

test('session start re-injects an active run after resume/compaction', () => {
  prompt('PROJ-1');
  const out = hook('session-start.mjs', { hook_event_name: 'SessionStart', source: 'compact' });
  assert.match(context(out), /PROJ-1/);
  assert.match(context(out), /TICKET_RECEIVED/);
});

test('a guard crash during an active run fails closed', () => {
  prompt('PROJ-1');
  const out = hook('pre-tool.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: { not: 'a string' } } });
  assert.ok(denied(out));
});

test('t2m ref prints a stage reference without needing file-read permission', () => {
  const r = spawnSync('node', [path.join(ROOT, 'scripts/t2m.mjs'), 'ref', 'testing'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Playwright/);
  const bad = spawnSync('node', [path.join(ROOT, 'scripts/t2m.mjs'), 'ref', '../../hooks/hooks'], { env, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  const list = spawnSync('node', [path.join(ROOT, 'scripts/t2m.mjs'), 'ref'], { env, encoding: 'utf8' });
  assert.match(list.stdout, /skill-registry/);
});

test('activation context sets the chat style (brief by default, detailed on request)', () => {
  assert.match(context(prompt('PROJ-1')), /Chat style: brief/);
  prompt('/ticket2merge stop');
  writeFileSync(path.join(repo, '.ticket2merge.json'), JSON.stringify({ style: 'detailed' }));
  assert.match(context(prompt('PROJ-2')), /Chat style: detailed/);
});
