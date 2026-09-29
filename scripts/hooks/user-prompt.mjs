#!/usr/bin/env node
// UserPromptSubmit — always on. Auto-activates a run when a Jira ticket is dropped,
// records the user's explicit approval (the model cannot), and handles /ticket2merge stop|status|resume.

import { loadConfig } from '../lib/config.mjs';
import { addContext, cliHint, gitTopLevel, readEvent } from '../lib/hook-io.mjs';
import { classifyPrompt, isConditionalApproval, reportsCommit } from '../lib/prompt-intent.mjs';
import { closedStub, isActive, listRuns, loadRunStatus, newRun, saveRun, userApprove, userClose } from '../lib/state.mjs';

const EVENT = 'UserPromptSubmit';
const SKILL = 'ticket2merge:ticket2merge';

const label = (run) => run.ticket.key || (run.ticket.text ? `"${run.ticket.text.slice(0, 60)}"` : 'untitled ticket');

function summary(run) {
  return `ticket ${label(run)} · state ${run.state} · approved ${run.approved ? 'yes' : 'no'}` +
    (run.reportDir ? ` · report ${run.reportDir}` : '');
}

function configLine(cfg) {
  const keys = ['jiraSite', 'gitlabUrl', 'reportRoot', 'projectKeys'];
  const set = keys.filter((k) => (Array.isArray(cfg[k]) ? cfg[k].length : cfg[k]));
  return set.length ? `Effective config: ${set.map((k) => `${k}: ${[].concat(cfg[k]).join(',')}`).join(' · ')}.` : null;
}

function activate(event, ticket, how) {
  const repoRoot = gitTopLevel(event.cwd || process.cwd());
  const run = newRun({ sessionId: event.session_id, ticket, repoRoot });
  saveRun(run);
  const config = loadConfig(repoRoot);
  const cfg = configLine(config);
  const style = config.style === 'detailed' ? 'detailed' : 'brief';
  addContext(EVENT, [
    `[Ticket2Merge] ${how} for ${label(run)} (run id: ${run.sessionId}).`,
    `Invoke the \`${SKILL}\` skill now and follow it from TICKET_RECEIVED.`,
    `The git guard and approval gate are ACTIVE for this session: state-changing git is blocked and repo files stay read-only until the user explicitly approves the plan.`,
    repoRoot ? `Repo detected: ${repoRoot}.` : 'No git repo detected from the current directory — ask the user which repo this ticket belongs to.',
    cfg,
    `Chat style: ${style} — follow the skill's "Talking to the user" rules.`,
    `Run-state CLI: ${cliHint(run.sessionId)}`,
  ].filter(Boolean).join('\n'));
}

function findLatestRun(key, exceptSession) {
  let best = null;
  for (const { run: r } of listRuns()) {
    if (r && r.ticket?.key === key && r.sessionId !== exceptSession && (!best || r.updatedAt > best.updatedAt)) best = r;
  }
  return best;
}

function handleCommand(event, cls, run) {
  if (cls.action === 'stop') {
    if (!isActive(run)) return addContext(EVENT, '[Ticket2Merge] No active run in this session.');
    saveRun(userClose(run, 'stopped by user'));
    return addContext(EVENT, `[Ticket2Merge] Run for ${label(run)} closed by the user. The git guard and approval gate are now off for this session.`);
  }
  if (cls.action === 'status') {
    return addContext(EVENT, isActive(run)
      ? `[Ticket2Merge] Active run: ${summary(run)}. Report this status to the user.`
      : '[Ticket2Merge] No active run in this session.');
  }
  if (cls.action === 'resume') {
    if (!cls.key) return addContext(EVENT, '[Ticket2Merge] Resume needs a ticket key, e.g. `/ticket2merge resume PROJ-12`.');
    if (isActive(run)) return addContext(EVENT, `[Ticket2Merge] A run is already active in this session (${summary(run)}). \`/ticket2merge stop\` it first.`);
    const prev = findLatestRun(cls.key, event.session_id);
    if (!prev) return addContext(EVENT, `[Ticket2Merge] No earlier run found for ${cls.key}. Start one with \`/ticket2merge ${cls.key}\`.`);
    const at = new Date().toISOString();
    let resumed;
    if (prev.state === 'CLOSED') {
      // A closed run restarts from the beginning: its old approval does not carry over.
      resumed = newRun({ sessionId: event.session_id, ticket: prev.ticket });
      resumed.repoRoots = prev.repoRoots;
      resumed.reportDir = prev.reportDir;
      resumed.history.push({ state: 'TICKET_RECEIVED', at, by: 'user', note: `restarted from closed run in session ${prev.sessionId}` });
    } else {
      // An active run is MOVED: this session takes it over and the old session loses it.
      resumed = { ...prev, sessionId: event.session_id, history: [...prev.history, { state: prev.state, at, by: 'user', note: `resumed from session ${prev.sessionId}` }] };
      saveRun(userClose({ ...prev, history: [...prev.history] }, `moved to session ${event.session_id}`));
    }
    saveRun(resumed);
    return addContext(EVENT, `[Ticket2Merge] Resumed ${summary(resumed)}. Invoke the \`${SKILL}\` skill, re-read the report folder, and continue from ${resumed.state}. Run-state CLI: ${cliHint(resumed.sessionId)}`);
  }
  if (isActive(run)) {
    return addContext(EVENT, `[Ticket2Merge] A run is already active (${summary(run)}). Ask the user to finish it or run \`/ticket2merge stop\` before starting another.`);
  }
  const ticket = cls.key ? { key: cls.key, url: cls.url, source: 'jira' } : { text: cls.arg || null, source: cls.arg ? 'text' : null };
  return activate(event, ticket, 'Started by /ticket2merge');
}

