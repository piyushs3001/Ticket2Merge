// Decides whether a Bash/PowerShell command may run during an active Ticket2Merge run.
// Git: allowlist of read-only subcommands with argument checks — everything else is blocked,
// however it is spelled, wrapped, scripted or reached through an API.
// Anything the checker cannot resolve (dynamic program names, unresolvable write targets,
// code read from a pipe) is blocked rather than guessed.

import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandText, gitConfigPaths, inDotGit, inside, overlaps, realResolve, resolveWord, SUB } from './paths.mjs';
import { allCommands, basename, parseLevel, SHELLS, unwrap } from './shell-parse.mjs';
import { writeTargets } from './write-targets.mjs';

const allow = () => ({ allow: true });
const block = (what, why) => ({
  allow: false,
  reason:
    `Ticket2Merge blocked \`${String(what).slice(0, 160)}\`: ${why}. ` +
    'Ticket2Merge never changes git state. Explain what is needed, ask the user to run it ' +
    'manually, and continue only after they confirm it is done.',
});

// --- git ---------------------------------------------------------------------------

const GIT_BINARIES = new Set(['git', 'git.exe', 'hub']);
const GLOBAL_VALUE_OPTS = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const GLOBAL_FLAG_OPTS = new Set([
  '--no-pager', '-P', '-p', '--paginate', '--bare', '--no-replace-objects', '--literal-pathspecs',
  '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-advice',
]);
const GLOBAL_DENY = [/^-c$/, /^-c./, /^--config-env/, /^--exec-path/];

const FREE_SUBCOMMANDS = new Set([
  'status', 'rev-parse', 'ls-files', 'blame', 'merge-base', 'ls-tree', 'describe', 'show-ref', 'rev-list',
  'for-each-ref', 'shortlog', 'name-rev', 'count-objects', 'check-ignore', 'check-attr', 'var', 'whatchanged',
  'range-diff', 'version', 'help', 'cherry', 'ls-remote', 'annotate', 'show-branch',
]);
const NO_OUTPUT_SUBCOMMANDS = new Set(['diff', 'log', 'show']);
const BRANCH_LIST_FLAGS = new Set([
  '--show-current', '--list', '-l', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose',
  '--no-color', '--no-column', '-i', '--ignore-case',
]);
const BRANCH_VALUE_FLAGS = /^--(format|sort|contains|no-contains|merged|no-merged|points-at|color|column)(=.*)?$/;
const CONFIG_READ = /^(--get|--get-all|--get-regexp|--get-urlmatch|--list|-l|--show-origin|--show-scope|--name-only|--null|-z|--global|--local|--system|--worktree|--includes|--no-includes|--type=.*|--bool|--int|--path|--default=.*)$/;

