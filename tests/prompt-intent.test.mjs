import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, isExplicitApproval, isConditionalApproval, reportsCommit } from '../scripts/lib/prompt-intent.mjs';

const ticket = (p, cfg) => classifyPrompt(p, cfg);

// --- auto-trigger: a dropped Jira ticket ------------------------------------------

const TRIGGERS = [
  ['PROJ-3502', 'PROJ-3502'],
  ['  proj-3502  ', 'PROJ-3502'],
  ['https://acme.atlassian.net/browse/PROJ-3502', 'PROJ-3502'],
  ['https://acme.atlassian.net/browse/SHOP-12?filter=1', 'SHOP-12'],
  ['https://acme.atlassian.net/jira/software/projects/SHOP/boards/1?selectedIssue=SHOP-99', 'SHOP-99'],
  ['implement PROJ-3502', 'PROJ-3502'],
  ['please work on PROJ-3502', 'PROJ-3502'],
  ['pick up this ticket PROJ-3502', 'PROJ-3502'],
  ['PROJ-3502 Add a CSV export to the invoice list', 'PROJ-3502'],
  ['PROJ-3502\n\nDescription: add export to excel\nAcceptance criteria: ...', 'PROJ-3502'],
  ['t2m PROJ-3502 add a comment box to the lead page', 'PROJ-3502'],
  ['use ticket2merge for CRM-77', 'CRM-77'],
];
for (const [p, key] of TRIGGERS) {
  test(`auto-triggers on ${JSON.stringify(p).slice(0, 60)}`, () => {
    const r = ticket(p);
    assert.equal(r?.kind, 'ticket', JSON.stringify(r));
    assert.equal(r.key, key);
  });
}

const NON_TRIGGERS = [
  'post a comment on PROJ-3502 saying deployed',
  'comment on PROJ-3502',
  'reply to the last comment on PROJ-3502',
  'when was PROJ-3502 created?',
  'what priority is PROJ-3502',
  'who reported PROJ-3502',
  'details for PROJ-3502',
  'jira ticket info PROJ-3502',
  'labels on PROJ-3502',
  'write test cases for PROJ-3502',
  'review MR 4387 for PROJ-3502',
  'write the MR description for PROJ-3502',
  'create a jira ticket like PROJ-3502',
  'weekly report for the project',
  'fix the UTF-8 encoding issue in export',
  'SHA-256 hashing is slow',
  'we follow ISO-9001 here',
  'COVID-19 banner text change',
  'how do I rebase?',
  'what does PROJ-3502 say about exports?',
  'PROJ-3502 PROJ-3503 compare these two',
  '',
];
for (const p of NON_TRIGGERS) {
  test(`does not auto-trigger on ${JSON.stringify(p).slice(0, 60)}`, () => {
    assert.equal(ticket(p), null);
  });
}

test('autoTrigger:false disables drop detection but not the explicit command', () => {
  assert.equal(ticket('PROJ-3502', { autoTrigger: false }), null);
  assert.equal(ticket('/ticket2merge PROJ-3502', { autoTrigger: false })?.kind, 'command');
});

test('projectKeys restricts auto-trigger to known prefixes', () => {
  assert.equal(ticket('ABC-12', { projectKeys: ['PROJ'] }), null);
  assert.equal(ticket('PROJ-12', { projectKeys: ['PROJ'] })?.key, 'PROJ-12');
});

// --- explicit command -------------------------------------------------------------

test('/ticket2merge <ticket> starts a run', () => {
  const r = ticket('/ticket2merge PROJ-3502');
  assert.deepEqual([r.kind, r.action, r.key], ['command', 'start', 'PROJ-3502']);
});
test('/ticket2merge with plain text starts a run without a key', () => {
  const r = ticket('/ticket2merge Add a CSV export to the invoice list');
  assert.deepEqual([r.kind, r.action, r.key], ['command', 'start', null]);
  assert.equal(r.arg, 'Add a CSV export to the invoice list');
});
test('namespaced /ticket2merge:ticket2merge works', () => {
  assert.equal(ticket('/ticket2merge:ticket2merge PROJ-1')?.key, 'PROJ-1');
});
for (const action of ['stop', 'status', 'resume']) {
  test(`/ticket2merge ${action}`, () => {
    const r = ticket(`/ticket2merge ${action} PROJ-1`);
    assert.equal(r.action, action);
  });
}

// --- approval ---------------------------------------------------------------------

for (const p of ['approve', 'Approved', 'approved.', 'go ahead', 'Go ahead!', 'implement', 'proceed', 'yes, proceed', 'ok approved', 'approved, go ahead']) {
  test(`explicit approval: ${p}`, () => assert.equal(isExplicitApproval(p), true));
}
for (const p of [
  'looks fine I guess', 'sounds good', 'ok', 'yes', 'lgtm', 'maybe', 'fine',
  "don't proceed", 'do not implement yet', 'approved but change the naming',
  'proceed with option B instead', 'can you implement it differently?', '',
]) {
  test(`not approval: ${JSON.stringify(p)}`, () => assert.equal(isExplicitApproval(p), false));
}
test('conditional approval is recognised so the plan gets revised', () => {
  assert.equal(isConditionalApproval('approved but change the naming'), true);
  assert.equal(isConditionalApproval('Perfect approved but also add X'), true);
  assert.equal(isConditionalApproval('approved'), false);
  assert.equal(isConditionalApproval('looks fine'), false);
});

// --- commit report ----------------------------------------------------------------

for (const p of ['I committed the changes', 'committed', 'done, committed and pushed', 'I have committed it']) {
  test(`commit report: ${p}`, () => assert.equal(reportsCommit(p), true));
}
for (const p of ['commit it for me', 'should I commit?', 'not committed yet']) {
  test(`not a commit report: ${p}`, () => assert.equal(reportsCommit(p), false));
}
