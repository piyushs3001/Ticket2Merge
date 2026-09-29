// Which operands of a command are files it writes, moves or deletes.

import { basename } from './shell-parse.mjs';

const ALL_OPERANDS = new Set(['rm', 'rmdir', 'mv', 'tee', 'touch', 'mkdir', 'truncate', 'unlink', 'shred', 'sponge']);
const COMPRESSORS = new Set(['gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zstd', 'unzstd', 'lzma', 'compress']);
const DEST_LAST = new Set(['cp', 'install', 'rsync', 'ln', 'scp']);
const MODE_FIRST = new Set(['chmod', 'chown', 'chgrp']);
const VALUE_FLAGS = { truncate: new Set(['-s', '--size', '-r', '--reference']), install: new Set(['-m', '-o', '-g', '-t']) };

const operands = (argv, valueFlags = new Set()) => {
  const out = [];
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k];
    if (valueFlags.has(a)) { k++; continue; }
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
};

// `sed -i` / `perl -pi`: drop the script (after -e, or the first operand when no -e).
function inPlaceFiles(argv) {
  const files = [];
  let sawScriptFlag = false;
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-e' || a === '--expression' || /^-[a-z]*e$/.test(a)) { sawScriptFlag = true; k++; continue; }
    if (a.startsWith('-')) continue;
    files.push(a);
  }
  return sawScriptFlag ? files : files.slice(1);
}

const flagValue = (argv, names) => {
  const out = [];
  argv.forEach((a, k) => {
    for (const n of names) {
      if (a === n && argv[k + 1] !== undefined) out.push(argv[k + 1]);
      else if (n.startsWith('--') && a.startsWith(`${n}=`)) out.push(a.slice(n.length + 1));
      else if (!n.startsWith('--') && a.startsWith(n) && a.length > n.length && /^-[a-zA-Z]$/.test(n)) out.push(a.slice(n.length));
    }
  });
  return out;
};

// Returns { targets: string[], implicitCwd: boolean }.
export function writeTargets(argv) {
  const head = basename(argv[0]);
  const none = { targets: [], implicitCwd: false };
  if (!head) return none;
  if (ALL_OPERANDS.has(head)) return { targets: operands(argv, VALUE_FLAGS[head]), implicitCwd: false };
  if (DEST_LAST.has(head)) {
    const t = flagValue(argv, ['-t', '--target-directory']);
    const ops = operands(argv, VALUE_FLAGS[head]);
    return { targets: t.length ? t : ops.slice(-1), implicitCwd: false };
  }
  if (MODE_FIRST.has(head)) return { targets: operands(argv).slice(1), implicitCwd: false };
  if (head === 'dd') return { targets: argv.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)), implicitCwd: false };
  if (COMPRESSORS.has(head)) {
    // in place unless writing to stdout / only listing or testing
    return argv.some((a) => /^(-[a-zA-Z]*[clt][a-zA-Z]*|--stdout|--to-stdout|--list|--test)$/.test(a))
      ? { targets: [], implicitCwd: false }
      : { targets: operands(argv), implicitCwd: false };
  }
  if (head === 'sort' || head === 'uniq' || head === 'tree') {
    const out = flagValue(argv, head === 'tree' ? ['-o'] : ['-o', '--output']);
    const ops = operands(argv, new Set(['-k', '-t', '-S', '-T', '-f', '-s', '-w', '-L', '-P', '-I']));
    return { targets: head === 'uniq' && ops.length > 1 ? [ops[1]] : out, implicitCwd: false };
  }
  if (head === 'find') {
    const roots = [];
    for (let k = 1; k < argv.length && !/^[-(!]/.test(argv[k]); k++) roots.push(argv[k]);
    const t = flagValue(argv, ['-fprint', '-fprint0', '-fprintf', '-fls']);
    if (argv.includes('-delete')) t.push(...(roots.length ? roots : ['.']));
    return { targets: t, implicitCwd: false };
  }
  if (head === 'tar' && argv.some((a) => /^-?[a-zA-Z]*[cru]/.test(a) || /^--(create|append|update)$/.test(a)) && !argv.some((a) => /^-?[a-zA-Z]*x/.test(a) || a === '--extract')) {
    return { targets: flagValue(argv, ['-f', '--file']), implicitCwd: false };
  }
  if ((head === 'yq' || head === 'jq') && argv.some((a) => /^(-i|--inplace|--in-place)$/.test(a))) {
    return { targets: operands(argv).slice(1), implicitCwd: false };
  }
  if ((head === 'sed' && argv.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a))) || (head === 'perl' && argv.some((a) => /^-[a-zA-Z]*i/.test(a)))) {
    return { targets: inPlaceFiles(argv), implicitCwd: false };
  }
  if (head === 'curl') {
    const t = flagValue(argv, ['-o', '--output', '-D', '--dump-header', '-c', '--cookie-jar']).filter((v) => v !== '-');
    const remoteName = argv.some((a) => a === '-O' || a === '--remote-name' || a === '--remote-name-all' || /^-[a-zA-Z]*O[a-zA-Z]*$/.test(a));
    return { targets: t, implicitCwd: remoteName };
  }
  if (head === 'wget') {
    const t = flagValue(argv, ['-O', '--output-document', '-P', '--directory-prefix', '-o', '--output-file']);
    const toStdout = t.includes('-') || argv.some((a) => /^-q?O-$/.test(a) || a === '--spider');
    return { targets: t.filter((v) => v !== '-'), implicitCwd: !toStdout && t.length === 0 };
  }
  if (head === 'tar' && argv.some((a) => /^-?[a-zA-Z]*x/.test(a) || a === '--extract')) {
    const t = flagValue(argv, ['-C', '--directory']);
    return { targets: t, implicitCwd: t.length === 0 };
  }
  if (head === 'unzip') {
    const t = flagValue(argv, ['-d']);
    return { targets: t, implicitCwd: t.length === 0 };
  }
  if (head === 'patch') return { targets: flagValue(argv, ['-o', '--output', '-d', '--directory']), implicitCwd: true };
  return none;
}
