// Classifies the user's prompt: explicit /ticket2merge command, a dropped Jira ticket,
// an explicit approval, or a commit report. Pure functions — no I/O.

const KEY_RE = /\b([A-Za-z][A-Za-z0-9_]{1,9})-(\d+)\b/g;
const JIRA_URL_RE = /https?:\/\/\S*?(?:\/browse\/|[?&]selectedIssue=)([A-Za-z][A-Za-z0-9_]{1,9}-\d+)\S*/gi;
const COMMAND_RE = /^\/ticket2merge(?::ticket2merge)?(?=\s|$)\s*([\s\S]*)$/i;
const COMMAND_ACTIONS = new Set(['start', 'stop', 'status', 'resume']);

// Hyphen-number tokens that are standards and versions, not Jira keys.
const NOT_TICKET_PREFIXES = new Set([
  'UTF', 'SHA', 'ISO', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'COVID', 'ES', 'RFC', 'PEP', 'CVE', 'MD',
  'AES', 'RSA', 'IPV', 'WCAG', 'GPT', 'MP', 'ECMA', 'PHP', 'PSR', 'NODE', 'IE', 'SARS', 'X', 'H',
  'WIN', 'CP', 'BASE', 'INT', 'UINT', 'FLOAT', 'ARM', 'STEP', 'PAGE', 'ROW', 'COL', 'TOP', 'LEVEL',
  'OPUS', 'SONNET', 'HAIKU', 'CLAUDE', 'GEMINI', 'VUE', 'REACT', 'LARAVEL', 'YII',
]);

// Words that may surround a ticket key without changing the intent "work on this ticket".
const INTENT_WORDS = new Set([
  'implement', 'work', 'working', 'on', 'start', 'begin', 'do', 'fix', 'build', 'develop', 'pick',
  'up', 'take', 'handle', 'complete', 'resolve', 'solve', 'ticket', 'jira', 'issue', 'task', 'story',
  'bug', 'please', 'pls', 'plz', 'this', 'the', 'a', 'new', 'next', 'lets', "let's", 'let', 'us', 'go',
  'with', 'for', 'me', 'can', 'you', 'could', 'now', 'here', 'is', 'it', 'kindly', 'and', 'end', 'to',
  'here\'s', 'heres', 'one',
]);

// On a line that starts with the ticket, these phrases mean another skill's request.
const REQUEST_EXCLUDES = [
  /\b(post|leave|write)\s+(a\s+)?comment\b/,
  /\bcomment\s*[:-]/,
  /\brepl(y|ies)\b/,
  /\btest\s?cases?\b/,
  /\b(mr|pr|merge request|pull request)\b/,
  /\bweekly report\b|\brelease notes?\b/,
  /^\S+\s+(info|details?|status|priority|labels?|reporter|fields?)\b/,
];

const uniq = (xs) => [...new Set(xs)];

function extractKeys(text, cfg) {
  const found = [];
  let url = null;
  for (const m of text.matchAll(JIRA_URL_RE)) {
    found.push({ key: m[1].toUpperCase(), upper: true });
    url = url ?? m[0];
  }
  const withoutUrls = text.replace(JIRA_URL_RE, ' ');
  for (const m of withoutUrls.matchAll(KEY_RE)) {
    found.push({ key: `${m[1].toUpperCase()}-${m[2]}`, upper: m[1] === m[1].toUpperCase() });
  }
  const allowed = found.filter(({ key }) => {
    const prefix = key.split('-')[0];
    if (NOT_TICKET_PREFIXES.has(prefix)) return false;
    if (Array.isArray(cfg.projectKeys) && cfg.projectKeys.length) {
      return cfg.projectKeys.map((k) => k.toUpperCase()).includes(prefix);
    }
    return true;
  });
  return { keys: uniq(allowed.map((k) => k.key)), anyLower: allowed.some((k) => !k.upper), url, withoutUrls };
}

export function classifyPrompt(prompt, cfg = {}) {
  const text = (prompt || '').trim();
  if (!text) return null;

  const cmd = COMMAND_RE.exec(text);
  if (cmd) {
    let rest = cmd[1].trim();
    let action = 'start';
    const first = rest.split(/\s+/)[0]?.toLowerCase();
    if (COMMAND_ACTIONS.has(first)) {
      action = first;
      rest = rest.slice(first.length).trim();
    }
    const { keys, url } = extractKeys(rest, {});
    return { kind: 'command', action, key: keys[0] ?? null, url, arg: rest };
  }

  if (cfg.autoTrigger === false) return null;

  // Naming the plugin is an explicit request, so the projectKeys filter does not apply.
  const explicit = /\b(ticket2merge|t2m)\b/i.test(text);
  const { keys, anyLower, url, withoutUrls } = extractKeys(text, explicit ? {} : cfg);
  if (keys.length !== 1) return null;
  const hit = { kind: 'ticket', key: keys[0], url };

  if (explicit) return hit;

  const remainder = withoutUrls.replace(KEY_RE, ' ').toLowerCase();
  const words = remainder.match(/[a-z][a-z']*/g) || [];
  if (words.every((w) => INTENT_WORDS.has(w))) return hit;
  if (anyLower) return null;

  // Title or pasted ticket body: the prompt must open with the ticket itself.
  const firstLine = text.split('\n')[0].trim();
  const opensWithTicket = /^(https?:\/\/\S+|[A-Z][A-Z0-9_]{1,9}-\d+)\b/.test(firstLine);
  if (!opensWithTicket) return null;
  const lower = firstLine.toLowerCase();
  if (lower.includes('?')) return null;
  if (REQUEST_EXCLUDES.some((re) => re.test(lower))) return null;
  return hit;
}

// --- approval ---------------------------------------------------------------------

const APPROVAL_UNIT = /^(approve|approved|implement|proceed)$/;

export function isExplicitApproval(prompt) {
  const s = (prompt || '').toLowerCase().trim().replace(/[.!]+$/, '');
  if (!s) return false;
  const tokens = s.replace(/[,;]+/g, ' ').split(/\s+/).filter(Boolean);
  let i = 0;
  if (['yes', 'ok', 'okay'].includes(tokens[0])) i = 1;
  let units = 0;
  while (i < tokens.length) {
    if (APPROVAL_UNIT.test(tokens[i])) { units++; i++; continue; }
    if (tokens[i] === 'go' && tokens[i + 1] === 'ahead') { units++; i += 2; continue; }
    return false;
  }
  return units > 0;
}

export function isConditionalApproval(prompt) {
  const s = (prompt || '').toLowerCase();
  if (!s.trim() || isExplicitApproval(prompt) || s.includes('?')) return false;
  if (/\b(don'?t|do not|not|never)\s+(yet\s+)?(approve|proceed|implement|go ahead)/.test(s)) return false;
  return /\b(approve|approved|go ahead|proceed|implement)\b/.test(s);
}

// --- commit report ----------------------------------------------------------------

export function reportsCommit(prompt) {
  const s = (prompt || '').toLowerCase();
  if (s.includes('?') || /\bnot\s+(yet\s+)?committed\b/.test(s)) return false;
  return /\bcommitted\b/.test(s);
}
