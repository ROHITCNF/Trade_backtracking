// The PreToolUse guard (.claude/hooks/guard.js) that keeps Claude off the
// production database and asks before spending Fyers budget.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { classify } = require('../.claude/hooks/guard');

const decision = (cmd) => classify(cmd)?.decision ?? 'allow';

test('denies database commands that would fall back to .env (production)', () => {
  for (const cmd of ['npm run migrate', 'npm run api', 'node api/server.js', 'node ./api/db/migrate.js']) {
    assert.equal(decision(cmd), 'deny', cmd);
  }
});

test('allows database commands with an inline local DATABASE_URL', () => {
  assert.equal(decision('DATABASE_URL=postgres://localhost/orb_e2e npm run migrate'), 'allow');
  assert.equal(decision("DATABASE_URL='postgres://127.0.0.1:5432/x' node api/server.js"), 'allow');
});

test('denies an inline non-local DATABASE_URL and anything naming Neon', () => {
  assert.equal(decision('DATABASE_URL=postgres://u:p@db.example.com/x npm run api'), 'deny');
  assert.equal(decision('psql postgres://u:p@ep-x.aws.neon.tech/neondb'), 'deny');
  assert.equal(decision('psql "$DATABASE_URL" -c "select 1"'), 'deny');
});

test('allows local psql and tests on a local TEST_DATABASE_URL', () => {
  assert.equal(decision('psql -c "select 1" postgres'), 'allow');
  assert.equal(decision('TEST_DATABASE_URL=postgres://localhost/postgres npm test'), 'allow');
  assert.equal(decision('TEST_DATABASE_URL=postgres://u@remote.host/postgres npm test'), 'deny');
});

test('denies reading .env but not .env.example', () => {
  for (const cmd of ['cat .env', 'grep DATABASE .env', 'source .env', '. ./.env && npm test', 'tail -n 3 /x/.env']) {
    assert.equal(decision(cmd), 'deny', cmd);
  }
  assert.equal(decision('cat .env.example'), 'allow');
  // A newline ends a command: `| tail -1` on one line must not reach a title on the next.
  assert.equal(decision('git push 2>&1 | tail -1\ngh pr create -t "fix: guard for .env reads"'), 'allow');
  assert.equal(decision('grep -n env src/env.js'), 'allow');
});

test('asks before scripts that spend Fyers REST budget', () => {
  for (const cmd of ['node runAll.js 5', 'npm start', 'npm run report', 'npm run sweep', 'npm run core', 'node summary.js all core.txt', 'npm run live']) {
    assert.equal(decision(cmd), 'ask', cmd);
  }
});

test('leaves ordinary commands alone', () => {
  for (const cmd of ['npm test', 'npm run lint', 'npm --prefix web test', 'git status', 'npm run web', 'npm run today']) {
    assert.equal(decision(cmd), 'allow', cmd);
  }
});

test('hook speaks the PreToolUse JSON protocol', () => {
  const script = path.join(__dirname, '..', '.claude', 'hooks', 'guard.js');
  const run = (command) =>
    execFileSync('node', [script], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }) }).toString();
  assert.equal(run('git status'), '');
  const out = JSON.parse(run('npm run migrate'));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /production/);
});
