// Gate 1 for the shell: before approval the project repo is read-only.
//
//   * any write target (output redirect, tool operand) inside the repo → blocked
//   * with the working directory inside the repo, only known read-only programs may run
//     (default-deny: installers, generators, build/test runners, migrations and unknown tools
//     all wait for approval)
//   * outside the repo, a non-read-only program may not be pointed at repo paths
//   * code (inline, from a script, from stdin) that writes files is judged by where it runs
//
// With no repo recorded yet, "the repo" is everything outside the safe dirs (report folder, tmp).

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WRITE_API } from './bash-policy.mjs';
import { expandText, inside, looksLikePath, realResolve, resolveWord } from './paths.mjs';
import { allCommands, basename, SHELLS, unwrap } from './shell-parse.mjs';
import { writeTargets } from './write-targets.mjs';

const READ_ONLY = new Set([
  'cat', 'ls', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'du', 'df', 'diff', 'cmp', 'comm', 'cut', 'tr', 'nl', 'column', 'jq', 'xxd', 'od', 'md5sum', 'sha1sum',
  'sha256sum', 'basename', 'dirname', 'realpath', 'readlink', 'pwd', 'echo', 'printf', 'true', 'false',
  'test', '[', '[[', 'which', 'type', 'date', 'printenv', 'id', 'whoami', 'uname', 'hostname', 'git', 'cd',
  'pushd', 'popd', 'sleep', 'read', 'bat', 'batcat', 'fd', 'fdfind', 'exit', 'return', 'set', 'shopt',
  'export', 'declare', 'local', 'alias', 'unset', ':', 'hash', 'getconf', 'env', 'locale', 'nproc', 'free',
  'uptime', 'ps', 'lsof', 'claude',
]);
const WRITE_FLAGS = /^(--fix(=.*)?|--write|-w|--in-place|-i)$/;
const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'deno', 'bun', 'lua']);
const INLINE_FLAG = /^(-[A-Za-z]*[ecrp]|--eval|--print|--command)$/;
const INFO_FLAGS = /^(-v|-V|--version|-h|--help|-l|--syntax-check|--check|-m|-i)$/;

