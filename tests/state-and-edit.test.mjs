import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newRun, loadRun, saveRun, modelSetState, userApprove, STATES } from '../scripts/lib/state.mjs';
import { checkEdit } from '../scripts/lib/edit-policy.mjs';

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 't2m-'));
  process.env.T2M_HOME = home;
});

const REPO = '/work/repo';
const REPORT = '/docs/Proj/claude-prompts/2026-09-29/ticket2merge-PROJ-1';

test('a new run is not approved and persists by session id', () => {
  const run = newRun({ sessionId: 'abc', ticket: { key: 'PROJ-1' }, repoRoot: REPO })
  assert.deepEqual(run.repoRoots, [REPO]);;
  saveRun(run);
  const back = loadRun('abc');
  assert.equal(back.state, 'TICKET_RECEIVED');
  assert.equal(back.approved, false);
  assert.equal(back.ticket.key, 'PROJ-1');
});

test('session ids are sanitised so they cannot escape the runs dir', () => {
  const run = newRun({ sessionId: '../../etc/passwd', ticket: {}, repoRoot: REPO });
  saveRun(run);
  assert.equal(loadRun('../../etc/passwd').sessionId, '../../etc/passwd');
});

test('the model cannot set APPROVED or CLOSED', () => {
  const run = newRun({ sessionId: 's', ticket: {}, repoRoot: REPO });
  assert.throws(() => modelSetState(run, 'APPROVED'), /only the user/i);
  assert.throws(() => modelSetState(run, 'CLOSED'), /only the user/i);
});

test('the model cannot move past HUMAN_APPROVAL without approval', () => {
  const run = newRun({ sessionId: 's', ticket: {}, repoRoot: REPO });
  modelSetState(run, 'HUMAN_APPROVAL');
  assert.throws(() => modelSetState(run, 'IMPLEMENTATION'), /not approved/i);
});

test('user approval only counts while waiting at HUMAN_APPROVAL', () => {
  const run = newRun({ sessionId: 's', ticket: {}, repoRoot: REPO });
  assert.equal(userApprove(run, 'approved'), false);
  modelSetState(run, 'HUMAN_APPROVAL');
  assert.equal(userApprove(run, 'approved'), true);
  assert.equal(run.approved, true);
  assert.equal(run.state, 'IMPLEMENTATION');
  modelSetState(run, 'POSITIVE_AUDIT');
});

test('returning to HUMAN_APPROVAL (plan deviation) revokes approval', () => {
  const run = newRun({ sessionId: 's', ticket: {}, repoRoot: REPO });
  modelSetState(run, 'HUMAN_APPROVAL');
  userApprove(run, 'approved');
  modelSetState(run, 'HUMAN_APPROVAL');
  assert.equal(run.approved, false);
});

test('unknown states are rejected', () => {
  const run = newRun({ sessionId: 's', ticket: {}, repoRoot: REPO });
  assert.throws(() => modelSetState(run, 'SHIP_IT'), /unknown state/i);
  assert.ok(STATES.includes('READY_FOR_MANUAL_COMMIT'));
});

// --- edit gate --------------------------------------------------------------------

const ctx = () => ({ t2mHome: home });
const runAt = (approved) => ({ ...newRun({ sessionId: 's', ticket: {}, repoRoot: REPO }), approved, reportDir: REPORT });

test('before approval: repo edits are denied', () => {
  const r = checkEdit(runAt(false), `${REPO}/src/app.php`, ctx());
  assert.equal(r.allow, false);
  assert.match(r.reason, /approval/i);
});

test('before approval: the report folder is writable', () => {
  assert.equal(checkEdit(runAt(false), `${REPORT}/plan.md`, ctx()).allow, true);
});

test('before approval: files outside the project repos stay writable (plan docs, memory)', () => {
  assert.equal(checkEdit(runAt(false), '/home/u/notes/plan.md', ctx()).allow, true);
});

test('before approval with no repo known yet: only the report folder is writable', () => {
  const run = { ...runAt(false), repoRoots: [] };
  assert.equal(checkEdit(run, '/home/u/notes/plan.md', ctx()).allow, false);
  assert.equal(checkEdit(run, `${REPORT}/plan.md`, ctx()).allow, true);
});

test('every repo root of a multi-repo ticket is protected', () => {
  const run = { ...runAt(false), repoRoots: [REPO, '/work/frontend'] };
  assert.equal(checkEdit(run, '/work/frontend/src/App.vue', ctx()).allow, false);
});

test('after approval: repo edits are allowed', () => {
  assert.equal(checkEdit(runAt(true), `${REPO}/src/app.php`, ctx()).allow, true);
});

test('always: .git internals are denied', () => {
  assert.equal(checkEdit(runAt(true), `${REPO}/.git/config`, ctx()).allow, false);
  assert.equal(checkEdit(runAt(true), `${REPO}/.git/hooks/pre-commit`, ctx()).allow, false);
});

test('the reports folder under T2M_HOME is not treated as run state', () => {
  const run = { ...runAt(false), reportDir: `${home}/reports/proj/2026-09-29-PROJ-1` };
  assert.equal(checkEdit(run, `${home}/reports/proj/2026-09-29-PROJ-1/report.md`, ctx()).allow, true);
});

test('always: run state is denied', () => {
  assert.equal(checkEdit(runAt(true), `${home}/runs/s.json`, ctx()).allow, false);
});

test('relative paths resolve against the repo root', () => {
  assert.equal(checkEdit(runAt(false), 'src/app.php', ctx()).allow, false);
});

test('a lookalike prefix is not treated as inside the repo', () => {
  assert.equal(checkEdit(runAt(false), '/work/repo-other/x.php', ctx()).allow, true);
  assert.equal(checkEdit(runAt(false), '/work/repo/x.php', ctx()).allow, false);
});
