// MCP tools.
//  * git-capable servers (GitHub, GitLab, git, Bitbucket, Gitea): read-only tools only, at every
//    stage — no commits, pushes, merges, reviews, approvals, branches, PR/MR creation;
//  * any tool whose arguments name .git/, git config or Ticket2Merge run state: denied, always;
//  * before approval (and always for the read-only auditor), a non-read tool whose arguments
//    name a path inside a project repo is denied — Gate 1 for filesystem-style servers.

import os from 'node:os';
import path from 'node:path';
import { protectedPathReason } from './edit-policy.mjs';
import { inside, realResolve } from './paths.mjs';

const GIT_SERVER = /(^|[^a-z0-9])(git|github|gitlab|bitbucket|gitea|forgejo|gogs)([^a-z0-9]|$)/i;
const GIT_READ_ONLY = /^(git_)?(get|list|search|read|view|show|fetch|describe|log|diff|status|blame|compare)(_|$)/;
const READ_ONLY_TOOL = /^(git_)?(get|list|search|read|view|show|fetch|describe|log|diff|status|find|stat|info|query|directory_tree|list_allowed)(_|$)|(^|_)file_upload$/;

function pathStrings(value, out = [], depth = 0) {
  if (depth > 6 || out.length > 200) return out;
  if (typeof value === 'string') {
    const v = value.trim();
    if (/^file:\/\//.test(v)) out.push(decodeURIComponent(v.replace(/^file:\/\//, '')));
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /\s/.test(v) || v.length > 4096) { /* URL or prose */ }
    else if (path.isAbsolute(v) || /^(\.{1,2}\/|~\/)/.test(v) || (v.includes('/') && !v.startsWith('-'))) out.push(v);
  } else if (Array.isArray(value)) {
    value.forEach((v) => pathStrings(v, out, depth + 1));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => pathStrings(v, out, depth + 1));
  }
  return out;
}

const deny = (reason) => ({ allow: false, reason });

export function checkMcp(toolName, input = {}, { run = null, cwd = process.cwd(), readOnlyAgent = false, t2mHome, home } = {}) {
  const parts = String(toolName || '').split('__');
  if (parts[0] !== 'mcp' || parts.length < 3) return { allow: true };
  const server = parts[1];
  const tool = parts.slice(2).join('__').toLowerCase();

  const gitCapable = GIT_SERVER.test(server) || tool.startsWith('git_');
  if (gitCapable && !GIT_READ_ONLY.test(tool)) {
    return deny(
      `Ticket2Merge blocked MCP tool \`${toolName}\`: on a git-capable server only read-only tools are allowed. ` +
      'Ticket2Merge never commits, pushes, merges, reviews, approves or opens PRs/MRs. Ask the user to do it manually.',
    );
  }

  const homeDir = home || process.env.HOME || os.homedir();
  const resolved = pathStrings(input).map((p) => realResolve(path.resolve(cwd, p.replace(/^~(?=\/)/, homeDir))));
  for (const abs of resolved) {
    const locked = protectedPathReason(abs, { t2mHome, home: homeDir });
    if (locked && !READ_ONLY_TOOL.test(tool)) return deny(`Ticket2Merge: \`${toolName}\` — ${locked}`);
  }

  if (run && (readOnlyAgent || !run.approved) && !READ_ONLY_TOOL.test(tool)) {
    const roots = (run.repoRoots || []).map(realResolve);
    const hit = resolved.find((abs) => roots.some((r) => inside(abs, r)));
    if (hit) {
      return deny(readOnlyAgent
        ? `Ticket2Merge: the t2m-adversary auditor is read-only — \`${toolName}\` would act on ${hit}.`
        : `Ticket2Merge: Gate 1 — \`${toolName}\` acts on ${hit} inside the repo, and the plan is not approved yet.`);
    }
  }
  return { allow: true };
}
