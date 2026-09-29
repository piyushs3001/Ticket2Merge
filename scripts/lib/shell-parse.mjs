// Conservative shell tokenizer for policy checks — not a full POSIX parser.
// It errs toward surfacing MORE commands (nested substitutions, wrapped programs, command
// strings in arguments), because a false block is recoverable and a missed git write is not.
//
// Each command is { argv, assigns, redirects, inputs, heredocs, herestrings, viaXargs }:
//   redirects   — output targets (>, >>, >|, &>, >&file)
//   inputs      — files read by <
//   heredocs    — bodies of <<DELIM (raw text; only meaningful when the program is a shell/interpreter)
//   herestrings — words given with <<<

import { SUB } from './paths.mjs';

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);

function readBalanced(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      i = j < 0 ? src.length : j + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return [src.slice(start, i), i + 1];
    }
    i++;
  }
  return [src.slice(start), src.length];
}

function readBacktick(src, start) {
  const j = src.indexOf('`', start);
  return j < 0 ? [src.slice(start), src.length] : [src.slice(start, j), j + 1];
}

const ANSI_ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

// $'…' — ANSI-C quoting. Returns [decoded, indexAfterClosingQuote].
function readAnsiC(src, start) {
  let out = '';
  let i = start;
  while (i < src.length && src[i] !== "'") {
    if (src[i] === '\\' && i + 1 < src.length) {
      const e = src[i + 1];
      if (e === 'x') {
        const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 2));
        if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
      }
      if (/[0-7]/.test(e)) {
        const m = /^[0-7]{1,3}/.exec(src.slice(i + 1));
        out += String.fromCharCode(parseInt(m[0], 8));
        i += 1 + m[0].length;
        continue;
      }
      out += ANSI_ESCAPES[e] ?? `\\${e}`;
      i += 2;
      continue;
    }
    out += src[i];
    i++;
  }
  return [out, i + 1];
}

function newCommand() {
  return { argv: [], redirects: [], inputs: [], heredocs: [], herestrings: [] };
}

// Parses one level. Returns { commands, nested: [string] }.
export function parseLevel(src) {
  const commands = [];
  const nested = [];
  let cur = newCommand();
  let word = null;
  let pending = null; // 'out' | 'in' | 'herestring' | 'heredoc'
  let pendingHeredocs = []; // [{ cmd, delim, stripTabs }]
  let i = 0;

  const pushWord = () => {
    if (word === null) return;
    if (pending === 'out') cur.redirects.push(word);
    else if (pending === 'in') cur.inputs.push(word);
    else if (pending === 'herestring') cur.herestrings.push(word);
    else if (pending === 'heredoc') pendingHeredocs[pendingHeredocs.length - 1].delim = word;
    else cur.argv.push(word);
    pending = null;
    word = null;
  };
  const endCommand = () => {
    pushWord();
    if (cur.argv.length || cur.redirects.length || cur.inputs.length || cur.heredocs.length || cur.herestrings.length) commands.push(cur);
    cur = newCommand();
  };
  const append = (s) => { word = (word ?? '') + s; };

  // After a newline, consume the bodies of any heredocs opened on that line.
  const consumeHeredocs = () => {
    for (const h of pendingHeredocs) {
      const lines = [];
      while (i < src.length) {
        let end = src.indexOf('\n', i);
        if (end < 0) end = src.length;
        const line = src.slice(i, end);
        i = end + 1;
        const cmp = h.stripTabs ? line.replace(/^\t+/, '') : line;
        if (cmp === h.delim) break;
        lines.push(line);
      }
      h.cmd.heredocs.push(lines.join('\n'));
    }
    pendingHeredocs = [];
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '\\') {
      if (next === '\n') { i += 2; continue; }
      append(next ?? '');
      i += 2;
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? src.length : j;
      append(src.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '$' && next === "'") {
      const [decoded, end] = readAnsiC(src, i + 2);
      append(decoded);
      i = end;
      continue;
    }
    if (c === '"') {
      i++;
      append('');
      while (i < src.length && src[i] !== '"') {
        const d = src[i];
        if (d === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          append(src[i + 1]);
          i += 2;
          continue;
        }
        if (d === '$' && src[i + 1] === '(') {
          const [inner, end] = readBalanced(src, i + 2);
          nested.push(inner);
          append(SUB);
          i = end;
          continue;
        }
        if (d === '`') {
          const [inner, end] = readBacktick(src, i + 1);
          nested.push(inner);
          append(SUB);
          i = end;
          continue;
        }
        append(d);
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' && next === '(') {
      const arithmetic = src[i + 2] === '(';
      const [inner, end] = readBalanced(src, i + 2);
      // Arithmetic never runs commands itself, but a $( ) inside it does — parse it either way.
      nested.push(arithmetic ? inner.replace(/^\(/, '').replace(/\)$/, '') : inner);
      append(SUB);
      i = end;
      continue;
    }
    if (c === '`') {
      const [inner, end] = readBacktick(src, i + 1);
      nested.push(inner);
      append(SUB);
      i = end;
      continue;
    }
    if ((c === '<' || c === '>') && next === '(') {
      const [inner, end] = readBalanced(src, i + 2);
      nested.push(inner);
      append(SUB);
      i = end;
      continue;
    }
    if (c === '#' && word === null) {
      const j = src.indexOf('\n', i);
      i = j < 0 ? src.length : j;
      continue;
    }
    if (c === ' ' || c === '\t') {
      pushWord();
      i++;
      continue;
    }
    if (c === '&' && next === '>') {
      pushWord();
      pending = 'out';
      i += src[i + 2] === '>' ? 3 : 2;
      continue;
    }
    if (c === '>' || c === '<') {
      if (word !== null && /^\d+$/.test(word)) word = null;
      else pushWord();
      if (c === '<' && next === '<') {
        if (src[i + 2] === '<') {
          i += 3;
          pending = 'herestring';
          continue;
        }
        i += 2;
        const stripTabs = src[i] === '-';
        if (stripTabs) i++;
        pendingHeredocs.push({ cmd: cur, delim: '', stripTabs });
        pending = 'heredoc';
        continue;
      }
      i++;
      if (c === '>' && (src[i] === '>' || src[i] === '|')) i++;
      if (src[i] === '&') {
        i++;
        if (/[0-9-]/.test(src[i] || '')) {
          while (i < src.length && /[0-9-]/.test(src[i])) i++; // fd duplication like 2>&1
          continue;
        }
        pending = c === '>' ? 'out' : 'in'; // >&file writes to a file
        continue;
      }
      pending = c === '>' ? 'out' : 'in';
      continue;
    }
    if (SEPARATORS.has(c)) {
      endCommand();
      i++;
      if (c === '\n' && pendingHeredocs.length) consumeHeredocs();
      continue;
    }
    append(c);
    i++;
  }
  endCommand();
  if (pendingHeredocs.length) consumeHeredocs();
  return { commands, nested };
}

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'case', 'esac', '!', '{', '}', 'coproc']);
export const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'mksh', 'ash']);

