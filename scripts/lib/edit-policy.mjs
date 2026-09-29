// Gate 1 for file tools: nothing inside the project repos changes before explicit approval.
// Paths are resolved through symlinks, and repo membership is checked BEFORE the report-folder
// exemption, so no report-folder value can open the repo.

import os from 'node:os';
import path from 'node:path';
import { gitConfigPaths, inDotGit, inside, overlaps, realResolve } from './paths.mjs';

const allow = () => ({ allow: true });
const deny = (reason) => ({ allow: false, reason: `Ticket2Merge: ${reason}` });

// Paths that are never written by Ticket2Merge, approved or not.
export function protectedPathReason(abs, { t2mHome, home, env = process.env } = {}) {
  const homeDir = home || env.HOME || os.homedir();
  if (inDotGit(abs)) return 'files inside .git/ are never edited — git state belongs to the user.';
  if (gitConfigPaths(homeDir, env).some((c) => overlaps(abs, c))) return 'git configuration is never edited by Ticket2Merge.';
  if (t2mHome && inside(abs, realResolve(path.join(t2mHome, 'runs')))) {
    return 'run state may only be changed through the t2m CLI (and approval only by the user).';
  }
  return null;
}

export function checkEdit(run, filePath, { t2mHome, cwd, home, env = process.env, readOnlyAgent = false } = {}) {
  if (!filePath) return allow();
  const roots = (run.repoRoots || []).map(realResolve);
  const base = cwd || roots[0] || process.cwd();
  const abs = realResolve(path.isAbsolute(filePath) ? filePath : path.resolve(base, filePath));
  const homeDir = home || env.HOME || os.homedir();

  const locked = protectedPathReason(abs, { t2mHome, home: homeDir, env });
  if (locked) return deny(locked);
  const inRepo = roots.some((r) => inside(abs, r));
  if (readOnlyAgent && inRepo) return deny('the t2m-adversary auditor is read-only — report the finding instead of changing code.');
  if (run.approved) return allow();
  if (inRepo) {
    return deny(
      'Gate 1 — the implementation plan is not approved yet. Present the plan and wait for the ' +
      "user's explicit approval (approve / approved / go ahead / implement / proceed). " +
      'Until then only the report folder may be written.',
    );
  }
  const reportDir = run.reportDir && realResolve(run.reportDir);
  if (reportDir && inside(abs, reportDir) && !roots.some((r) => overlaps(reportDir, r))) return allow();
  if (roots.length === 0) {
    return deny(
      'no project repo is recorded for this run yet, so only the report folder is writable. ' +
      'Record the repo with `t2m set --repo <path>` (before approval).',
    );
  }
  return allow();
}