function checkGitArgs(argv) {
  const shown = argv.join(' ');
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (GLOBAL_DENY.some((re) => re.test(a))) return block(shown, `global option \`${a}\` can inject git configuration`);
    if (a === '--version' || a === '--help' || a === '-h') return allow();
    if (GLOBAL_VALUE_OPTS.has(a)) { i += 2; continue; }
    if (/^--(git-dir|work-tree|namespace|super-prefix)=/.test(a)) { i++; continue; }
    if (GLOBAL_FLAG_OPTS.has(a)) { i++; continue; }
    if (a.startsWith('-')) return block(shown, `unknown global option \`${a}\``);
    break;
  }
  const sub = argv[i];
  const args = argv.slice(i + 1);
  if (sub === undefined) return allow(); // bare `git` prints help

  if (FREE_SUBCOMMANDS.has(sub)) return allow();
  if (NO_OUTPUT_SUBCOMMANDS.has(sub)) {
    return args.some((a) => a === '--output' || a.startsWith('--output='))
      ? block(shown, '`--output` writes files from git')
      : allow();
  }
  if (sub === 'grep') {
    return args.some((a) => /^-O/.test(a) || a.startsWith('--open-files-in-pager'))
      ? block(shown, '`git grep -O` launches an external program')
      : allow();
  }
  if (sub === 'cat-file') {
    const flags = args.filter((a) => a.startsWith('-'));
    return flags.length && flags.every((f) => ['-p', '-t', '-s', '-e'].includes(f))
      ? allow()
      : block(shown, 'only `git cat-file -p|-t|-s|-e` is allowed');
  }
  if (sub === 'remote') {
    if (args.length === 0 || (args.length === 1 && (args[0] === '-v' || args[0] === '--verbose'))) return allow();
    if (args[0] === 'get-url') return allow();
    return block(shown, '`git remote` may only list remotes or read a URL');
  }
  if (sub === 'stash') {
    return ['list', 'show'].includes(args[0]) ? allow() : block(shown, 'only `git stash list|show` is allowed');
  }
  if (sub === 'reflog') {
    return args.length === 0 || ['show', 'exists'].includes(args[0]) || args[0].startsWith('-')
      ? allow() : block(shown, 'only reading the reflog is allowed');
  }
  if (sub === 'tag') {
    const listMode = args.length === 0 || args.some((a) => ['-l', '--list', '-n', '--contains', '--points-at', '--merged', '--no-merged'].includes(a) || /^-n\d+$/.test(a));
    const bad = args.some((a) => /^(-d|--delete|-a|--annotate|-s|--sign|-f|--force|-m|--message|-F|--file|-u|--local-user|-e|--edit)$/.test(a));
    return listMode && !bad ? allow() : block(shown, 'only listing tags is allowed');
  }
  if (sub === 'config') {
    const flags = args.filter((a) => a.startsWith('-'));
    const reads = flags.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|--list|-l)$/.test(a));
    return reads && flags.every((a) => CONFIG_READ.test(a)) ? allow() : block(shown, 'only reading git config is allowed');
  }
  if (sub === 'branch') {
    const listMode = args.some((a) => a === '--list' || a === '-l');
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (BRANCH_LIST_FLAGS.has(a)) continue;
      const m = BRANCH_VALUE_FLAGS.exec(a);
      if (m) {
        if (!m[2] && !['color', 'column'].includes(m[1]) && args[k + 1] && !args[k + 1].startsWith('-')) k++;
        continue;
      }
      if (!a.startsWith('-') && listMode) continue;
      return block(shown, 'only listing branches or `git branch --show-current` is allowed');
    }
    return allow();
  }
  return block(shown, `\`git ${sub}\` is not on the read-only allowlist`);
}

// `git …`, `git-commit …` and `/usr/lib/git-core/git-commit …` all become ['git', sub, …].
function asGitArgv(argv) {
  const head = basename(argv[0]);
  if (GIT_BINARIES.has(head)) return argv;
  const m = /^git-([a-z][a-z0-9-]*)$/.exec(head);
  return m ? ['git', m[1], ...argv.slice(1)] : null;
}

function gitVerdict(argvList) {
  for (const argv of argvList) {
    const g = argv.length && asGitArgv(argv);
    if (g) {
      const r = checkGitArgs(g);
      if (!r.allow) return r;
    }
  }
  return allow();
}

// --- HTTP APIs and forge CLIs --------------------------------------------------------

