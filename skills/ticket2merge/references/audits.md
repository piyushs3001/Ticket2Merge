# Positive audit, negative audit, bug loop

Both audits are mandatory. Depth scales with the change; existence does not.

## POSITIVE_AUDIT — does it satisfy the ticket under valid conditions?

Walk the AC mapping row by row, then check:

| Area | Check |
|---|---|
| Functional | Every `R#`/`AC#` works; expected flows; API/service and UI behaviour |
| Code quality | Readable, repo conventions, right abstraction, no duplication |
| Architecture | Fits the existing design; no needless complexity or abstraction |
| Error handling | Expected failures handled, meaningful errors, correct propagation |
| Security (where relevant) | AuthN, AuthZ, input validation, injection, data exposure, unsafe defaults |
| Performance (where relevant) | N+1, excess DB/network calls, expensive loops, memory |
| Compatibility | Existing APIs, consumers, behaviour, UI flows, shared code |

Use the built-in `/code-review` skill on the working diff as a second pair of eyes (never with
`--fix`; its findings go through the bug loop below). Record the result as a table in
`report.md` → **Positive audit**.

## NEGATIVE_ADVERSARIAL_AUDIT — try to break it

Dispatch the **`t2m-adversary`** subagent (fresh context — auditing your own code in the same
context is biased). Give it: ticket summary with `R#/AC#`, the changed-file list
(`git diff --name-only` + untracked files from `git status --porcelain`), the repo path, the
stack, the test commands, and the path of any `review-gitlab-mr` references if that skill is
installed (`references/generic-checklist.md`, `blocking-gates.md`, `stacks/*.md`).

In parallel, run the built-in `/security-review` skill on the pending changes when the change
touches auth, input handling, data access, file handling or external calls.

The adversary thinks as a malicious user, a careless user, an API consumer sending invalid /
empty / huge data, a concurrent user, a partially failing system, and the maintainer six months
later. It covers: edge cases, failure scenarios, security, concurrency, browser/UI adversarial
cases, and **regression — what existing functionality could this break?**

Merge its findings with `/security-review`'s, de-duplicate, and record every one.

## Bug record — every finding, none hidden

Severity: **Critical** (blocks safe/correct operation) · **High** (significant functional,
security, data or reliability problem) · **Medium** (should generally be fixed) · **Low** ·
**Informational** (no fix required).

```
Bug:              <id> <one line>
Severity:
Location:         file:line
How to reproduce:
Expected behavior:
Actual behavior:
Root cause:
Fix:
Regression test:  <test id / file>
```

## Loop — BUG_FIX_LOOP

**REQUIRED SUB-SKILL:** `superpowers:systematic-debugging` when available (root cause before fix).

```
find bug → root cause → failing regression test (watch it fail) → fix → affected tests
→ broader tests → re-run positive audit → re-run negative audit (scoped to the fix)
```

With the `test-cases` skill: use its BUG-FIRST mode (case first, prove it fails, then fix).

Exit only when: no Critical, no High, every Medium fixed or explicitly documented with a reason,
tests pass, existing functionality checked. A bug outside the ticket's scope is recorded as
"Found unrelated issue in X. Outside this ticket. Not modified." — not fixed.
