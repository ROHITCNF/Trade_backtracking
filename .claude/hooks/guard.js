#!/usr/bin/env node
// PreToolUse guard for Claude's Bash calls (.claude/settings.json).
//
// .env's DATABASE_URL is production Neon, and src/env.js fills any variable the
// command didn't set itself. So anything that opens the database must set
// DATABASE_URL (or TEST_DATABASE_URL) inline to a local server, or it is denied.
// Scripts that spend the Fyers daily budget ask first (3 rate-limit breaches in
// a day block the account, live runner included).
//
// classify() is pure so test/guard.test.js can pin its behaviour.

const LOCAL = /(localhost|127\.0\.0\.1|\/tmp\b|@postgres:)/;

// Commands that load .env and open DATABASE_URL.
const DB_COMMANDS = [
  /\bnpm\s+run\s+(migrate|api)\b/,
  /\bnode\s+(\.\/)?api\/server\.js\b/,
  /\bnode\s+(\.\/)?api\/db\/migrate\.js\b/,
  /\bnode\s+(\.\/)?api\/reconcile\.js\b/,
];

// Commands that call Fyers' history API (each costs REST budget).
const FYERS_COMMANDS = [
  /\bnode\s+(\.\/)?(index|runAll|summary|sweep)\.js\b/,
  /\bnpm\s+(start|run\s+(start|report|sweep|all|final|summary|core))\b/,
  /\bnpm\s+run\s+live\b/,
  /\bnode\s+(\.\/)?server\/live\.js\b/,
];

const READS_ENV = /\b(cat|less|more|head|tail|bat|nl|strings|xxd|base64|grep|rg|awk|sed|source)\b[^|;&\n]*(^|[\s/'"])\.env(?![.\w])/;
const SOURCES_ENV = /(^|[;&|\n]\s*)\.\s+[^|;&\n]*\.env(?![.\w])/;

function inlineUrl(cmd, name) {
  const m = cmd.match(new RegExp(`(?:^|\\s)${name}=(['"]?)(\\S+?)\\1(?:\\s|$)`));
  return m ? m[2] : null;
}

function classify(cmd) {
  if (/neon\.tech/.test(cmd)) return deny('Command names the production Neon host.');

  if (READS_ENV.test(cmd) || SOURCES_ENV.test(cmd)) {
    return deny('Reading .env exposes Fyers credentials and the production DATABASE_URL. Use .env.example for the variable names.');
  }

  if (/\$\{?DATABASE_URL\b/.test(cmd)) {
    return deny('$DATABASE_URL may hold the production database. Spell out a localhost URL instead.');
  }

  if (/\bpsql\b/.test(cmd) && !LOCAL.test(cmd) && /postgres(ql)?:\/\//.test(cmd)) {
    return deny('psql to a non-local server. Use a localhost database.');
  }

  if (DB_COMMANDS.some((re) => re.test(cmd))) {
    const url = inlineUrl(cmd, 'DATABASE_URL');
    if (!url || !LOCAL.test(url)) {
      return deny(
        'This command opens DATABASE_URL, which .env sets to production Neon. ' +
          'Prefix it with DATABASE_URL=postgres://localhost/<throwaway-db>.',
      );
    }
  }

  const testUrl = inlineUrl(cmd, 'TEST_DATABASE_URL');
  if (testUrl && !LOCAL.test(testUrl)) {
    return deny('TEST_DATABASE_URL creates and drops databases; point it at a local server only.');
  }

  if (FYERS_COMMANDS.some((re) => re.test(cmd))) {
    return ask(
      'This spends Fyers REST budget (50/min, 4,800/day; three 429s in a day block the account). Run it?',
    );
  }

  return null;
}

function deny(reason) {
  return { decision: 'deny', reason };
}
function ask(reason) {
  return { decision: 'ask', reason };
}

module.exports = { classify };

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (c) => {
    input += c;
  });
  process.stdin.on('end', () => {
    let cmd = '';
    try {
      cmd = JSON.parse(input).tool_input?.command ?? '';
    } catch {
      process.exit(0);
    }
    const verdict = classify(cmd);
    if (!verdict) process.exit(0);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: verdict.decision,
          permissionDecisionReason: `guard: ${verdict.reason}`,
        },
      }),
    );
  });
}
