// Run state, one JSON file per Claude session. The model moves through states via the
// t2m CLI; only the user's own prompt (captured by the UserPromptSubmit hook) can approve
// or close a run.

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isExplicitApproval } from './prompt-intent.mjs';

export const STATES = [
  'TICKET_RECEIVED',
  'REPOSITORY_INVESTIGATION',
  'REQUIREMENTS_GAP_ANALYSIS',
  'IMPLEMENTATION_PLAN',
  'HUMAN_APPROVAL',
  'IMPLEMENTATION',
  'POSITIVE_AUDIT',
  'NEGATIVE_ADVERSARIAL_AUDIT',
  'BUG_FIX_LOOP',
  'TEST_CASE_GENERATION',
  'UNIT_INTEGRATION_TESTING',
  'PLAYWRIGHT_TESTING',
  'REGRESSION_TESTING',
  'FINAL_VERIFICATION',
  'READY_FOR_MANUAL_COMMIT',
  'HUMAN_COMMIT',
  'MR_LINK',
  'MR_DESCRIPTION',
  'CLOSED',
];
const USER_ONLY = new Set(['APPROVED', 'CLOSED']);
// The run cannot be declared ready unless these stages were entered after the latest approval.
const REQUIRED_BEFORE_READY = ['POSITIVE_AUDIT', 'NEGATIVE_ADVERSARIAL_AUDIT', 'REGRESSION_TESTING', 'FINAL_VERIFICATION'];
const APPROVAL_INDEX = STATES.indexOf('HUMAN_APPROVAL');

export const t2mHome = () => process.env.T2M_HOME || path.join(homedir(), '.claude', 'ticket2merge');
const runFile = (sessionId) =>
  path.join(t2mHome(), 'runs', `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

const now = () => new Date().toISOString();

export function newRun({ sessionId, ticket = {}, repoRoot = null }) {
  const at = now();
  return {
    version: 1,
    sessionId,
    ticket,
    repoRoots: repoRoot ? [repoRoot] : [],
    reportDir: null,
    state: 'TICKET_RECEIVED',
    approved: false,
    approval: null,
    createdAt: at,
    updatedAt: at,
    history: [{ state: 'TICKET_RECEIVED', at, by: 'hook' }],
  };
}

// A run file that exists but cannot be trusted must never read as "no run": that would turn
// every guard off. Callers use loadRunStatus to fail closed on 'invalid'.
function validRun(r) {
  return Boolean(r) && typeof r === 'object' && typeof r.sessionId === 'string' && STATES.includes(r.state)
    && typeof r.approved === 'boolean' && Array.isArray(r.repoRoots) && Array.isArray(r.history)
    && r.ticket && typeof r.ticket === 'object';
}

export function loadRunStatus(sessionId) {
  if (!sessionId) return { status: 'missing', run: null };
  let raw;
  try {
    raw = readFileSync(runFile(sessionId), 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { status: 'missing', run: null } : { status: 'invalid', run: null };
  }
  try {
    const run = JSON.parse(raw);
    return validRun(run) ? { status: 'ok', run } : { status: 'invalid', run: null };
  } catch {
    return { status: 'invalid', run: null };
  }
}

export function loadRun(sessionId) {
  return loadRunStatus(sessionId).run;
}

export function listRuns() {
  const dir = path.join(t2mHome(), 'runs');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => {
    try {
      const run = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      return validRun(run) ? { status: 'ok', run } : { status: 'invalid', run: null };
    } catch {
      return { status: 'invalid', run: null };
    }
  });
}

export function saveRun(run) {
  const file = runFile(run.sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  run.updatedAt = now();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

export const isActive = (run) => Boolean(run) && run.state !== 'CLOSED';

export function modelSetState(run, state, note) {
  if (USER_ONLY.has(state)) throw new Error(`only the user can set ${state}, by their own message`);
  const idx = STATES.indexOf(state);
  if (idx < 0) throw new Error(`unknown state: ${state}`);
  if (idx > APPROVAL_INDEX && !run.approved) {
    throw new Error(`plan not approved — the user must reply with an explicit approval before ${state}`);
  }
  if (state === 'READY_FOR_MANUAL_COMMIT') {
    const since = run.history.map((h) => h.by === 'user' && h.note === 'explicit approval').lastIndexOf(true);
    const seen = new Set(run.history.slice(since + 1).map((h) => h.state));
    const missing = REQUIRED_BEFORE_READY.filter((s) => !seen.has(s));
    if (missing.length) {
      throw new Error(`cannot be READY_FOR_MANUAL_COMMIT: ${missing.join(', ')} not done since the approval — report the run as NOT READY instead`);
    }
  }
  if (idx <= APPROVAL_INDEX && run.approved) {
    run.approved = false;
    run.approval = { ...run.approval, revokedAt: now(), revokedBecause: note || `returned to ${state}` };
  }
  run.state = state;
  run.history.push({ state, at: now(), by: 'model', ...(note ? { note } : {}) });
  return run;
}

export function userApprove(run, prompt) {
  if (run.state !== 'HUMAN_APPROVAL' || !isExplicitApproval(prompt)) return false;
  run.approved = true;
  run.approval = { at: now(), text: prompt.trim() };
  run.state = 'IMPLEMENTATION';
  run.history.push({ state: 'IMPLEMENTATION', at: now(), by: 'user', note: 'explicit approval' });
  return true;
}

export function closedStub(sessionId, why) {
  const run = newRun({ sessionId, ticket: {} });
  return userClose(run, why);
}

export function userClose(run, why = 'closed by user') {
  run.state = 'CLOSED';
  run.history.push({ state: 'CLOSED', at: now(), by: 'user', note: why });
  return run;
}