// Wrappers that run another program, with the options that take a separate value.
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D', '-R', '-T', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from', '--command-timeout']),
  doas: new Set(['-u', '-C']),
  command: new Set(),
  builtin: new Set(),
  exec: new Set(['-a']),
  nohup: new Set(),
  chronic: new Set(),
  stdbuf: new Set(['-i', '-o', '-e']),
  ionice: new Set(['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid']),
  nice: new Set(['-n', '--adjustment']),
  unbuffer: new Set(),
  busybox: new Set(),
  toybox: new Set(),
  setsid: new Set(),
  caffeinate: new Set(['-t', '-w']),
  watch: new Set(['-n', '--interval', '-q', '--equexit']),
  unshare: new Set(['-S', '-G', '-R', '-w', '--setuid', '--setgid', '--root', '--wd']),
  nsenter: new Set(['-t', '-S', '-G', '--target', '--setuid', '--setgid']),
  'systemd-run': new Set(['-p', '-u', '-E', '--property', '--unit', '--setenv', '--description', '--slice', '-M', '--machine']),
  firejail: new Set(),
  proxychains: new Set(['-f']),
  torsocks: new Set(),
  strace: new Set(['-e', '-o', '-p', '-s', '-u']),
  ltrace: new Set(['-e', '-o', '-p', '-s', '-u']),
  parallel: new Set(['-j', '--jobs', '-S', '--sshlogin', '--joblog']),
};
const TIME_VALUE_OPTS = new Set(['-f', '-o', '--format', '--output']);
const XARGS_VALUE_OPTS = new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace']);
const TIMEOUT_VALUE_OPTS = new Set(['-s', '-k', '--signal', '--kill-after']);
const ENV_VALUE_OPTS = new Set(['-u', '--unset', '-C', '--chdir']);

export const basename = (w) => (w || '').split('/').pop();
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

function skipOptions(a, valueOpts) {
  let k = 0;
  while (k < a.length && a[k].startsWith('-') && a[k] !== '-') {
    if (a[k] === '--') { k++; break; }
    k += valueOpts.has(a[k]) ? 2 : 1;
  }
  return a.slice(k);
}

export function unwrap(argv) {
  return unwrapFull(argv).argv;
}

