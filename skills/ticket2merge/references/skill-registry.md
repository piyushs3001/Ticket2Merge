# Composed skills — use when installed, fall back when not

Check the available-skills list in your context before each stage. Invoke a listed skill with
the Skill tool; never claim a skill ran that is not listed, and never fabricate its output. When
you fall back, say so in the report ("fallback: native — `test-cases` not installed").

| Stage | Skill (if installed) | Use it for | Fallback |
|---|---|---|---|
| Intake | `jira-ticket-info` | Ticket identity + metadata (fields only — it does not read the description) | Atlassian MCP `getJiraIssue` |
| Gap analysis | `prompt-check` (its `scripts/score.py`, no `--log`) | Thin-ticket signal | Native gap analysis only |
| Investigation | `rlm` | >100 relevant files | Parallel Explore subagents |
| Test cases / runs | `test-cases` — **always, every ticket, no size exception** | PLAN-NEW, EXTEND, RED, RUN, RETEST, REGRESSION, BUG-FIRST, browser pass | Case table in report + repo-framework tests |
| Implementation | `superpowers:test-driven-development` | RED → GREEN → REFACTOR | Same discipline, natively |
| Bug loop | `superpowers:systematic-debugging` | Root cause before fix | Same discipline, natively |
| Audit | built-in `code-review` (no `--fix`), `security-review` | Diff review, security pass | `t2m-adversary` covers both |
| Playwright | built-in `run`; `mcp__playwright__*` | Start app; drive browser | `@playwright/test` CLI if the repo has it |
| Final gate | `superpowers:verification-before-completion` | Evidence before claims | Same discipline, natively |
| MR check | `review-gitlab-mr` | Self-check of the pushed GitLab MR | `gh pr view/diff` (GitHub) or native read |
| MR description | `mr-description` | GitLab MR description | Native §30 sections |
| Optional | `jira-comment` | Summary comment — only on explicit request | Offer the text for the user to paste |
| Scope control | `create-jira-ticket` | Log an out-of-scope bug — only if the user wants | List it in the report |

## Never compose these inside a run

They create commits, branches or worktrees, or merge — all forbidden here:

`superpowers:writing-plans` · `superpowers:executing-plans` · `superpowers:subagent-driven-development`
· `superpowers:finishing-a-development-branch` · `superpowers:using-git-worktrees`
· `superpowers:requesting-code-review` · `superpowers:brainstorming` · built-in `simplify`
(auto-applies unrelated cleanups).

## Precedence

A composed skill's instructions yield to Ticket2Merge where they conflict:

| Composed skill says | Ticket2Merge rule |
|---|---|
| Use a throwaway `git worktree` (review-gitlab-mr) | Read files at the HEAD SHA via the API instead |
| `git add` / `git commit` steps | Never. The user commits |
| Post to GitLab / Jira | Only on the user's explicit yes to the exact draft |
| Its own output folder | Fine — link it from `report.md` |

## Failure handling

A skill that errors: read the error, retry once if the cause is clear and safe, otherwise fall
back and label the work as fallback. A missing credential (`GITLAB_TOKEN`, Atlassian auth) is
reported to the user with the fix; do not work around it with guessed data.