// Program-specific read-only forms.
function readOnlyForm(argv) {
  const head = basename(argv[0]);
  const a1 = argv[1] || '';
  const sub = argv.slice(1).find((x) => !x.startsWith('-')) || '';
  const has = (re) => argv.some((x) => re.test(x));
  const wt = () => writeTargets(argv);
  switch (head) {
    case 'find': {
      if (has(/^-(delete|fprint|fprint0|fprintf|fls)$/)) return false;
      const k = argv.findIndex((x) => /^-(exec|execdir|ok|okdir)$/.test(x));
      return k < 0 || readOnlyForm(argv.slice(k + 1).filter((x) => x !== ';' && x !== '+'));
    }
    case 'sed': return !has(/^(-[a-zA-Z]*i|--in-place)/);
    case 'sort': case 'uniq': case 'tree': return wt().targets.length === 0;
    case 'awk': case 'gawk': case 'mawk': {
      if (has(/^-i$/) || has(/^inplace$/)) return false;
      const prog = argv.slice(1).find((x, i, arr) => !x.startsWith('-') && !['-F', '-v', '-f'].includes(arr[i - 1])) || '';
      return !/system\s*\(|print[^;]*>|\|\s*getline|>\s*"/.test(prog);
    }
    case 'yq': return !has(/^(-i|--inplace)$/);
    case 'curl': case 'wget': return wt().targets.length === 0 && !wt().implicitCwd;
    case 'gh': return ['issue', 'pr', 'repo', 'api', 'auth', 'run', 'release', 'search', 'status'].includes(a1)
      && (['api', 'search', 'status'].includes(a1) || ['view', 'list', 'diff', 'checks', 'status'].includes(argv[2]));
    case 'glab': return ['issue', 'mr', 'repo', 'api', 'auth', 'ci'].includes(a1)
      && (a1 === 'api' || ['view', 'list', 'diff', 'status'].includes(argv[2]));
    case 'php': return has(/^(-l|--syntax-check|-v|--version|-m|-i)$/)
      || (a1 === 'artisan' && /^(route:list|about|list|help|--version|-V|migrate:status|config:show|model:show|db:show|schedule:list|event:list)$/.test(argv[2] || ''))
      || (a1 === 'yii' && /^(help|--version)$/.test(argv[2] || ''));
    case 'node': case 'ruby': case 'perl': return has(/^(-v|-V|--version|--check|-c)$/) && argv.length <= 3; // -c = syntax check here
    case 'python': case 'python2': case 'python3': return has(/^(-V|--version)$/) && argv.length === 2; // python -c RUNS code
    case 'npm': return /^(ls|list|view|info|outdated|explain|why|help|--version|-v|audit|config|doctor|pkg|query)$/.test(a1)
      && !(a1 === 'audit' && argv.includes('fix')) && !(a1 === 'config' && !argv.includes('get') && !argv.includes('list'))
      && !(a1 === 'pkg' && !argv.includes('get'));
    case 'yarn': case 'pnpm': return /^(info|list|ls|why|outdated|audit|--version|-v|config)$/.test(a1) && !argv.includes('set');
    case 'composer': return /^(show|validate|diagnose|outdated|licenses|depends|why|prohibits|why-not|check-platform-reqs|audit|--version|-V|config)$/.test(a1);
    case 'pip': case 'pip3': return /^(list|show|freeze|check|--version|-V|help)$/.test(a1);
    case 'go': return /^(version|env|list|doc|help)$/.test(a1);
    case 'docker': case 'podman': return /^(ps|images|logs|inspect|version|info|stats|top|port)$/.test(sub);
    case 'eslint': case 'stylelint': case 'phpcs': case 'phpstan': case 'psalm': return !has(WRITE_FLAGS);
    case 'prettier': return !has(WRITE_FLAGS) && has(/^(--check|-c|--list-different|-l)$/);
    case 'tsc': return has(/^--noEmit$/);
    case 'mysql': case 'psql': case 'sqlite3': return false;
    default: return READ_ONLY.has(head);
  }
}

// Tools reached through a runner: `npx eslint`, `pnpm dlx x`.
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

function reason(what, why) {
  return {
    allow: false,
    reason:
      `Ticket2Merge: Gate 1 — \`${String(what).slice(0, 140)}\` ${why}, and the plan is not approved yet. ` +
      "Before approval the repo is read-only: present the plan and wait for the user's explicit approval.",
  };
}

// Absolute paths quoted inside code, e.g. open('/repo/src/a.php', 'w').
const quotedAbsPaths = (code) => [...code.matchAll(/['"`](\/[^'"`\s]+)['"`]/g)].map((m) => m[1]);

export function checkBashRepoWrites(command, opts = {}) {
  const { repoRoots = [], cwd = process.cwd(), safeDirs = [], home, env: procEnv, depth = 0 } = opts;
  if (typeof command !== 'string') return { allow: true };
  const envVars = procEnv || process.env;
  const homeDir = home || envVars.HOME || os.homedir();
  const roots = repoRoots.map(realResolve);
  const safe = [...safeDirs.filter(Boolean), os.tmpdir(), '/tmp'].map(realResolve);
  const isProtected = (abs) => {
    if (abs === null) return true; // cannot tell where it goes
    if (abs.startsWith('/dev/')) return false;
    if (roots.length) return roots.some((r) => inside(abs, r));
    return !safe.some((s) => inside(abs, s));
  };
  const env = { cwd: realResolve(cwd), home: homeDir, vars: { ...envVars, HOME: homeDir, PWD: realResolve(cwd) } };
  const resolve = (w) => resolveWord(w, env);
  const isPathArg = (a) => {
    if (a.startsWith('-')) return false;
    if (looksLikePath(a) || /\.[A-Za-z0-9]{1,6}$/.test(a)) return true;
    const abs = resolve(a);
    return abs !== null && existsSync(abs);
  };
  const nestedCheck = (code) => (depth >= 3 ? { allow: false } : checkBashRepoWrites(code, { ...opts, cwd: env.cwd || cwd, depth: depth + 1 }));

  for (const cmd of allCommands(command)) {
    const { argv: rawArgv, redirects, assigns = [], heredocs = [], herestrings = [], inputs = [], loopVar } = cmd;
    if (loopVar) env.vars[loopVar] = undefined;
    if (!rawArgv.length) {
      for (const a of assigns) {
        const i = a.indexOf('=');
        const v = expandText(a.slice(i + 1), env);
        env.vars[a.slice(0, i)] = v === null ? undefined : v;
      }
    }
    const shown = rawArgv.join(' ');
    for (const r of redirects) {
      if (isProtected(resolve(r))) return reason(`${shown} > ${r}`, 'writes into the repo');
    }
    if (!rawArgv.length) continue;
    const head = basename(rawArgv[0]);
    if (head === 'cd' || head === 'pushd' || head === 'popd') {
      const target = rawArgv.slice(1).find((a) => !/^-[LPe@]+$/.test(a));
      const prev = env.cwd;
      if (head === 'popd') env.cwd = null;
      else if (target === '-') env.cwd = env.vars.OLDPWD ? resolve(env.vars.OLDPWD) : null;
      else env.cwd = target ? resolve(target) : homeDir;
      env.vars.OLDPWD = prev ?? undefined;
      env.vars.PWD = env.cwd ?? undefined;
      continue;
    }
    if (['export', 'declare', 'typeset', 'readonly', 'local'].includes(head)) {
      for (const a of rawArgv.slice(1)) {
        if (a.startsWith('-') || !a.includes('=')) continue;
        const i = a.indexOf('=');
        const v = expandText(a.slice(i + 1), env);
        env.vars[a.slice(0, i)] = v === null ? undefined : v;
      }
      continue;
    }
    const argv = effectiveArgv(unwrap(rawArgv));
    const prog = basename(argv[0]);
    const cwdProtected = env.cwd === null || isProtected(env.cwd);

    // write targets named by the command itself
    const { targets, implicitCwd } = writeTargets(argv);
    for (const t of targets) {
      if (isProtected(resolve(t))) return reason(shown, 'writes into the repo');
    }
    // a known writer whose every target is outside the repo writes nothing into it
    if (targets.length && !implicitCwd) continue;
    if (readOnlyForm(argv)) continue;

    // a program that lives in the repo is repo code
    if (argv[0].includes('/') && isProtected(resolve(argv[0]))) return reason(shown, 'runs a program from the repo');

    // shells: script operand or stdin code
    if (SHELLS.has(prog) || prog === 'source' || prog === '.') {
      const operand = argv.slice(1).find((a) => !a.startsWith('-'));
      if (operand && isProtected(resolve(operand))) return reason(shown, 'runs a script from the repo');
      for (const code of [...heredocs, ...herestrings]) {
        const r = nestedCheck(code);
        if (!r.allow) return reason(shown, 'runs shell code that writes into the repo');
      }
      if (!operand && !heredocs.length && !herestrings.length && !inputs.length && cwdProtected) {
        return reason(shown, 'runs shell code from a pipe inside the repo');
      }
      continue;
    }

    // interpreters: inline / script / stdin
    if (INTERPRETERS.has(prog)) {
      const k = argv.findIndex((a, idx) => idx > 0 && INLINE_FLAG.test(a));
      if (k > 0) {
        const code = argv[k + 1] || '';
        const writes = WRITE_API.test(code);
        if (writes && (cwdProtected || quotedAbsPaths(code).some((p) => isProtected(resolve(p))))) {
          return reason(shown, 'runs inline code that writes files');
        }
        continue;
      }
      let file;
      for (let j = 1; j < argv.length; j++) {
        if (argv[j] === '-m') { file = '\u0000module'; break; }
        if (!argv[j].startsWith('-')) { file = argv[j]; break; }
      }
      if (file === '\u0000module') {
        if (cwdProtected) return reason(shown, 'runs a module (tests, tools) inside the repo');
        continue;
      }
      if (file === undefined) {
        if (argv.slice(1).some((a) => INFO_FLAGS.test(a))) continue;
        const code = [...heredocs, ...herestrings].join('\n');
        if (cwdProtected && (WRITE_API.test(code) || (!heredocs.length && !herestrings.length))) {
          return reason(shown, 'runs code from stdin inside the repo');
        }
        continue;
      }
      if (isProtected(resolve(file))) return reason(shown, 'runs a script from the repo');
      if (argv.slice(1).filter(isPathArg).some((a) => a !== file && isProtected(resolve(a)))) {
        return reason(shown, 'is pointed at repo paths');
      }
      continue;
    }

    if (cwdProtected) return reason(shown, 'is not a known read-only tool and runs inside the repo');
    if (argv.slice(1).filter(isPathArg).some((a) => isProtected(resolve(a)))) {
      return reason(shown, 'is not a read-only tool and targets the repo');
    }
  }
  return { allow: true };
}
