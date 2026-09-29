#!/usr/bin/env node
// SessionStart — after resume or compaction, remind Claude that a run is active and where it stands.

import { addContext, cliHint, readEvent } from '../lib/hook-io.mjs';
import { isActive, loadRun } from '../lib/state.mjs';

async function main() {
  const event = await readEvent();
  const run = loadRun(event.session_id);
  if (!isActive(run)) return;
  const ticket = run.ticket.key || run.ticket.text || 'untitled ticket';
  addContext('SessionStart', [
    `[Ticket2Merge] Active run for ${ticket}: state ${run.state}, approved ${run.approved ? 'yes' : 'no'}.`,
    'The git guard and approval gate are active. Invoke the `ticket2merge:ticket2merge` skill and continue from the current state' +
      (run.reportDir ? `, re-reading ${run.reportDir} first.` : '.'),
    `Run-state CLI: ${cliHint(run.sessionId)}`,
  ].join('\n'));
}

main().catch(() => process.exit(0));
