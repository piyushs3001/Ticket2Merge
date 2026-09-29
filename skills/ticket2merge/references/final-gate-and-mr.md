# Final gate, manual commit, MR

## FINAL_VERIFICATION — the gate

**REQUIRED SUB-SKILL:** `superpowers:verification-before-completion` when available.
Re-run the final test commands fresh; review the final diff (`git diff`, `git diff --cached`,
`git status --porcelain` for untracked files) against the approved plan.

Every line must be true **with evidence**, or the run is not ready:

```
[ ] Ticket requirements satisfied          [ ] Positive test cases created
[ ] Acceptance criteria satisfied          [ ] Negative test cases created
[ ] Positive audit complete                [ ] Edge-case tests created where applicable
[ ] Negative audit complete                [ ] Regression tests created/updated where needed
[ ] Bugs identified and recorded           [ ] Unit tests executed
[ ] Critical bugs fixed                    [ ] Integration/API tests executed where applicable
[ ] High bugs fixed                        [ ] Playwright positive tests executed where applicable
[ ] Relevant Medium bugs resolved/documented [ ] Playwright negative tests executed where applicable
[ ] Final diff reviewed                    [ ] Relevant existing Playwright tests executed
[ ] No known unintended regression         [ ] Regression suite executed
```

Any unchecked line → final status **NOT READY**, with the reason. Say so plainly; do not
soften it into "mostly ready".

## Final report — write the full version to `report.md`; print it in the chat style

Brief style prints only the "Final report" row from SKILL.md; the block below is the report file
(and the chat output in detailed style).

```
## Ticket2Merge Final Verification — <TICKET>

Implementation     ✓ Completed
Positive audit     ✓ Passed
Negative audit     ✓ Completed — <n> issues found, <n> fixed, <n> documented
Test cases         Positive <n> · Negative <n> · Edge <n> · Regression <n>
Automated tests    Unit <p>/<t> · Integration <p>/<t> · Playwright <p>/<t> · Regression <p>/<t>
                   (each: command → summary line from the runner)
Final status       ✓ Requirements · ✓ AC · ✓ Audits · ✓ Regression · ✓ No known regressions

Git
  Git state was NOT modified. No files were staged. No commit was created.
  No push was performed. No branch was created or switched. No merge/rebase was performed.

Suggested commit message
  <message — follow the repo's convention from `git log --oneline -20`>

Commit summary
  <what the commit contains, one line per concern>

READY FOR MANUAL COMMIT.
```

Replace any `✓` with the truth (`✗`, `NOT RUN — reason`, `SKIPPED AT USER REQUEST`). If the
status is NOT READY, the last line says `NOT READY — <reason>` instead.

Then `t2m state READY_FOR_MANUAL_COMMIT` and **stop**. The CLI refuses this state unless both
audits, regression testing and final verification were entered after the latest approval — if
it refuses, the run is NOT READY: stay in `FINAL_VERIFICATION` and say which stage is missing. Do not offer to stage, commit or push.
The user may want the exact commands: give them as text (`git add <files>` …) for the user to
run, suggesting the `! <command>` prefix.

## HUMAN_COMMIT

When the user says they committed: verify read-only (`git log -1 --stat`, `git status`),
acknowledge it, `t2m state HUMAN_COMMIT`, and ask for the MR/PR link. Do not create another
commit, push, or merge. If the log shows no new commit, say so and ask — do not assume.

## MR_LINK → MR_DESCRIPTION

1. `t2m state MR_LINK`.
2. **GitLab MR** + `review-gitlab-mr` available → run it as a final self-check of the pushed MR
   (read-only; it never approves or merges). Fix-worthy findings → new approval → back through
   the bug loop. GitHub PR → `gh pr view <url>` and `gh pr diff <url>` read-only instead.
3. `t2m state MR_DESCRIPTION`. **GitLab** + `mr-description` available → invoke it, giving it
   the `report.md` path so its *Verification*, *For the reviewer* and *Known behaviour* sections
   carry the real test commands, results, audit findings and remaining risks. Otherwise write
   it natively with these sections: Summary · Problem · Solution · Changes · Technical details
   · Testing (added, executed, results) · Playwright (positive, negative, regression, results)
   · Audit (positive, negative, issues found/fixed) · Security · Performance · Backward
   compatibility · Risks · Screenshots (UI changes).
4. Append the Ticket2Merge block (both paths):

```
### Ticket2Merge evidence
Security: <…>   Performance: <…>   Backward compatibility: <…>
- [x] Requirements implemented       - [x] Tests added and executed
- [x] Positive audit completed       - [x] Negative audit completed
- [x] Playwright tests where applicable - [x] Regression checks completed
- [x] Final diff reviewed            - [ ] Reviewer approval
                                     - [ ] Merge
```

Only tick what happened. Never tick reviewer approval or merge.

5. Posting the description to the MR or a summary to Jira (`jira-comment`) happens only on the
   user's explicit yes to the exact draft — those skills already enforce that. Never post on
   your own initiative.
6. Done: tell the user the run is complete and that `/ticket2merge stop` closes it (the guard
   stays on until they do).
