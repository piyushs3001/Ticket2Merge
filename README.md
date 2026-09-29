# Ticket2Merge

A Claude Code plugin that takes a development ticket all the way to a merge-request
description, with **two human gates** and **hook-enforced git safety**.

```
Ticket → Understand → Investigate → Plan → ⏸ YOUR APPROVAL → Implement → Positive audit
→ Negative (adversarial) audit → Bug-fix loop → Test cases → Unit/Integration → Playwright
→ Regression → Final verification → ⏸ YOU COMMIT → MR link → MR description
```

- **Drop a Jira ticket and it starts.** Paste `PROJ-3502` or a Jira browse URL. No command needed.
- **Nothing is written to your repo until you type `approve`.** The approval is captured from
  your own message by a hook. Claude cannot record it for you.
- **Claude never changes git state.** No add, commit, push, stash, checkout, branch, merge or
  rebase, and no workarounds through scripts, APIs or MCP tools. You commit; Claude hands you
  the commit message.
- **It tries to break its own work.** A separate adversarial auditor subagent hunts for edge
  cases, security holes, failure modes and regressions before anything is called ready.
- **Short, plain-language chat.** Each message is a one-line gist, a few bullets and the next
  step. Questions come with a recommended answer. The full detail goes in the report file.
  (`"style": "detailed"` to change it.)
- **It runs the tests, it doesn't just write them.** Unit, integration and Playwright, with
  real runner output. A test that didn't run is reported as `NOT RUN`, never as passed.

---

## Contents