function handleActiveRun(run, prompt) {
  if (run.state === 'HUMAN_APPROVAL') {
    if (userApprove(run, prompt)) {
      saveRun(run);
      return addContext(EVENT, `[Ticket2Merge] APPROVED by the user's explicit message ("${prompt.trim()}"). Approval recorded; repo edits are now allowed. State → IMPLEMENTATION. Implement the approved plan; a material deviation needs a new approval.`);
    }
    if (isConditionalApproval(prompt)) {
      return addContext(EVENT, '[Ticket2Merge] This message was NOT recorded as approval: it approves with changes or conditions. Revise the plan with the requested changes, show what changed, and ask again for an explicit approval (approve / approved / go ahead / implement / proceed).');
    }
    return addContext(EVENT, '[Ticket2Merge] Still waiting at HUMAN_APPROVAL — this message is not an explicit approval. Answer it, then ask for approval again; repo files stay read-only.');
  }
  if (reportsCommit(prompt) && ['READY_FOR_MANUAL_COMMIT', 'HUMAN_COMMIT'].includes(run.state)) {
    return addContext(EVENT, '[Ticket2Merge] The user reports a manual commit. Verify it read-only (`git log -1 --stat`, `git status`), acknowledge it, set state HUMAN_COMMIT, and ask for the MR/PR link. Do not commit, push or merge.');
  }
  return null;
}

async function main() {
  const event = await readEvent();
  const prompt = typeof event.prompt === 'string' ? event.prompt : '';
  const { status, run } = loadRunStatus(event.session_id);
  const cls = classifyPrompt(prompt, loadConfig(run?.repoRoots?.[0] || gitTopLevel(event.cwd || process.cwd())));

  if (status === 'invalid') {
    if (cls?.kind === 'command' && cls.action === 'stop') {
      saveRun(closedStub(event.session_id, 'reset by user after the run state became unreadable'));
      return addContext(EVENT, '[Ticket2Merge] The unreadable run state was reset and the run closed by the user. Guards are off for this session; start again with `/ticket2merge <ticket>`.');
    }
    return addContext(EVENT, '[Ticket2Merge] This session\'s run state is unreadable or was modified outside the t2m CLI, so all guarded tools are blocked. Tell the user to send `/ticket2merge stop` to reset it.');
  }

  if (cls?.kind === 'command') return handleCommand(event, cls, run);
  if (isActive(run)) {
    if (cls?.kind === 'ticket' && cls.key !== run.ticket.key) {
      return addContext(EVENT, `[Ticket2Merge] ${cls.key} looks like a new ticket, but a run is already active (${summary(run)}). Ask the user whether to finish it or \`/ticket2merge stop\` first.`);
    }
    return handleActiveRun(run, prompt);
  }
  if (cls?.kind === 'ticket') return activate(event, { key: cls.key, url: cls.url, source: 'jira' }, 'Auto-activated: Jira ticket dropped');
  return null;
}

main().catch(() => process.exit(0)); // never block the user's prompt on a hook fault
