#!/usr/bin/env node
// Ticket2Merge run-state CLI — the only sanctioned way for Claude to change run state.
// There is deliberately no command to approve or close a run: only the user's own
// message can do that (recorded by the UserPromptSubmit hook).
//
//   t2m status                          --run <id>
//   t2m state <STATE> [--note "..."]    --run <id>
//   t2m set [--report-dir <dir>] [--repo <dir>]... [--title "..."] [--ticket-key KEY]  --run <id>
//   t2m states
//   t2m ref [topic]      print a stage reference (no --run needed)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlaps, realResolve } from './lib/paths.mjs';
import { STATES, isActive, loadRunStatus, modelSetState, saveRun, t2mHome } from './lib/state.mjs';

function parseArgs(argv) {
  const positional = [];
  const opts = { repo: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const value = argv[i + 1];
    i++;
    if (key === 'repo') opts.repo.push(value);
    else opts[key] = value;
  }
  return { positional, opts };
}

const fail = (msg) => {
  process.stderr.write(`t2m: ${msg}\n`);
  process.exit(1);
};
const print = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);

function view(run) {
  const { sessionId, ticket, state, approved, approval, repoRoots, reportDir, updatedAt } = run;
  return { runId: sessionId, ticket, state, approved, approval, repoRoots, reportDir, updatedAt };
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [command, arg] = positional;
  if (command === 'states') return print(STATES);
  if (command === 'ref') {
    // References are printed through the CLI so the skill needs no Read permission on the plugin folder.
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ticket2merge', 'references');
    const topics = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    if (!arg) return process.stdout.write(`${topics.join('\n')}\n`);
    if (!topics.includes(arg)) fail(`unknown reference "${arg}" — one of: ${topics.join(', ')}`);
    return process.stdout.write(readFileSync(path.join(dir, `${arg}.md`), 'utf8'));
  }
  if (!opts.run) fail('--run <id> is required (the run id is given in the Ticket2Merge context message)');
  const { status, run } = loadRunStatus(opts.run);
  if (status === 'invalid') fail('the run state is unreadable — all guarded tools are blocked; ask the user to send `/ticket2merge stop`');
  if (!isActive(run)) fail(`no active run with id ${opts.run}`);

  if (command === 'status') return print(view(run));

  if (command === 'state') {
    if (!arg) fail(`usage: t2m state <STATE> --run <id>\nstates: ${STATES.join(', ')}`);
    try {
      modelSetState(run, arg, opts.note);
    } catch (err) {
      fail(err.message);
    }
    saveRun(run);
    return print(view(run));
  }

  if (command === 'set') {
    if (opts.repo.length) {
      if (run.approved) fail('repos can only be added before approval — a new repo means a new plan');
      for (const r of opts.repo) {
        const abs = realResolve(r);
        let isDir = false;
        try { isDir = statSync(abs).isDirectory(); } catch { /* missing */ }
        if (!isDir) fail(`repo path is not a directory: ${abs}`);
        if (run.reportDir && overlaps(realResolve(run.reportDir), abs)) {
          fail('that repo overlaps the report folder — the report folder must be entirely outside every repo');
        }
        if (!run.repoRoots.map(realResolve).includes(abs)) run.repoRoots.push(abs);
      }
    }
    if (opts['report-dir']) {
      const dir = realResolve(opts['report-dir']);
      if (run.repoRoots.some((r) => overlaps(dir, realResolve(r)))) {
        fail('the report folder must be entirely outside every project repo — it may neither be inside one nor contain one');
      }
      if (overlaps(dir, realResolve(path.join(t2mHome(), 'runs')))) fail('the report folder may not overlap Ticket2Merge run state');
      run.reportDir = dir;
    }
    if (opts.title) run.ticket.title = opts.title;
    if (opts['ticket-key']) {
      if (run.approved) fail('the ticket cannot change after approval');
      run.ticket.key = opts['ticket-key'].toUpperCase();
    }
    saveRun(run);
    return print(view(run));
  }

  fail(`unknown command: ${command ?? '(none)'} — use status | state | set | states`);
}

main();
