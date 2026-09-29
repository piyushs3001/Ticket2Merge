// Shared stdin/stdout plumbing for hook entry points.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = () =>
  process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

export async function readEvent() {
  const raw = await readStdin();
  return raw.trim() ? JSON.parse(raw) : {};
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export const denyTool = (reason) =>
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

export const addContext = (hookEventName, additionalContext) =>
  emit({ hookSpecificOutput: { hookEventName, additionalContext } });

// Read-only lookup of the repo that contains cwd; null outside a git repo.
export function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

export const cliHint = (runId) => `node "${path.join(pluginRoot(), 'scripts', 't2m.mjs')}" <command> --run ${runId}`;