// Strips keywords, env assignments and exec-wrappers so argv[0] is the real program.
export function unwrapFull(argv) {
  let a = [...argv];
  const assigns = [];
  let viaXargs = false;
  for (let guard = 0; guard < 30 && a.length; guard++) {
    const head = basename(a[0]);
    if (a[0] === 'for' || a[0] === 'select') return { argv: [], assigns, viaXargs, loopVar: a[1] };
    if (a[0] === 'function') { a = a.slice(2); continue; }
    if (a[0] === 'time') { a = skipOptions(a.slice(1), TIME_VALUE_OPTS); continue; }
    if (KEYWORDS.has(a[0])) { a = a.slice(1); continue; }
    if (ASSIGN.test(a[0])) { assigns.push(a[0]); a = a.slice(1); continue; }
    if (head === 'env') {
      a = a.slice(1);
      while (a.length) {
        if (a[0] === '-S' || a[0] === '--split-string') {
          a = [...(a[1] || '').split(/\s+/).filter(Boolean), ...a.slice(2)];
          continue;
        }
        if (a[0].startsWith('--split-string=')) { a = [...a[0].slice(15).split(/\s+/).filter(Boolean), ...a.slice(1)]; continue; }
        if (ENV_VALUE_OPTS.has(a[0])) { a = a.slice(2); continue; }
        if (a[0].startsWith('-')) { a = a.slice(1); continue; }
        if (ASSIGN.test(a[0])) { assigns.push(a[0]); a = a.slice(1); continue; }
        break;
      }
      continue;
    }
    if (head === 'command' && (a[1] === '-v' || a[1] === '-V')) return { argv: [], assigns, viaXargs };
    if (Object.hasOwn(WRAPPERS, head)) {
      a = skipOptions(a.slice(1), WRAPPERS[head]);
      continue;
    }
    if (head === 'timeout') {
      a = skipOptions(a.slice(1), TIMEOUT_VALUE_OPTS).slice(1); // then the duration
      continue;
    }
    if (head === 'xargs') {
      viaXargs = true;
      a = skipOptions(a.slice(1), XARGS_VALUE_OPTS);
      continue;
    }
    if (head === 'chroot') {
      a = skipOptions(a.slice(1), new Set(['--userspec', '--groups'])).slice(1);
      continue;
    }
    break;
  }
  return { argv: a, assigns, viaXargs };
}

const SSH_VALUE_OPTS = new Set(['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-b', '-c', '-e', '-m', '-O', '-Q', '-S', '-W', '-w', '-E', '-B', '-I']);
const CONTAINER_VALUE_OPTS = new Set(['-e', '--env', '-w', '--workdir', '-u', '--user', '--env-file', '--name', '-v', '--volume', '-p', '--publish', '--entrypoint', '--network', '-c', '--container', '-n', '--namespace', '--index', '-f', '--file', '-l', '--label']);

// Commands whose arguments carry another command, which must be checked too.
function carriedCommands(argv) {
  const head = basename(argv[0]);
  const strings = [];
  const argvs = [];
  if (SHELLS.has(head)) {
    const k = argv.findIndex((w, idx) => idx > 0 && /^-[a-z]*c[a-z]*$/.test(w));
    if (k > 0 && argv[k + 1] !== undefined) strings.push(argv[k + 1]);
  }
  if (head === 'eval' && argv.length > 1) strings.push(argv.slice(1).join(' '));
  if (head === 'trap' && argv[1] && !argv[1].startsWith('-')) strings.push(argv[1]);
  if (head === 'su' || head === 'runuser') {
    const k = argv.findIndex((w) => w === '-c' || w === '--command');
    if (k > 0 && argv[k + 1] !== undefined) strings.push(argv[k + 1]);
  }
  if (head === 'script') {
    const k = argv.findIndex((w, idx) => idx > 0 && (/^-[a-z]*c$/.test(w) || w === '--command'));
    if (k > 0 && argv[k + 1] !== undefined) strings.push(argv[k + 1]);
  }
  if (head === 'ssh') {
    const rest = skipOptions(argv.slice(1), SSH_VALUE_OPTS);
    if (rest.length > 1) strings.push(rest.slice(1).join(' '));
  }
  if (/^(docker|podman|nerdctl|kubectl|oc|lxc)$/.test(head)) {
    const k = argv.findIndex((w, idx) => idx > 0 && (w === 'exec' || w === 'run'));
    if (k > 0) {
      let rest = skipOptions(argv.slice(k + 1), CONTAINER_VALUE_OPTS).slice(1); // container / service / image
      if (rest[0] === '--') rest = rest.slice(1);
      if (rest.length) argvs.push(rest);
    }
  }
  if (head === 'find') {
    const roots = [];
    for (let j = 1; j < argv.length && !/^[-(!]/.test(argv[j]); j++) roots.push(argv[j]);
    argv.forEach((w, idx) => {
      if (/^-(exec|execdir|ok|okdir)$/.test(w)) {
        const rest = [];
        for (let j = idx + 1; j < argv.length && argv[j] !== ';' && argv[j] !== '+'; j++) rest.push(argv[j]);
        // {} stands for the files found under the roots
        for (const root of roots.length ? roots : ['.']) argvs.push(rest.map((x) => x.replace(/\{\}/g, root)));
      }
    });
  }
  return { strings, argvs };
}

// Every simple command the source could execute.
export function allCommands(src, depth = 0) {
  if (depth > 8) return [];
  const { commands, nested } = parseLevel(src);
  const out = [];
  const expand = (raw, d) => {
    const { argv, assigns, viaXargs, loopVar } = unwrapFull(raw.argv);
    out.push({ ...raw, argv, assigns, viaXargs, loopVar });
    if (d > 8 || !argv.length) return;
    const { strings, argvs } = carriedCommands(argv);
    for (const s of strings) out.push(...allCommands(s, d + 1));
    for (const a of argvs) expand({ ...newCommand(), argv: a }, d + 1);
  };
  for (const raw of commands) expand(raw, depth);
  for (const inner of nested) out.push(...allCommands(inner, depth + 1));
  return out;
}
