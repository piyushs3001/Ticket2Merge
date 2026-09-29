# Test cases, execution, Playwright, regression

Tests validate behaviour, not coverage. Every test names the production break it catches.

## 1. Test cases first — right after approval, before code

**Baseline first.** Test runners count as repo writers, so they cannot run before approval.
The first thing after approval, before any edit, is one run of the relevant existing tests.
Its failures are your evidence for "pre-existing failure" later.

- `test-cases` skill available → invoke it in **PLAN-NEW** (no spec for the module) or
  **EXTEND** (spec exists) mode for the ticket's `R#/AC#`, then its **RED** step: Critical/High
  cases must fail for the right reason against the unbuilt feature.
- Not available → write the positive and negative cases as a table in `report.md` → **Test
  cases** (`ID · Type · Priority · Action · Expected · Layer · Status`), then write the automated
  tests in the repo's own framework and watch them fail (`superpowers:test-driven-development`
  when available).
- Implement to green. Durable tests live in the repo, in its existing test structure.

## 2. TEST_CASE_GENERATION — after the audits

Extend the cases from: acceptance criteria, implementation behaviour, positive audit, negative
audit, discovered bugs, regression risks, edge cases, affected existing functionality.
(`test-cases` EXTEND / BUG-FIRST.) Build the matrix, marking each cell ✓ or `N/A — reason`:

| Area | Positive | Negative | Edge | Regression |
|---|---|---|---|---|
| New feature | | | | |
| API | | | | |
| UI | | | | |
| Validation | | | | |
| Authorization | | | | |
| Existing related feature | | | | |

## 3. Execution order and reporting

1. targeted unit → 2. targeted integration/API → 3. new Playwright → 4. related existing
Playwright → 5. broader suite → 6. final regression suite. Adapt to the repo.

For each run record: command · tests · passed · failed · skipped · warnings · result. Numbers
come from the runner's output — paste the summary line. A runner that will not start is
`NOT RUN — <verbatim error>`, never a pass. Do not repair the project's test tooling or install
packages as a side quest; report the blocker.

Failure classes (never label an implementation failure "environment" without evidence):

| Class | Action |
|---|---|
| New implementation failure | Fix the code |
| Regression | Fix the code + add/update a regression test |
| Incorrect test | Fix how the test observes, not what it asserts (changing the assertion needs the ticket's authority) |
| Pre-existing failure | Document with evidence (fails on the unchanged code too) |
| Environment failure | Document clearly, with the error |

## Playwright

Playwright adds to unit/integration tests; it never replaces them. Web/browser-facing changes
only — otherwise `— not applicable (no browser-facing change)`.

```
repo has @playwright/test (+ config/specs)?
  yes → write/extend specs in ITS structure, fixtures, helpers; run `npx playwright test <files>`
  no  → mcp__playwright__* tools present?
          yes → drive the running app via the MCP (test-cases browser pass, if installed)
          no  → report "Playwright not available"; propose `claude mcp add playwright
                npx @playwright/mcp@latest` or adding @playwright/test as a plan item —
                never add the dependency without approval
```

Bring the app up with the built-in `/run` skill if it is not running. **Local only** — never
staging or live.

- **Positive:** open → authenticate → navigate → act → assert the real outcome (data shown,
  state changed, persisted after reload). Element existence alone is not an assertion.
- **Negative:** invalid input, missing required input, unauthorized access **by direct URL**,
  invalid state (refresh, back, direct URL, bad/missing params), API failure / network failure /
  timeout / server error where testable. Assert: visible feedback, no false success, no data
  changed, no crash, no console errors.
- **Edge (only if relevant):** double / rapid clicks, refresh mid-operation, back/forward, empty
  forms, very long input, special characters, boundaries, multiple sessions, slow network,
  responsive layouts.
- Screenshot every failure. Clean up records you created.

## Regression — hard requirement

Before completion answer, in the report: **what existing functionality could this change break?**
Derive it from the changed files, functions, APIs, DB behaviour, components, state, shared
utilities, dependencies, routing, auth, UI behaviour — grep for the callers and consumers.

Then run: tests covering those areas (`test-cases` REGRESSION mode runs a spec's `smoke` +
`regression` sets), related existing Playwright specs, the broader suite when practical.
An intended behaviour change must be required by the ticket, reflected in updated tests, and
listed under **Behaviour changes** in the report. Never silently break existing behaviour.