const ALWAYS_WRITE_ENDPOINTS = [
  /\/merge_requests\/[^/?#]+\/(merge|approve|unapprove|rebase|cancel_merge_when_pipeline_succeeds)\b/,
  /\/pulls\/[^/?#]+\/(merge|update-branch)\b/,
];
const WRITE_ON_MUTATION_ENDPOINTS = [
  /\/repository\/(commits|branches|tags|files|submodules)\b/,
  /\/git\/(refs|commits|trees|blobs|tags)\b/,
  /\/repos\/[^/]+\/[^/]+\/(contents|merges|branches|git|tags|releases)\b/,
  /\/pulls\/[^/?#]+\/reviews\b/,
  /\/merge_requests\/?$/,
  /\/pulls\/?$/,
  /\/(releases|tags)\/?$/,
];
const GRAPHQL_WRITE = /mutation[\s\S]*\b(merge\w*|approve\w*|createCommit\w*|createRef|updateRef|updateRefs|deleteRef|addPullRequestReview|submitPullRequestReview|enablePullRequestAutoMerge|updatePullRequestBranch|createPullRequest)\b/i;

function httpMethod(argv) {
  let method = null;
  let hasBody = false;
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-X' || a === '--request' || a === '--method') method = (argv[k + 1] || '').toUpperCase();
    else if (/^(-X|--request=|--method=)./.test(a)) method = a.replace(/^(-X|--request=|--method=)/, '').toUpperCase();
    else if (/^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--post-data|--post-file|--json|-f|--field|--raw-field|--input)/.test(a)) hasBody = true;
  }
  if (!method && ['http', 'https', 'xh'].includes(basename(argv[0])) && /^[A-Z]+$/.test(argv[1] || '')) method = argv[1];
  return method || (hasBody ? 'POST' : 'GET');
}

function checkEndpoints(urls, method, shown) {
  for (const url of urls) {
    if (ALWAYS_WRITE_ENDPOINTS.some((re) => re.test(url))) return block(shown, 'this API call merges, approves or updates a branch');
    if (method !== 'GET' && method !== 'HEAD' && WRITE_ON_MUTATION_ENDPOINTS.some((re) => re.test(url))) {
      return block(shown, 'this API call creates commits, branches, tags, reviews or merge requests');
    }
  }
  return allow();
}

function checkHttp(argv) {
  const urls = argv.filter((a) => /^https?:\/\//.test(a));
  return urls.length ? checkEndpoints(urls, httpMethod(argv), argv.join(' ')) : allow();
}

const API_VALUE_OPTS = new Set(['-X', '--method', '-H', '--header', '-f', '-F', '--field', '--raw-field', '--input', '-q', '--jq', '-t', '--template', '-p', '--preview', '--hostname', '--cache', '-R', '--repo']);

function checkForgeApi(argv, apiIndex) {
  const shown = argv.join(' ');
  let endpoint = null;
  const fields = [];
  for (let k = apiIndex + 1; k < argv.length; k++) {
    const a = argv[k];
    if (API_VALUE_OPTS.has(a)) {
      if (['-f', '-F', '--field', '--raw-field'].includes(a)) fields.push(argv[k + 1] || '');
      k++;
      continue;
    }
    if (/^--(field|raw-field)=/.test(a)) { fields.push(a.split('=').slice(1).join('=')); continue; }
    if (a.startsWith('-')) continue;
    if (endpoint === null) endpoint = a;
  }
  if (!endpoint) return allow();
  if (/^\/?graphql$/.test(endpoint)) {
    return fields.some((f) => GRAPHQL_WRITE.test(f)) ? block(shown, 'this GraphQL mutation merges, approves or writes git refs') : allow();
  }
  if (fields.some((f) => /^event=APPROVE/i.test(f))) return block(shown, 'this API call approves');
  return checkEndpoints([`/${endpoint.replace(/^\//, '')}`], httpMethod(argv), shown);
}

function checkForge(argv) {
  const head = basename(argv[0]);
  const [sub, action] = [argv[1], argv[2]];
  const shown = argv.join(' ');
  if (head === 'gh') {
    if (sub === 'pr' && ['merge', 'close', 'reopen', 'ready', 'checkout', 'co', 'update-branch', 'create', 'new', 'lock', 'unlock'].includes(action)) {
      return block(shown, 'Ticket2Merge never creates, merges, checks out or changes a PR — the user does');
    }
    if (sub === 'pr' && action === 'review' && argv.some((a) => a === '--approve' || a === '-a')) return block(shown, 'Ticket2Merge never approves');
    if (sub === 'repo' && ['sync', 'delete', 'rename', 'clone', 'fork', 'archive', 'create', 'edit'].includes(action)) return block(shown, 'repository-changing command');
    if (sub === 'release' && ['create', 'delete', 'upload', 'edit'].includes(action)) return block(shown, 'releases create or move tags');
    if (sub === 'api') return checkForgeApi(argv, 1);
  }
  if (head === 'glab') {
    if (sub === 'mr' && ['merge', 'accept', 'approve', 'revoke', 'rebase', 'close', 'reopen', 'checkout', 'create', 'new', 'update'].includes(action)) {
      return block(shown, 'Ticket2Merge never creates, merges, approves, checks out or changes an MR — the user does');
    }
    if (sub === 'repo' && ['clone', 'fork', 'delete', 'archive', 'create', 'mirror', 'transfer'].includes(action)) return block(shown, 'repository-changing command');
    if (sub === 'release' && ['create', 'delete', 'upload'].includes(action)) return block(shown, 'releases create or move tags');
    if (sub === 'api') return checkForgeApi(argv, 1);
  }
  return allow();
}

// --- code: inline, from files, from stdin -----------------------------------------------

const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'deno', 'bun', 'lua', 'Rscript', 'pwsh', 'powershell', 'osascript', 'tclsh']);
const AWKS = new Set(['awk', 'gawk', 'mawk', 'nawk']);
const INLINE_FLAG = /^(-[A-Za-z]*[ecrp]|--eval|--print|--command|-Command|-EncodedCommand)$/;
const GIT_LIBRARIES = /\b(simple-git|isomorphic-git|nodegit|GitPython|pygit2|dulwich|libgit2|rugged|Git::Repository|gitoxide|go-git)\b|(^|[\s;])(import\s+git\b|from\s+git\s+import)/m;
export const WRITE_API = /write|open\s*\([^)]*['"][wax+]|unlink|rename|mkdir|rmdir|\brm(Sync|tree)?\s*\(|remove\s*\(|\bcopy|\bcp(Sync)?\s*\(|move|append|truncate|chmod|symlink|touch|>\s*['"]/i;
const INFO_FLAGS = /^(-v|-V|--version|-h|--help|--test|-m|--check|-c|-i)$/;

function codeVerdict(code, label) {
  if (GIT_LIBRARIES.test(code)) return block(label, 'code loads a git library');
  // git invocations inside the code — execSync('git commit'), spawn('git', ['push']), system("git","push")
  const flat = code.replace(/[[\]'"`,]/g, ' ');
  for (const m of flat.matchAll(/\bgit\s+[^\n;){}]*/g)) {
    const r = gitVerdict(parseLevel(m[0]).commands.map((c) => c.argv));
    if (!r.allow) return block(label, `code runs \`${m[0].trim().slice(0, 60)}\``);
  }
  const lowLevel = /\bgit-(add|commit|push|merge|rebase|reset|checkout|switch|tag|stash|am|apply|cherry-pick|revert|clean|rm|mv|restore|branch|config|fetch|pull|update-ref|worktree)\b/.exec(flat);
  if (lowLevel) return block(label, `code runs \`${lowLevel[0]}\``);
  if (/ticket2merge[\\/]+runs|\.claude[\\/]+ticket2merge/i.test(code)) return block(label, 'code touches Ticket2Merge run state');
  if (/\.gitconfig|[\\/]\.config[\\/]+git[\\/]/.test(code)) return block(label, 'code touches git configuration');
  if (/(^|[^\w-])\.git[\\/]/.test(code) && WRITE_API.test(code)) return block(label, 'code writes inside .git/');
  return allow();
}

function inlineCode(argv) {
  const k = argv.findIndex((a, idx) => idx > 0 && INLINE_FLAG.test(a));
  return k < 0 || argv[k + 1] === undefined ? null : { flag: argv[k], code: argv[k + 1], index: k };
}

function awkProgram(argv) {
  const files = [];
  let program = null;
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-f') { files.push(argv[k + 1]); k++; continue; }
    if (a === '-F' || a === '-v') { k++; continue; }
    if (a.startsWith('-')) continue;
    if (program === null && !files.length) program = a;
  }
  return { program, files };
}

const SCRIPT_MAX = 512 * 1024;
const readScript = (file) => {
  try {
    if (!file || !existsSync(file) || !statSync(file).isFile() || statSync(file).size > SCRIPT_MAX) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const SHEBANG_CODE = /^#!.*\b(node|nodejs|python\d?|perl|ruby|php|deno|bun|lua)\b/;

// --- globs -----------------------------------------------------------------------------

const GLOB = /[*?[\]{}]/;
const escapeRe = (s) => s.replace(/[.+^$()|\\]/g, '\\$&');
function segmentRegex(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const j = seg.indexOf(']', i + 1);
      if (j < 0) { re += '\\['; continue; }
      re += `[${seg.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
      i = j;
    } else if (c === '{') {
      const j = seg.indexOf('}', i + 1);
      if (j < 0) { re += '\\{'; continue; }
      re += `(${seg.slice(i + 1, j).split(',').map((p) => escapeRe(p).replace(/\*/g, '.*').replace(/\?/g, '.')).join('|')})`;
      i = j;
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}
// Could the absolute glob pattern name the protected path, something inside it, or a parent of it?
function globOverlaps(pattern, target) {
  const p = pattern.split('/').filter(Boolean);
  const t = target.split('/').filter(Boolean);
  const n = Math.min(p.length, t.length);
  for (let k = 0; k < n; k++) {
    if (p[k] === '**') return true;
    if (!segmentRegex(p[k]).test(t[k])) return false;
  }
  return true;
}

// --- per-command check, tracking cwd and variables across the command line ------------------

const DANGEROUS_GIT_ENV = /^GIT_(CONFIG|EXTERNAL_DIFF|EXEC_PATH|PAGER|EDITOR|SEQUENCE_EDITOR|SSH|ASKPASS|DIFF_OPTS|TEMPLATE_DIR|DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE)/;
const DECLARERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);
const PACKAGE_RUNNERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
const LIFECYCLE = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' };

function effectiveArgv(argv) {
  const head = basename(argv[0]);
  if (head === 'npx' || head === 'bunx') {
    const rest = argv.slice(1);
    while (rest.length && rest[0].startsWith('-')) rest.shift();
    return rest.length ? rest : argv;
  }
  if ((head === 'pnpm' || head === 'yarn') && argv[1] === 'dlx') return argv.slice(2);
  return argv;
}

const GIT_COMMITTING_TOOLS = [
  (a) => ['npm', 'yarn', 'pnpm'].includes(basename(a[0])) && a[1] === 'version' && !a.includes('--no-git-tag-version'),
  (a) => basename(a[0]) === 'lerna' && ['version', 'publish'].includes(a[1]),
  (a) => ['release-it', 'standard-version', 'semantic-release', 'changeset', 'bumpp', 'np'].includes(basename(a[0])),
];

function packageScript(argv, cwd) {
  const head = basename(argv[0]);
  if (!PACKAGE_RUNNERS.has(head) || !cwd) return null;
  const args = argv.slice(1).filter((a) => !a.startsWith('-'));
  let name = null;
  if (args[0] === 'run' || args[0] === 'run-script' || args[0] === 'rum') name = args[1];
  else if (LIFECYCLE[args[0]]) name = LIFECYCLE[args[0]];
  else if ((head === 'yarn' || head === 'pnpm' || head === 'bun') && args[0] && !['add', 'install', 'remove', 'why', 'info', 'list', 'ls', 'exec', 'dlx', 'x'].includes(args[0])) name = args[0];
  if (!name) return null;
  try {
    const scripts = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {};
    return [scripts[`pre${name}`], scripts[name], scripts[`post${name}`]].filter(Boolean).join(' ; ');
  } catch {
    return null;
  }
}

function protectedCandidates(env, base) {
  const out = [...env.gitConfigs];
  if (env.runsDir) out.push(env.runsDir);
  for (const start of [env.cwd, base].filter(Boolean)) {
    out.push(path.join(start, '.git'));
    for (let d = start; ; d = path.dirname(d)) {
      if (existsSync(path.join(d, '.git'))) { out.push(path.join(d, '.git')); break; }
      if (path.dirname(d) === d) break;
    }
  }
  return out;
}

function protectedWrite(raw, env) {
  if (GLOB.test(raw)) {
    const text = expandText(raw, env);
    if (text === null || env.cwd === null) return 'a glob write target that cannot be resolved';
    const pattern = path.resolve(env.cwd, text);
    const fixed = [];
    for (const seg of pattern.split('/').filter(Boolean)) {
      if (GLOB.test(seg)) break;
      fixed.push(seg);
    }
    const base = realResolve(`/${fixed.join('/')}`);
    if (inDotGit(base)) return 'writes into .git/';
    if (protectedCandidates(env, base).some((c) => globOverlaps(pattern, c))) return 'a glob that can match protected git or Ticket2Merge state';
    return null;
  }
  const abs = resolveWord(raw, env);
  if (abs === null) return 'a write target that cannot be resolved (variable, substitution or unknown directory)';
  if (abs.startsWith('/dev/')) return null;
  if (inDotGit(abs)) return 'writes into .git/';
  if (env.gitConfigs.some((c) => overlaps(abs, c))) return 'changes git configuration';
  if (env.runsDir && overlaps(abs, env.runsDir)) return 'changes Ticket2Merge run state (only its CLI may)';
  return null;
}

function assign(env, word) {
  const i = word.indexOf('=');
  if (i < 1) return;
  const name = word.slice(0, i);
  const value = expandText(word.slice(i + 1), env);
  env.vars[name] = value === null ? undefined : value;
  if (DANGEROUS_GIT_ENV.test(name)) env.gitEnvSet.add(name);
}

function checkCode(code, label, ctx, env, asShell) {
  if (asShell) {
    if ((ctx.depth || 0) >= 4) return block(label, 'scripts nest too deeply to check');
    const r = checkBash(code, { ...ctx, cwd: env.cwd, depth: (ctx.depth || 0) + 1 });
    return r.allow ? r : block(label, `the code it runs is blocked — ${r.reason}`);
  }
  return codeVerdict(code, label);
}

// Code arriving on stdin: heredocs / herestrings / `< file`. A plain pipe cannot be read.
function checkStdinCode(cmd, shown, ctx, env, asShell) {
  const bodies = [...(cmd.heredocs || []), ...(cmd.herestrings || [])];
  const files = (cmd.inputs || []).map((f) => resolveWord(f, env));
  for (const code of bodies) {
    const r = checkCode(code, shown, ctx, env, asShell);
    if (!r.allow) return r;
  }
  for (const f of files) {
    const code = readScript(f);
    if (code === null) return block(shown, 'runs code from stdin that cannot be read');
    const r = checkCode(code, shown, ctx, env, asShell);
    if (!r.allow) return r;
  }
  if (!bodies.length && !files.length) return block(shown, `a ${asShell ? 'shell' : 'interpreter'} reading code from a pipe cannot be checked`);
  return allow();
}

function checkCommand(cmd, ctx, env) {
  const { argv, redirects = [], assigns = [], viaXargs, loopVar } = cmd;
  const shown = argv.join(' ') || assigns.join(' ');

  if (loopVar) env.vars[loopVar] = undefined;
  if (!argv.length) for (const a of assigns) assign(env, a);

  for (const r of redirects) {
    const why = protectedWrite(r, env);
    if (why) return block(`${shown} > ${r}`, why);
    const abs = resolveWord(r, env);
    if (abs) env.created.add(abs);
  }
  if (!argv.length) return allow();

  // Aliases defined earlier on this command line are expanded before anything is judged.
  if (env.aliases[argv[0]]) {
    const expanded = parseLevel(env.aliases[argv[0]]).commands[0];
    if (expanded) return checkCommand({ ...cmd, argv: [...unwrap(expanded.argv), ...argv.slice(1)] }, ctx, { ...env, aliases: { ...env.aliases, [argv[0]]: undefined } });
  }
  const head = basename(argv[0]);
  if (/[$`]/.test(argv[0]) || argv[0].includes(SUB)) return block(shown, 'the program name is dynamic (variable or substitution) and cannot be checked');
  if (GLOB.test(argv[0])) return block(shown, 'the program name is a glob or brace pattern and cannot be checked');

  if (head === 'cd' || head === 'pushd' || head === 'popd') {
    const target = argv.slice(1).find((a) => !/^-[LPe@]+$/.test(a));
    const prev = env.cwd;
    if (head === 'popd') env.cwd = null;
    else if (target === '-') env.cwd = env.vars.OLDPWD ? resolveWord(env.vars.OLDPWD, env) : null;
    else env.cwd = target ? resolveWord(target, env) : env.home;
    env.vars.OLDPWD = prev ?? undefined;
    env.vars.PWD = env.cwd ?? undefined;
    return allow();
  }
  if (DECLARERS.has(head)) {
    for (const a of argv.slice(1)) if (!a.startsWith('-')) assign(env, a);
    return allow();
  }
  if (head === 'alias') {
    for (const a of argv.slice(1)) {
      if (!a.includes('=')) continue;
      const value = a.slice(a.indexOf('=') + 1);
      const r = gitVerdict(parseLevel(value).commands.map((c) => unwrap(c.argv)));
      if (!r.allow) return block(shown, 'defines an alias that runs a blocked git command');
      env.aliases[a.slice(0, a.indexOf('='))] = value;
    }
    return allow();
  }

  const gitArgv = asGitArgv(argv);
  if (gitArgv) {
    const r = checkGitArgs(gitArgv);
    if (!r.allow) return r;
    const bad = assigns.find((a) => DANGEROUS_GIT_ENV.test(a.split('=')[0])) || [...env.gitEnvSet][0];
    if (bad) return block(`${bad} ${shown}`, `\`${bad.split('=')[0]}\` makes git run another program or use injected state`);
  }
  const eff = effectiveArgv(argv);
  if (GIT_COMMITTING_TOOLS.some((t) => t(eff))) return block(shown, 'this tool creates git commits or tags');

  const { targets } = writeTargets(argv);
  for (const t of targets) {
    const why = protectedWrite(t, env);
    if (why) return block(shown, why);
    const abs = resolveWord(t, env);
    if (abs) env.created.add(abs);
  }
  // `… | xargs rm` — the targets arrive on stdin; refuse when the line names protected state.
  if (viaXargs && targets.length === 0 && writeTargets([argv[0], 'x']).targets.length
    && /ticket2merge|\.git([\\/]|\s|$)|gitconfig/.test(env.fullText)) {
    return block(shown, 'writes to files named on stdin next to protected paths');
  }

  if (['curl', 'wget', 'http', 'https', 'xh'].includes(head)) {
    const r = checkHttp(argv);
    if (!r.allow) return r;
  }
  if (head === 'gh' || head === 'glab') {
    const r = checkForge(argv);
    if (!r.allow) return r;
  }
  if (head === 'claude') {
    const readOnly = argv.length === 1 || ['--version', '-v'].includes(argv[1])
      || (argv[1] === 'mcp' && ['list', 'get'].includes(argv[2]))
      || (argv[1] === 'plugin' && ['list', 'validate', 'details'].includes(argv[2]));
    if (!readOnly) return block(shown, 'a nested Claude session would run outside this guard');
  }

  // Shells: -c strings are already expanded by the parser; scripts and stdin are read here.
  if (SHELLS.has(head) || head === 'source' || head === '.') {
    const hasC = argv.some((a, idx) => idx > 0 && /^-[a-z]*c[a-z]*$/.test(a));
    if (!hasC) {
      const operand = argv.slice(1).find((a) => !a.startsWith('-') || a === '-');
      if (operand && operand.includes(SUB)) return block(shown, 'runs code from a substitution that cannot be checked');
      if ((operand === undefined || operand === '-') && head !== 'source' && head !== '.') {
        const r = checkStdinCode(cmd, shown, ctx, env, true);
        if (!r.allow) return r;
      } else if (operand) {
        const abs = resolveWord(operand, env);
        if (abs && env.created.has(abs)) return block(shown, 'a script written and executed in the same command cannot be checked');
        const code = readScript(abs);
        if (code) {
          const r = checkCode(code, shown, ctx, env, true);
          if (!r.allow) return r;
        }
      }
    }
  }

  // awk
  if (AWKS.has(head)) {
    const { program, files } = awkProgram(argv);
    for (const code of [program, ...files.map((f) => readScript(resolveWord(f, env)))].filter(Boolean)) {
      const r = codeVerdict(code, `${head} …`);
      if (!r.allow) return r;
    }
  }

  // Interpreters
  if (INTERPRETERS.has(head)) {
    const inline = inlineCode(argv);
    if (inline) {
      const r = codeVerdict(inline.code, `${head} ${inline.flag} …`);
      if (!r.allow) return r;
      const here = env.cwd;
      if (here && ((env.runsDir && overlaps(here, path.dirname(env.runsDir))) || inDotGit(here)) && WRITE_API.test(inline.code)) {
        return block(`${head} ${inline.flag} …`, 'inline code writing inside protected state');
      }
    } else {
      let file;
      for (let k = 1; k < argv.length; k++) {
        if (argv[k] === '-m') { file = '\u0000module'; break; }
        if (!argv[k].startsWith('-') || argv[k] === '-') { file = argv[k]; break; }
      }
      if (file === undefined || file === '-') {
        if (!argv.slice(1).some((a) => INFO_FLAGS.test(a))) {
          const r = checkStdinCode(cmd, shown, ctx, env, false);
          if (!r.allow) return r;
        }
      } else if (file !== '\u0000module') {
        const abs = resolveWord(file, env);
        if (abs && !(ctx.pluginRoot && inside(abs, ctx.pluginRoot))) {
          if (env.created.has(abs)) return block(shown, 'a script written and executed in the same command cannot be checked');
          const code = readScript(abs);
          if (code !== null) {
            const r = codeVerdict(code, shown);
            if (!r.allow) return r;
          }
        }
      }
    }
  }

  // An executable named by path: read it (the shebang decides how)
  if (argv[0].includes('/')) {
    const abs = resolveWord(argv[0], env);
    if (abs && env.created.has(abs)) return block(shown, 'a script written and executed in the same command cannot be checked');
    const code = abs && !(ctx.pluginRoot && inside(abs, ctx.pluginRoot)) ? readScript(abs) : null;
    if (code && !code.includes('\u0000')) {
      const r = checkCode(code, shown, ctx, env, !SHEBANG_CODE.test(code));
      if (!r.allow) return r;
    }
  }

  const script = packageScript(eff, env.cwd);
  if (script) {
    const r = checkCode(script, shown, ctx, env, true);
    if (!r.allow) return block(shown, `its package.json script is blocked — ${r.reason}`);
  }
  return allow();
}

export function checkBash(command, ctx = {}) {
  if (typeof command !== 'string' || !command.trim()) return allow();
  const procEnv = ctx.env || process.env;
  const home = ctx.home || procEnv.HOME || os.homedir();
  const cwd = ctx.cwd || process.cwd();
  const env = {
    cwd,
    home,
    vars: { ...procEnv, HOME: home, PWD: cwd },
    created: new Set(),
    gitEnvSet: new Set(),
    aliases: {},
    fullText: command,
    gitConfigs: gitConfigPaths(home, procEnv),
    runsDir: ctx.t2mHome ? realResolve(path.join(ctx.t2mHome, 'runs')) : null,
  };
  for (const cmd of allCommands(command)) {
    const r = checkCommand(cmd, ctx, env);
    if (!r.allow) return r;
  }
  return allow();
}
