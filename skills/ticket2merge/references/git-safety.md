# Git safety — what the guard enforces

While a run is active in the session, the plugin's PreToolUse hook checks every Bash command,
file edit and MCP call. You do not need to re-implement it; you need to work with it.

## Allowed git (read-only)

`status` · `diff` · `diff --cached` · `log` · `show` · `rev-parse`,
`ls-files` · `blame` · `grep` · `merge-base` · `ls-tree` · `cat-file -p/-t/-s/-e`,
`branch --show-current/--list/-a/-r/-v` · `remote -v` · `remote get-url` · `describe` · `show-ref`,
`rev-list` · `for-each-ref` · `shortlog` · `reflog` (read) · `stash list/show` · `tag` (list only),
`config --get/--list` (read only) · `ls-remote` · `check-ignore` · `name-rev`.
Global `-C <dir>`, `--no-pager`. No `--output` on diff/log/show.

## Blocked — everything else, including

- Any other subcommand: add, commit, push, pull, fetch, merge, rebase, cherry-pick, revert, reset,
  switch, checkout, tag, clean, restore, rm, mv, am, apply, stash, config, worktree, notes,
  update-ref, branch create/delete/rename, remote add/set-url, unknown aliases
- `git -c …`, `--exec-path`, `--config-env` (config injection)
- The same hidden in chains (`&&` `||` `;` `|` `&` newlines), subshells, `$( )`, backticks,
  `bash -c` / `sh -c` / `eval`, heredocs, `xargs`, `find -exec`, `env`/`sudo`/`timeout`/`nohup`
- Inline interpreters that run git or load git libraries (`simple-git`, `isomorphic-git`,
  GitPython, `pygit2`, `dulwich`, …)
- Writes into `.git/` by any tool
- `gh pr merge|close|reopen|ready`, `gh pr review --approve`, `glab mr merge|approve|rebase|close`
- REST calls that merge, approve, or create commits/branches/tags/files (GitLab
  `/merge_requests/:id/merge|approve`, `/repository/commits|branches|tags|files`; GitHub
  `/pulls/:n/merge`, `/git/refs`, `/contents`)
- Git-capable MCP tools that commit, push, merge, branch, tag, approve or write files
- Nested `claude -p …` sessions (they would run outside this guard)
- Changing run state other than through `t2m.mjs` — checked on resolved paths, so `cd`,
  relative paths, `~`, variables and symlinks do not get around it
- Other spellings of git: `git-commit`, `/usr/lib/git-core/git-*`, `busybox git`, a program name
  that is a variable or substitution (`$x commit`), `alias … git`, and git with injected
  environment (`GIT_CONFIG_*`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_SSH*`, …)
- Writes to git configuration (`~/.gitconfig`, `~/.config/git/`, `/etc/gitconfig`)
- Tools that commit or tag for you: `npm|yarn|pnpm version`, `lerna version|publish`,
  `release-it`, `standard-version`, `semantic-release`
- Code the guard cannot read: a shell or interpreter reading a pipe, a program name that is a
  glob or brace pattern, a write target that cannot be resolved
- Commands carried inside other commands: `ssh host …`, `docker|podman|kubectl exec|run …`,
  `trap '…'`, `su -c`, `script -c`, `watch`, `find -exec`, wrappers with options (`sudo -u`,
  `timeout -s`, `env -S`, `nice -n`, …) — all unwrapped and checked
- Git-capable MCP servers: only their read tools; PR/MR creation, reviews and approvals are the user's
- Scripts are read before they run: `bash|sh|source|. <file>`, `node|python|… <file>` and
  `npm|yarn|pnpm run <script>` (from `package.json`) are blocked if what they would execute is.
  A script written and executed in the same command cannot be checked, so it is blocked

## Fail closed

If this session's run file is unreadable or has been changed outside the CLI, **every** guarded
tool is blocked until the user sends `/ticket2merge stop`. A guard error or an unreadable hook
event also blocks. Tell the user plainly when this happens — do not try to repair the file.

## When a command is blocked

Do not retry it another way. That is the bypass the requirements forbid. Instead:

1. Say what is needed and why.
2. Say Ticket2Merge cannot perform it.
3. Give the exact command(s) for the user, scoped as tightly as possible, e.g.
   `! git stash push -- config/app.php` (the `!` prefix runs it in this session).
4. Continue only after the user confirms it is done, and verify read-only.

## Known limits (tell the user when relevant)

- Scripts and `package.json` scripts are read before they run, but a compiled binary, a
  Makefile target or a git hook (husky, lint-staged) can still run git internally. Flag such
  tooling during investigation and do not run install-lifecycle scripts.
- The shell parser is conservative, not a full shell: when it cannot tell, it blocks.
- The guard needs Node ≥ 18 on PATH. Without it the hooks cannot run — stop and tell the user.
- The guard is active only while a run is active in this session; `/ticket2merge stop` ends it.
