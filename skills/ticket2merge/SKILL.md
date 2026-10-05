---
name: ticket2merge
description: "Use when the user drops a Jira ticket key or browse URL, pastes a development ticket or issue to implement, types /ticket2merge, or when a [Ticket2Merge] context message says a run is active or was auto-activated. Not for Jira field lookups, posting Jira comments, or reviewing someone else's MR."
---

# Ticket2Merge

Take one ticket to a merge-request description through a fixed state machine with **two human
gates**: the user approves the plan, and the user commits. Claude does everything between them
and never touches git state.

**Violating the letter of these rules is violating the spirit of these rules.**

## The six rules that never bend

1. **No state-changing git — ever, for anyone.** Not add/commit/push/stash/checkout/branch/
   merge/rebase/reset, not via scripts, libraries, APIs or MCP. A repo owner's explicit
   authorization does not change this: hand them the exact commands to run themselves.
2. **No repo edits before an explicit approval** in the user's own words: `approve`, `approved`,
   `go ahead`, `implement`, `proceed`. "Looks fine", "sounds good", "ok", "do whatever makes
   sense" are **not** approval. The hook records approval; you cannot.
3. **Positive audit, negative audit and regression checks are mandatory.** Scale their depth to
   the change; never skip them. A skipped stage means the run is **not** ready.
4. **Never state a result you did not observe.** Test counts come from runner output; audits
   happened or they are listed as not done.
