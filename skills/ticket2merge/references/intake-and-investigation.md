# Intake, investigation and gap analysis

Read-only stages. Nothing in the repo changes here.

## 1. TICKET_RECEIVED — fetch and normalise

| Source | How (read-only) |
|---|---|
| Jira key / URL | Metadata: `jira-ticket-info` skill if available. Narrative: Atlassian MCP `getJiraIssue` with `description`, `comment`, `issuelinks`, `subtasks`, `attachment`, plus any acceptance-criteria custom field. Site: `jiraSite` from the effective config, else the URL's host, else `getAccessibleAtlassianResources` |
| GitLab issue URL | `curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" <gitlab>/api/v4/projects/<enc>/issues/<iid>` (+ `/notes`). `<gitlab>` = `gitlabUrl` from the effective config, else the issue URL's host, else the host of `git remote get-url origin` |
| GitHub issue URL | `gh issue view <url> --comments` |
| Linear / Azure DevOps / other | Ask the user to paste the ticket text |
| Plain text | Use as given |

Never guess a Jira project prefix. If the MCP or token is missing, say which, and ask the user to
paste the ticket rather than inventing its content.

Write to `report.md` → **Ticket**:

| Field | Content |
|---|---|
| Objective / Problem statement | |
| Functional requirements | numbered `R1…Rn` — every later mapping cites these |
| Non-functional requirements | |
| Acceptance criteria | numbered `AC1…ACn`, quoted from the ticket |
| Constraints / Dependencies | |
| Referenced files / components / services | |
| Expected behaviour / Out-of-scope behaviour | |
| Assumptions / Unknowns / Risks | carried into §3 |

**End-user view first.** One short paragraph: who uses this, what they expect, how they will
meet it. Explain domain jargon in plain words — the developer may not know the field.

## 2. REPOSITORY_INVESTIGATION

Search before creating. Existing project patterns beat new patterns.

- Structure, architecture, the modules/services/APIs/models the ticket touches
- Conventions: naming, error handling, logging, validation, auth/authorization
- **Existing similar functionality** — the file whose approach the plan will copy
- Tests: framework, command (read `package.json` / `composer.json` / `Makefile` / CI — never
  guess), existing specs. Do not run them yet — runners are blocked before approval; the
  baseline run happens right after it (`testing.md` §1). If the `test-cases` skill is
  available, do only its read-only lookups now (read `docs/testcases/INDEX.md`, `grep -l` the
  specs for the paths you will touch); its `_profile.md` and spec files are written after
  approval.
- Playwright: `@playwright/test` in the manifest? `playwright.config.*`? existing spec folder
  and fixtures? `mcp__playwright__*` tools present?
- Git hooks and scripts that could run git during tests (husky, lint-staged, `prepare`) — note
  them; do not run `prepare`/`postinstall`-style scripts.
- Large repo (>100 relevant files): use the `rlm` skill if available, else parallel Explore
  subagents with a narrow question each.

Record `file:line` anchors in the report — the plan cites them.

## 3. REQUIREMENTS_GAP_ANALYSIS

| Class | Meaning | Action |
|---|---|---|
| **Blocker** | Cannot start safely without it | **Stop and ask.** Do not plan around it |
| **Assumption** | Reasonable, non-blocking | State it; it goes into the plan for approval |
| **Question** | Materially changes the implementation | Ask, with a recommended default |
| **Risk** | Could go wrong | Carry into the plan's Risks |
| **Out of scope** | Related, not to be changed | List it so no one "fixes" it |

Optional signal for thin, free-text tickets: if `~/.claude/skills/prompt-check/scripts/score.py`
exists, write the ticket text to a scratch file and run
`python3 <score.py> --json < file` (**without `--log`** — ticket text is not the user's prompt).
Missing Context/Constraints/Verify fields are hints for the Questions list, not the analysis.

Never silently invent a business requirement. A question the user delegates back ("do whatever
makes sense") becomes an Assumption with your recommended default, visible in the plan.