- [Install](#install)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How auto-start works](#how-auto-start-works)
- [The two gates](#the-two-gates)
- [Git safety](#git-safety)
- [Commands](#commands)
- [Configuration](#configuration)
- [Companion skills (optional)](#companion-skills-optional)
- [Where files go](#where-files-go)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)
- [Development](#development)
- [Uninstall](#uninstall)

---

## Install

**From a Git host** (after the repo has been pushed there):

```bash
/plugin marketplace add <owner>/<repo>          # GitHub shorthand, or a full git URL
/plugin install ticket2merge@ticket2merge-marketplace
```

**From a local checkout:**

```bash
claude plugin marketplace add /path/to/Ticket2Merge
claude plugin install ticket2merge@ticket2merge-marketplace
```

Restart Claude Code (or start a new session). `/plugin` → *Installed* should list
**ticket2merge**.

To pick up a newer version later (Git-hosted install):

```bash
claude plugin marketplace update ticket2merge-marketplace
claude plugin update ticket2merge@ticket2merge-marketplace
```

A **local-folder** install runs the plugin in place from that folder, so edits there take
effect from the next session without an update.

### Permissions you'll be asked for

Plugins can't ship permission rules, so in the default permission mode Claude Code asks once for:

| Prompt | Why | Suggested answer |
|---|---|---|
| Bash: `node …/ticket2merge/scripts/t2m.mjs …` | run-state changes and loading the stage references | *Yes, and don't ask again* for that command |
| Atlassian / GitLab / GitHub tools | reading the ticket and MR | allow for the session |

The guard hooks need no permission: they run in the harness and block even in auto mode.
In headless `claude -p` runs, pass the tools explicitly, e.g.
`--allowedTools "Bash(node *t2m.mjs*)" "mcp__claude_ai_Atlassian__getJiraIssue"`.

## Requirements

| Need | Why | Required? |
|---|---|---|
| Claude Code 2.x | plugin + hooks support | **yes** |
| **Node.js ≥ 18** on `PATH` | the guard hooks are Node scripts (no npm dependencies) | **yes** |
| Atlassian connector / MCP (`claude.ai Atlassian` or `atlassian`) | reading Jira tickets | for Jira tickets |
| Playwright MCP (`claude mcp add playwright npx @playwright/mcp@latest`) **or** `@playwright/test` in the project | browser testing | for web UI tickets |
| `GITLAB_TOKEN` (read-only `read_api` scope) | GitLab issues and MR checks | for GitLab |
| `gh` CLI, authenticated | GitHub issues and PRs | for GitHub |

Missing optional pieces are reported and worked around. They never fail silently, and
results are never faked.

## Quick start

1. `cd` into the project repo and start Claude Code.
2. Paste the ticket:
   ```
   PROJ-3502
   ```
3. Ticket2Merge reads the ticket, investigates the repo, lists blockers, assumptions and
   questions, and presents a plan with every acceptance criterion mapped to a change and a test.
4. Reply **`approve`**. Anything vaguer ("looks fine", "sounds good") is not taken as approval.
5. It implements, audits (positive + adversarial), fixes what it finds, runs all relevant
   tests including Playwright, checks for regressions, and ends with:
   ```
   Git state was NOT modified. No files were staged. No commit was created. …
   Suggested commit message: …
   READY FOR MANUAL COMMIT.
   ```
6. You commit and push. Tell it `I committed`, then paste the MR/PR link.
7. It self-checks the MR and writes the MR description. Posting it anywhere requires your yes.
8. `/ticket2merge stop` closes the run.

## How auto-start works

A `UserPromptSubmit` hook looks at each message you send.

| You type | What happens |
|---|---|
| `PROJ-3502` | ✅ Starts a run |
| `https://acme.atlassian.net/browse/PROJ-3502` | ✅ Starts a run |
| `implement PROJ-3502` · `please work on PROJ-3502` · `pick up this ticket PROJ-3502` | ✅ Starts a run |
| `PROJ-3502 Add a CSV export to the invoice list` (key + title) | ✅ Starts a run |
| `PROJ-3502` followed by the pasted ticket body | ✅ Starts a run |
| `t2m PROJ-3502 …` or `use ticket2merge for PROJ-3502` | ✅ Starts a run even if `projectKeys` doesn't list the prefix (not when `autoTrigger` is `false`) |
| `/ticket2merge Add a CSV export to the invoice list` | ✅ Starts a run from plain text |
| `comment on PROJ-3502` · `when was PROJ-3502 created?` · `details for PROJ-3502` | ❌ Left to your other skills |
| `write test cases for PROJ-3502` · `review MR 4387` · `MR description for …` | ❌ Left to your other skills |
| `fix the UTF-8 issue` · `SHA-256` · `ISO-9001` | ❌ Not ticket keys |
| Two different keys in one message | ❌ Ambiguous, not started |

Auto-start never switches tickets in the middle of a run. A new key while a run is active
prompts a question instead.

To turn auto-start off, or to limit it to your Jira projects, see
[Configuration](#configuration).

## The two gates

**Gate 1: plan approval.** Until you approve, the project repo is **read-only**:

- File tools (Edit/Write/NotebookEdit) and file-writing MCP tools can't change repo files.
- The shell is **default-deny inside the repo**. It can read and inspect (`cat`, `grep`, `rg`,
  `git log`, `jq`, `awk` without output redirection, `npm ls`, `composer show`, `php -l`,
  `php artisan route:list`, `eslint` without `--fix`, `curl`/`gh` reads, …). Anything else run
  with the working directory in the repo waits for approval: installers, generators, migrations,
  database clients, build and test runners, formatters in write mode, repo scripts and unknown
  tools. Writes into the repo are blocked from anywhere: redirects, `sed -i`, `rm`, `mv`, `cp`
  into it, `curl -o`, archive extraction, `patch`, and inline code that writes files. So the
  baseline test run happens right after you approve.
- Paths are resolved through `cd`, `~`, variables and symlinks.
- Only the run's report folder is writable, and it must be entirely outside every repo.

Approval counts only when your message is made up only of approval words: `approve` ·
`approved` · `go ahead` · `implement` · `proceed`. They can be combined (`approved, go ahead`)
and optionally prefixed with `yes`, `ok` or `okay`. `approved, but
rename X` is treated as a change request: the plan is revised and you're asked again. If the
implementation later needs a material change to the plan, the approval is revoked and it
asks again.

**Gate 2: commit.** Ticket2Merge stops at `READY FOR MANUAL COMMIT` with a suggested commit
message following your repo's convention. You run the git commands.

## Git safety

While a run is active, every Bash command, file edit and MCP call is checked by
`scripts/hooks/pre-tool.mjs` **before** it runs. Blocks hold even in auto mode.

**Allowed (read-only):** `status`, `diff`, `diff --cached`, `log`, `show`, `rev-parse`,
`ls-files`, `blame`, `grep`, `merge-base`, `ls-tree`, `cat-file -p/-t/-s/-e`,
`branch --show-current/--list/-a/-r/-v`, `remote -v`, `remote get-url`, `describe`, `show-ref`,
`rev-list`, `for-each-ref`, `shortlog`, `reflog` (read), `stash list/show`, `tag` (list only),
`config --get/--list` (read only), `ls-remote`, `check-ignore`, `name-rev`.

**Blocked:** every other git subcommand, plus the ways around it:

| Bypass attempt | Example | Result |
|---|---|---|
| Chained or piped | `git status && git add .` · `git diff; git commit` | ❌ |
| Nested | `$(git push)` · `` `git push` `` · `bash -c "git commit"` · `eval …` · heredoc to `bash` | ❌ |
| Wrapped | `sudo`, `env`, `command`, `timeout`, `nohup`, `xargs git add`, `find -exec git add` | ❌ |
| Config injection | `git -c alias.st=commit st` · `git -c core.hooksPath=…` | ❌ |
| Unknown alias | `git st` | ❌ |
| Libraries / inline code | `node -e "…execSync('git commit')"` · GitPython · simple-git | ❌ |
| Editing `.git/` | `echo > .git/HEAD` · `rm -rf .git` · Edit on `.git/config` | ❌ |
| Forge CLIs | `gh pr merge` · `gh pr review --approve` · `glab mr merge/approve` | ❌ |
| REST APIs | GitLab `/merge_requests/:id/merge\|approve`, `/repository/commits\|branches\|files`; GitHub `/pulls/:n/merge`, `/contents`, `/git/refs` | ❌ |
| Git-capable MCP tools | anything but read tools on a GitHub/GitLab/git server: `mcp__git__git_add` · `create_pull_request` · `merge_merge_request` · review/approve tools | ❌ |
| Nested agent | `claude -p "commit it"` | ❌ |
| Other spellings of git | `git-commit` · `/usr/lib/git-core/git-commit` · `busybox git` · `x=git; $x commit` · `alias g=git` | ❌ |
| Injected git environment | `GIT_CONFIG_*=…` · `GIT_EXTERNAL_DIFF=…` · `GIT_PAGER=…` | ❌ |
| Git configuration | writing `~/.gitconfig`, `~/.config/git/` | ❌ |
| Tools that commit | `npm version` · `lerna version` · `release-it` · `semantic-release` | ❌ |
| Scripts | `bash x.sh` · `./x.sh` · `source x.sh` · `node x.js` · `npm run release` when what they run is blocked. A script written and run in one command is blocked outright | ❌ |
| Code on stdin | `echo 'git push' \| bash` · `bash <<< …` · `printf … \| node` (heredocs and `< file` are read and checked) | ❌ |
| Globs & braces | `gi? push` · `{git,commit}` · `rm -rf .gi*` · `rm ~/.claude/ticket2merge/*` | ❌ |
| Commands inside commands | `ssh host git push` · `docker compose exec app git commit` · `trap '…' EXIT` · `su -c` · `watch` · `find -exec sh -c` · `sudo -u x` / `timeout -s` / `env -S` wrappers | ❌ |
| PR/MR state | `gh pr create/checkout/update-branch` · `glab mr create/checkout/accept` · GraphQL merge/approve mutations · `gh release create` | ❌ |
| Tampering with run state | writing `~/.claude/ticket2merge/runs/*` by any path (`cd`, relative, `~`, variables, symlinks) | ❌ |

**Fail closed.** If the run file is unreadable or was changed outside the CLI, if the guard
crashes, or if a hook event can't be read, the call is **blocked**, not waved through.
`/ticket2merge stop` resets a damaged run.

When something is blocked, Ticket2Merge explains what's needed and gives you the exact
command to run yourself. Tip: prefix it with `!` to run it in the session.

Outside an active run the plugin stays completely out of your way.

## Commands

| Command | Does |
|---|---|
| `/ticket2merge <KEY \| URL \| text>` | Start a run explicitly (works even with auto-start off; `/ticket2merge start …` is the same) |
| `/ticket2merge status` | Show the current run's ticket, state and approval |
| `/ticket2merge stop` | Close the run; guards switch off for this session. Also resets a damaged run file |
| `/ticket2merge resume <KEY>` | Continue that ticket in this session. An active run is moved here (the old session loses it, approval kept). A closed run restarts from the beginning, without approval |

## Configuration

Optional. `<repo>/.ticket2merge.json` overrides `~/.claude/ticket2merge/config.json`. The merged values are handed to Claude when a run starts:

```json
{
  "autoTrigger": true,
  "style": "brief",
  "projectKeys": ["PROJ", "SHOP"],
  "reportRoot": "~/Desktop/Projects/MyProject/claude-prompts",
  "jiraSite": "acme.atlassian.net",
  "gitlabUrl": "https://gitlab.acme.dev"
}
```

| Key | Default | Meaning |
|---|---|---|
| `autoTrigger` | `true` | `false` = only `/ticket2merge …` starts a run |
| `style` | `"brief"` | Chat output. `brief`: short messages in plain words (gist, a few bullets, next step), questions with a recommended answer, full detail in the report file. `detailed`: the full plan and reports in chat |
| `projectKeys` | `[]` (any) | Only auto-start for these Jira project prefixes. Recommended: it removes false matches |
| `reportRoot` | *(see below)* | Where run reports are written |
| `jiraSite` | discovered | Jira cloud host for the Atlassian MCP |
| `gitlabUrl` | the issue URL's host, else `git remote` | Self-hosted GitLab base URL for issue and MR API calls |

Environment: `T2M_HOME` moves the state/report home (default `~/.claude/ticket2merge`).

## Companion skills (optional)

Ticket2Merge **reuses** these if they are installed and does the work itself if they aren't,
saying which in the report:

| Skill | Used for |
|---|---|
| `test-cases` | Test-case specs, RED proof, runs, retests, regression sets, browser pass |
| `mr-description` | The GitLab MR description |
| `review-gitlab-mr` | Self-check of the pushed GitLab MR; its checklists feed the adversarial audit |
| `jira-ticket-info` | Ticket metadata |
| `jira-comment` | Optional summary comment (only when you ask) |
| `prompt-check` | Signal for thin, free-text tickets |
| `create-jira-ticket` | Logging an out-of-scope bug it found (only if you want) |
| `rlm` | Very large repos |
| [superpowers](https://github.com/obra/superpowers) | TDD, systematic debugging, verification-before-completion |
| built-ins `code-review`, `security-review`, `run` | Diff review, security pass, starting the app |

Skills that create commits, branches or worktrees (superpowers' `writing-plans`,
`executing-plans`, `subagent-driven-development`, `finishing-a-development-branch`,
`using-git-worktrees`) are deliberately **not** used inside a run.

## Where files go

| What | Where |
|---|---|
| Run report (ticket, plan, audits, bugs, test results, final report) | Your CLAUDE.md docs convention if you have one → else `reportRoot` → else `~/.claude/ticket2merge/reports/<project>/<date>-<ticket>/report.md`. Always **outside** the repo |
| Run state (hooks only) | `~/.claude/ticket2merge/runs/<session>.json` |
| Tests | In your repo, in its existing test structure. They're part of the change you commit |
| `docs/testcases/` | Only if you use the `test-cases` companion skill (its convention) |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pasting a key doesn't start anything | Is the plugin enabled (`/plugin`)? Is `node --version` ≥ 18 in the shell Claude runs from? Does `projectKeys` include the prefix? Force it with `t2m <KEY>` (ignores `projectKeys`) or `/ticket2merge <KEY>` (works even with `autoTrigger: false`) |
| It started when you just wanted ticket info | Phrase it as a question or field request ("details for PROJ-1"), set `projectKeys`, or set `autoTrigger: false`. `/ticket2merge stop` ends the run |
| Edits are blocked with "Gate 1" | Intended: the plan isn't approved. Reply `approve` |
| A harmless command is blocked | The guard errs on the safe side (e.g. the word `git` followed by a filename). Rephrase it, or run it yourself with `!` |
| "Playwright not available" | `claude mcp add playwright npx @playwright/mcp@latest` in the project, or add `@playwright/test` to it |
| Jira ticket can't be read | Connect the Atlassian connector (claude.ai → Settings → Connectors) or the `atlassian` MCP, then retry, or paste the ticket text |

## Known limits

- Shell scripts, interpreter scripts and `package.json` scripts are read before they run. A
  compiled binary, a Makefile target or a git hook (husky, lint-staged) can still call git
  internally. Ticket2Merge flags such tooling and doesn't run install-lifecycle scripts.
- The shell parser is conservative, not a full POSIX shell. When unsure, it blocks: a dynamic
  program name, an unresolvable write target, or a script written and run in one go.
- Ticket2Merge's own run state lives under your home directory like any file. The guard
  blocks every write path it can resolve and fails closed on damage. It is a strong guard
  against accidental or casual bypass, not a sandbox against a determined adversary.
- Hooks need Node on `PATH`. If Node is missing, the guards can't run. The skill checks this
  at the start and stops.

## Development

```bash
npm test                               # node:test suite, no dependencies
claude plugin validate . --strict      # marketplace manifest
claude plugin validate .claude-plugin/plugin.json --strict
```

Layout:

```
.claude-plugin/        plugin.json, marketplace.json
skills/ticket2merge/   SKILL.md (state machine, gates) + references/ (one per stage)
agents/                t2m-adversary.md (read-only adversarial auditor)
hooks/hooks.json       UserPromptSubmit · PreToolUse · SessionStart
scripts/hooks/         hook entry points
scripts/lib/           shell parser, git/edit/MCP/repo-write policies, state, prompt intent
scripts/t2m.mjs        run-state CLI used by Claude (it has no approve/close command)
tests/                 unit + end-to-end hook tests
```

Every guard rule has a test in `tests/`. Add the bypass case first, watch it fail, then
fix the policy.

## Uninstall

```bash
claude plugin uninstall ticket2merge@ticket2merge-marketplace
claude plugin marketplace remove ticket2merge-marketplace
rm -rf ~/.claude/ticket2merge          # optional: run state and reports
```

## License

MIT. See [LICENSE](LICENSE).
