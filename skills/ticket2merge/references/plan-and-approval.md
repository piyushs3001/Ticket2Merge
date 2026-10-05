# Implementation plan and Gate 1

## The plan — write into `report.md` → **Plan**, in this order

1. **Summary** — the solution in 2–3 sentences, from the end user's seat.
2. **Files to change** — table: path · why · expected change.
3. **Files to create** — path · purpose. **Files to delete** — only if necessary, with reason.
4. **Architecture changes** — impact, or `None`.
5. **Data changes** — schema, migrations, backward compatibility, data transformation, or `None`.
6. **API changes** — endpoints, request/response, validation, error behaviour, or `None`.
7. **UI changes** — pages, components, flows, loading / error / success states, accessibility, or `None`.
8. **Test strategy** — always present, never `None`. The positive and negative cases you
   will write (at least one of each), edge and regression cases, the layer of each (unit,
   integration/API, Playwright — which mode, see `testing.md`), the test files to create or
   extend, and the real commands. Runner known to be broken → a "Fix the test runner" item
   or a named stand-in (`testing.md` §Runner broken).
9. **Assumptions** — every default you chose, including delegated questions.
10. **Risks**.
11. **Acceptance-criteria mapping** — every `R#` / `AC#` → planned change → how it is validated.
    A row with no validation is a gap: fix the plan.

Prefer the smallest safe change that satisfies the ticket. No unrelated refactors, no new
dependencies unless the plan names and justifies them (adding `@playwright/test` counts).

## Gate 1 — HUMAN_APPROVAL

1. `t2m state HUMAN_APPROVAL --run <id>`.
2. Write the full plan to `report.md`. In chat show it in the current chat style (brief: the
   "Plan at the gate" row in SKILL.md), then end with:
   **"Reply `approve` to start, or tell me what to change."**
3. **End your turn.** Do not modify files, write tests, or run implementation commands.

What happens next is decided by the user's message, and the hook tells you which:

| Hook says | Meaning | You do |
|---|---|---|
| `APPROVED …` | Explicit approval recorded, state is now `IMPLEMENTATION` | Start implementing |
| `NOT recorded as approval …` | Approval with changes | Revise, show the delta, ask again |
| `Still waiting at HUMAN_APPROVAL …` | Anything else | Answer it; ask for approval again |

Repo writes are blocked until the first case. If an edit is denied with "Gate 1", you are early —
never try to route around it (Bash redirects, other tools, another repo path).

## Deviation — after approval

A **material** deviation (different files or architecture, new dependency, changed data or API
contract, changed behaviour the user will notice, a new repo) →

1. Stop editing.
2. Explain what changed, why the approved plan is insufficient, and the new approach.
3. `t2m state HUMAN_APPROVAL --run <id> --note "<why>"` — this revokes the approval.
4. Ask for approval again.

Minor details that do not alter the approved design (a helper name, an extra guard clause,
import order) proceed without re-approval — list them in the report's implementation log.
