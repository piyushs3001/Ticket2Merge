// Config precedence: repo `.ticket2merge.json` > user `<T2M_HOME>/config.json` > defaults.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { t2mHome } from './state.mjs';

export const DEFAULTS = {
  autoTrigger: true,
  style: 'brief', // chat output: 'brief' (short, plain words, detail in the report) | 'detailed'
  projectKeys: [],
  reportRoot: null,
  jiraSite: null,
  gitlabUrl: null,
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

export function loadConfig(repoRoot) {
  return {
    ...DEFAULTS,
    ...readJson(path.join(t2mHome(), 'config.json')),
    ...(repoRoot ? readJson(path.join(repoRoot, '.ticket2merge.json')) : {}),
  };
}
