// Path resolution shared by every policy: ~ and $VAR expansion, cwd-relative paths, and
// symlinks resolved through the nearest existing ancestor — so a link or a `cd` cannot
// make a protected path look like an unprotected one.

import { realpathSync } from 'node:fs';
import path from 'node:path';

export const SUB = '\u0000SUB\u0000'; // placeholder the shell parser leaves for $( ) / backticks

export function inside(file, dir) {
  if (!file || !dir) return false;
  const rel = path.relative(dir, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export const overlaps = (a, b) => inside(a, b) || inside(b, a);

export function realResolve(p) {
  const abs = path.resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

// Expands ~ / $VAR / ${VAR} in a word. Returns null when anything cannot be resolved
// (unknown variable, command substitution) — callers treat null as "could be anywhere".
export function expandText(word, { home, vars = {} }) {
  if (word.includes(SUB)) return null;
  let w = word;
  if (home && (w === '~' || w.startsWith('~/'))) w = home + w.slice(1);
  let unresolved = false;
  w = w.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => {
    const v = vars[a || b];
    if (v === undefined) {
      unresolved = true;
      return '';
    }
    return v;
  });
  if (unresolved || w.includes('$')) return null;
  return w;
}

export function resolveWord(word, { cwd, home, vars }) {
  const text = expandText(word, { home, vars });
  if (text === null || cwd === null) return null;
  return realResolve(path.resolve(cwd, text));
}

export const looksLikePath = (w) => /[/~$]/.test(w) || w.startsWith('.') || w.includes(SUB);

const DOT_GIT_SEGMENT = /(^|[\\/])\.git([\\/]|$)/;
export const inDotGit = (abs) => DOT_GIT_SEGMENT.test(abs);

export function gitConfigPaths(home, env = {}) {
  const xdg = env.XDG_CONFIG_HOME || (home && path.join(home, '.config'));
  return [home && path.join(home, '.gitconfig'), xdg && path.join(xdg, 'git'), '/etc/gitconfig']
    .filter(Boolean)
    .map(realResolve);
}