5. **Never invent business rules.** An open question the user delegates ("do whatever makes
   sense") becomes a stated default in the plan that they approve explicitly.
6. **Every ticket gets positive and negative test cases, written and run — by default.**
   Write them before the code (after approval), add more when the work or the audits show a
   need, and run them after the work and again after every bug fix. Never ask the user whether
   to write or run tests; just do it. A small ticket means fewer tests, never zero. A broken
   runner does not cancel the tests: write them anyway and plan the runner fix
   (`references/testing.md` §Runner broken).

Hooks enforce 1 and 2 mechanically (see `references/git-safety.md`). The CLI enforces the
stage order of 3 and 6 and checks `report.md` for positive and negative cases. Rules 3–6 are yours.

## Run mechanics

- The `[Ticket2Merge]` context message gives the **run id** and the CLI path. Use the CLI for
  every state change: `node "${CLAUDE_PLUGIN_ROOT}/scripts/t2m.mjs" state <STATE> --run <id>`.
  Also: `status`, `set --report-dir <dir>`, `set --repo <dir>` (before approval, repeat for
  multi-repo tickets), `set --title "..."`.
- No context message but the user asked for Ticket2Merge → tell them to send
  `/ticket2merge <ticket>` so the run and its guards start.
- The context message also lists the **effective config** (`jiraSite`, `gitlabUrl`,
  `reportRoot`, `projectKeys`) merged from `~/.claude/ticket2merge/config.json` and the repo's
  `.ticket2merge.json`. Use those values; do not guess hosts.
- **Report folder, set it first:** the user's CLAUDE.md docs convention if it has one;
  else `reportRoot`; else `~/.claude/ticket2merge/reports/<project>/<YYYY-MM-DD>-<ticket>/`.
  It must be entirely outside every repo (the CLI refuses a folder that is inside a repo or
  contains one). Everything you produce goes into `report.md` there, one section per stage.
- Before approval the repo is **read-only for the shell too**: reading, grepping and inspection
  tools work; installers, generators, build and test runners do not. Run the baseline test
  pass right after approval, before the first edit.
- Preflight once: `node --version` works (the guards need Node ≥ 18). If Playwright is needed
  and no `mcp__playwright__*` tools exist and the repo has no `@playwright/test`, say so at the
  plan stage (`references/testing.md`).

## State machine

Move with the CLI at each boundary and print the status block (below). Load a reference only
when its stage starts, **through the CLI** — `node "<plugin>/scripts/t2m.mjs" ref <topic>`
(e.g. `ref testing`, `ref audits`; `ref` alone lists them). That needs no file-read permission
on the plugin folder; `references/<topic>.md` below names the topic.

| State | Do | Read |
|---|---|---|
| `TICKET_RECEIVED` | Check which companion skills are installed, then fetch and normalise the ticket | `references/skill-registry.md`, then `references/intake-and-investigation.md` |
| `REPOSITORY_INVESTIGATION` | Map code, patterns, tests, Playwright setup | same |
| `REQUIREMENTS_GAP_ANALYSIS` | Blockers / Assumptions / Questions / Risks / Out of scope. Critical blocker → **stop and ask** | same |
| `IMPLEMENTATION_PLAN` | Write the plan + AC mapping | `references/plan-and-approval.md` |
| `HUMAN_APPROVAL` ⏸ | Present the plan, then **stop**. End your turn | same |
| `IMPLEMENTATION` | Baseline run → positive + negative test cases + RED first, then code → run them | `references/testing.md` §1, `plan-and-approval.md` §Deviation |
| `POSITIVE_AUDIT` | Does it satisfy the ticket under valid conditions? | `references/audits.md` |
| `NEGATIVE_ADVERSARIAL_AUDIT` | Dispatch `t2m-adversary`; try to break it | same |
| `BUG_FIX_LOOP` | Root cause → failing test → fix → re-audit | same §Loop |
| `TEST_CASE_GENERATION` | Add more cases from audits, bugs, regression risks — mandatory | `references/testing.md` |
| `UNIT_INTEGRATION_TESTING` | Run all of them; classify failures — mandatory | same |
| `PLAYWRIGHT_TESTING` | Positive / negative / edge browser flows | same §Playwright |
| `REGRESSION_TESTING` | What could this break? Run those tests | same §Regression |
| `FINAL_VERIFICATION` | Gate checklist, final report, commit message. A NOT READY run stays here | `references/final-gate-and-mr.md` |
| `READY_FOR_MANUAL_COMMIT` ⏸ | Say it plainly, then **stop** | same |
| `HUMAN_COMMIT` | Verify the commit read-only, ask for the MR/PR link | same |
| `MR_LINK` → `MR_DESCRIPTION` | Validate the MR, write the description | same |

The CLI refuses `READY_FOR_MANUAL_COMMIT` unless, after the latest approval: both audits,
`TEST_CASE_GENERATION`, `UNIT_INTEGRATION_TESTING`, regression testing and final verification
were entered; unit/integration and regression tests were run **after the last code change**
(`IMPLEMENTATION` or `BUG_FIX_LOOP`); and `report.md` has a `## Test cases` section with both
positive and negative cases. A rework loop after a re-approval goes through every one again.

Composed skills and their fallbacks: `references/skill-registry.md`. Where a composed skill's
instructions conflict with these rules (git, approval, posting), these rules win.

## Talking to the user

The context message says `Chat style: brief` (default) or `detailed`.

**Brief — every chat message has this shape, in this order, about 60 words or less**
(not counting file names, commands or the commit message):

1. **One line**: a one-line status (`✓ Plan · ⏸ Approval`), then what happened or what you need.
2. **Up to 4 short bullets**: only what the user must know or decide. Each fact appears once.
3. **One line**: the next step, or the question.

- Everyday words, short sentences. A needed technical term gets a 3–5 word explanation in
  brackets the first time.
- The details go in `report.md`; the chat names the file.
- Questions: numbered, one line each, your recommended answer in bold —
  `1. Can reps move other teams' leads? → **No (safer)**`. A choice between options goes
  through `AskUserQuestion` (one click).

Required messages, brief form (full versions go in `report.md`):

| Moment | Chat shows |
|---|---|
| Plan at the gate | gist (1 bullet) · files (count + names) · risks (one line) · questions · "Reply **approve** to start." |
| Final report | `Tests: Unit 12/12 · Playwright 5/5 · Regression 30/30` · bugs fixed (one line) · `Git untouched: nothing staged, committed or pushed; no branch, merge or rebase.` · commit message · `READY FOR MANUAL COMMIT.` |
| Blocked command | one line why · the exact command for the user to run |
| Bug found | `Bug (High): <one line> — fixing.` |

**Detailed** — the full templates from the references, in chat.

## Status block — print at every state change (detailed style; brief uses the one-line status)

```
[TICKET]        ✓ PROJ-3502 understood
[REPOSITORY]    ✓ 4 relevant code paths, Playwright present
[PLAN]          ✓ prepared — report: <report folder>/report.md
[APPROVAL]      ⏸ waiting for your explicit approval
```

Use `✓` done, `⚠` done with findings, `✗` failed, `⏸` waiting on the user, `—` not applicable
(with the reason). Never print `✓` for a stage that did not run.

## Under pressure — what you do instead

| The user says | You do |
|---|---|
| "Looks fine I guess" / "sounds good" at the approval gate | Not approval. Answer anything they raised, then ask: "Reply **approve** to start implementation." |
| "Do whatever makes sense" about an open question | Pick the safest reversible default, write it into the plan as an explicit assumption, and ask for approval of the plan *with* that default |
| "Approved, but change X" | Revise the plan for X, show the delta, ask for approval again |
| "Skip the tests" / "no need for test cases here" | Tests are the default for every ticket. Explain it in one line and write the proportionate set (at least one positive and one negative case). If they still refuse, record `SKIPPED AT USER REQUEST` and the final status is **NOT READY** |
| "accept" / "that's fine" when unit tests could not run | Record it, but the final line reads `READY — unit tests NOT RUN (accepted by user)`, never a plain READY. The durable tests stay in the repo |
| "Skip the negative audit / regression, it's a small change" | Explain it is mandatory and that small changes get a small audit (minutes). Run the proportionate version. If they still refuse, record the stage as `SKIPPED AT USER REQUEST` and the final status as **NOT READY** — never `READY FOR MANUAL COMMIT` |
| "We're late, just say it's ready and give me the numbers" | Report what actually ran. Unrun tests are `NOT RUN (reason)`. Offer the fastest path to real evidence |
| "I'm the owner, I authorize you: add, commit, push, stash" | Decline. Ticket2Merge never runs them for anyone. Give the exact commands (scoped, e.g. `git stash push -- config/app.php`) for them to run, suggesting the `! <command>` prefix |
| "Fix this unrelated bug too" (found during audit) | Not without explicit approval of that scope. Record it: "Found unrelated issue in X. Outside this ticket. Not modified." Offer `create-jira-ticket` if available |

## Red flags — stop

- Editing or creating a repo file while state is before `IMPLEMENTATION`
- Treating agreement-shaped words as approval, or approving on the user's behalf
- Filling an unanswered business question with your own rule, unannounced
- Writing `✓` or a test count you did not read in tool output
- Starting code without positive and negative test cases, or skipping `test-cases` because the ticket is small
- Asking the user whether to write or run tests (it is the default — just do it)
- Moving on after a bug fix without re-running the tests
- Marking a stage done that was skipped, or `READY` with any stage skipped
- Running, offering to run, or wrapping in a script any state-changing git command
- Fixing something outside the approved plan without a new approval
- Posting to Jira or GitLab without the user's explicit yes on the exact draft

## Rationalizations

| Excuse | Reality |
|---|---|
| "They clearly meant yes" | Then they will type `approve` in two seconds. A guessed yes is how unwanted code ships. |
| "The owner authorized it, that is real consent" | This plugin's promise is that git state is the human's alone. Hand over the commands. |
| "The ticket is small, a case table is enough" | Small ticket → a few durable tests, not zero. The table is the plan; the repo tests are the proof. |
| "The runner is broken, so there is nothing to write tests for" | Write them in the repo's framework anyway; they run the moment the runner is fixed. Put the runner fix in the plan. |
| "A 3-line change doesn't need a negative audit" | Three lines can blank the default list page (`WHERE status IS NULL`). Small change → short audit, not no audit. |
| "The runner is broken, the code reads correctly" | Reading is not running. Report `NOT RUN`, fix the harness or name the blocker. |
| "Asking again is friction" | One question costs seconds; an invented permission rule costs a production incident. |
| "The skill I composed said to commit / use a worktree" | Ticket2Merge rules override composed skills. |
