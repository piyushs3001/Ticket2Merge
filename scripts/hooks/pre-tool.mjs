#!/usr/bin/env node
// PreToolUse — Bash/PowerShell, file edits and MCP tools. No-op unless this session has a run.
// Fails CLOSED: a crash, an unreadable event or an untrustworthy run file blocks the call
// instead of silently turning the guard off.

import os from 'node:os';
import { checkBash } from '../lib/bash-policy.mjs';
import { checkEdit } from '../lib/edit-policy.mjs';
import { denyTool, pluginRoot, readEvent } from '../lib/hook-io.mjs';
import { checkMcp } from '../lib/mcp-policy.mjs';
import { checkBashRepoWrites } from '../lib/repo-write-policy.mjs';
import { isActive, listRuns, loadRunStatus, t2mHome } from '../lib/state.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const ADVERSARY = /(^|:)t2m-adversary$/;

function decide(event, run) {
  const tool = event.tool_name || '';
  const input = event.tool_input || {};
  const cwd = event.cwd || process.cwd();
  const readOnlyAgent = ADVERSARY.test(event.agent_type || '');
  const base = { t2mHome: t2mHome(), cwd, home: process.env.HOME || os.homedir(), env: process.env };

  if (SHELL_TOOLS.has(tool)) {
    if (typeof input.command !== 'string') throw new Error(`${tool} command is not a string`);
    const git = checkBash(input.command, { ...base, pluginRoot: pluginRoot() });
    if (!git.allow || (run.approved && !readOnlyAgent)) return git;
    const gate = checkBashRepoWrites(input.command, {
      repoRoots: run.repoRoots,
      cwd,
      safeDirs: readOnlyAgent ? [] : [run.reportDir],
      home: base.home,
      env: process.env,
    });
    if (!gate.allow && readOnlyAgent) {
      return { allow: false, reason: `Ticket2Merge: the t2m-adversary auditor is read-only — ${gate.reason.replace(/^Ticket2Merge: Gate 1 — /, '')}` };
    }
    return gate;
  }
  if (EDIT_TOOLS.has(tool)) return checkEdit(run, input.file_path || input.notebook_path, { ...base, readOnlyAgent });
  if (tool.startsWith('mcp__')) return checkMcp(tool, input, { run, cwd, readOnlyAgent, t2mHome: base.t2mHome, home: base.home });
  return { allow: true };
}

const INVALID_STATE =
  'Ticket2Merge: this session\'s run state is unreadable or has been modified outside the t2m CLI, ' +
  'so every guarded tool is blocked. Tell the user; they can reset it with `/ticket2merge stop`.';

async function main() {
  let event;
  try {
    event = await readEvent();
  } catch {
    // Cannot tell which session this is: stay closed if any run anywhere is active or damaged.
    if (listRuns().some(({ status, run }) => status === 'invalid' || isActive(run))) {
      denyTool('Ticket2Merge guard received an unreadable event while a run is active; the call was blocked to stay safe.');
    }
    return;
  }
  const { status, run } = loadRunStatus(event.session_id);
  if (status === 'invalid') return denyTool(INVALID_STATE);
  if (!isActive(run)) return;
  try {
    const verdict = decide(event, run);
    if (!verdict.allow) denyTool(verdict.reason);
  } catch (err) {
    denyTool(`Ticket2Merge guard error (${err.message}); the call was blocked to stay safe. Retry with a simpler command.`);
  }
}

main();
