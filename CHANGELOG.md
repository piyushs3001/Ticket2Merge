# Changelog

## 1.4.0 — 2026-10-05

- **Tests are the default for every ticket (rule 6):** positive and negative test cases are
  written before the code, extended after the audits, and run after the work and after every
  bug fix — without asking the user. Small ticket → fewer tests, never zero; `test-cases` is
  used whatever the ticket size.
- **CLI gate:** `READY_FOR_MANUAL_COMMIT` now also needs `TEST_CASE_GENERATION` and
  `UNIT_INTEGRATION_TESTING` after the latest approval, unit/integration and regression runs
  after the last code change (`IMPLEMENTATION` / `BUG_FIX_LOOP`), and a `## Test cases`
  section in `report.md` with both positive and negative cases.
- **Broken test runner:** durable tests are still written in the repo; the runner fix becomes a
  plan item (or a scoped deviation) instead of a silent `NOT RUN`. A stand-in check no longer
  ticks "Unit tests executed"; a user-accepted run reads `READY — unit tests NOT RUN (accepted by user)`.

## 1.3.0 — 2026-09-29

- **Brief chat style (default):** every message is a one-line status + gist, ≤4 bullets (~60 words), then the next
  step; plain words; questions numbered with a recommended answer (one-click choices via
  AskUserQuestion). Full plan and reports go to `report.md`. `"style": "detailed"` restores the
  full templates in chat.

## 1.2.1 — 2026-09-29

- `t2m ref <topic>` prints a stage reference, so the skill needs no file-read permission on the
  plugin folder (one "always allow" for `t2m.mjs` covers the whole run).
- README: local-folder installs run in place; permissions table; headless `--allowedTools` example.
- Tests: 54 everyday developer commands pinned as a zero-false-positive regression suite.

## 1.2.0 — 2026-09-29

Second review round (classifier misclassifications in both directions).

- **Fixed (critical):** globs/braces in program names and write targets (`gi? push`, `rm -rf .gi*`);
  `/dev/..` path escapes; shells/interpreters reading code from a pipe or herestring; git MCP tools
  outside a write-verb list — git-capable servers are now read-tools-only.
- **Fixed:** wrapper options with values (`sudo -u`, `timeout -s`, `env -S`, …); commands carried in
  `ssh`, `docker exec`, `trap`, `su -c`, `script -c`, `watch`, `find -exec sh -c`; bundled interpreter
  flags (`-pe`, `-Bc`), array-style spawns, `awk system()`; `gh api` endpoints/fields/GraphQL
  mutations, `glab mr accept`, PR/MR creation and checkout; `find -delete`, `sed -Ei`, `sort -o`,
  `sponge`, compressors; executables run by path; `cd -`/`cd -P`, `export`, loop variables;
  `>&file`; arithmetic and ANSI-C quoting; heredoc bodies with quotes; aliases are expanded.
- **Fixed (false positives):** input redirects and heredoc delimiters were treated as writes;
  `npm --version`, `awk`, inline read-only code, `for` loops, `find -exec grep`, common read-only
  CLIs; read-only git `stash list`, `describe`, `tag -l`, `config --get`, `reflog`, `show-ref`, … allowed.
- **Changed:** before approval the shell is default-deny with the working directory in the repo
  (only known read-only programs); MCP arguments are resolved (relative, `~`, `file://`) and
  protected paths are denied for every tool, at every stage.

## 1.1.0 — 2026-09-29

Security hardening after an adversarial review of 1.0.0.

- **Fixed (critical):** a report folder containing the repo (e.g. `/`) opened Gate 1. The CLI
  now refuses any report folder that overlaps a repo, and the edit gate checks repo membership first.
- **Fixed (critical):** run-state protection matched literal paths only; writes via `cd`,
  relative paths, `~`, variables or symlinks now resolve and are blocked.
- **Fixed (critical):** an unreadable or malformed run file turned every guard off. It now
  fails closed; `/ticket2merge stop` resets it. Unreadable hook events also fail closed.
- **Fixed:** git reached as `git-<cmd>`, `git-core/…`, `busybox git`, variable program names,
  aliases, or with injected `GIT_*` environment; `.git/` writes after `cd`; writes to git config;
  tools that commit (`npm version`, `lerna`, `release-it`, …).
- **Fixed:** `/ticket2merge resume` of a closed run kept its approval; an active run is now
  moved (not copied) to the new session.
- **Changed:** before approval the repo is read-only for the shell too (default-deny for
  non-read-only tools on repo paths; installers, generators, build and test runners blocked),
  including when no repo is recorded yet. Shell, interpreter and `npm run` scripts are read before they run.
- **Changed:** file-writing MCP tools fall under Gate 1; the `t2m-adversary` subagent is
  mechanically read-only; PowerShell is guarded like Bash.
- **Changed:** `READY_FOR_MANUAL_COMMIT` requires both audits, regression testing and final
  verification after the latest approval.
- **Changed:** activation context carries the effective config; `t2m <KEY>` ignores `projectKeys`.
- Docs: client identifiers removed from examples and tests; README claims aligned with the code.

## 1.0.0 — 2026-09-29

- Orchestrator skill `ticket2merge` with the full ticket-to-MR state machine and per-stage references.
- Auto-start when a Jira key or browse URL is dropped; `/ticket2merge start|status|stop|resume`.
- Gate 1: repo edits (file tools and shell writes) blocked until the user's explicit approval,
  captured by the `UserPromptSubmit` hook.
- Git guard: read-only git allowlist with chained/nested/wrapped/alias/library/API/MCP bypass coverage.
- `t2m-adversary` read-only adversarial auditor subagent.
- Composition with optional companion skills, with native fallbacks.
