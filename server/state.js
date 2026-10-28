// Everything the runner must remember across a restart. A laptop that sleeps
// mid-session must not come back and take a second position in a symbol it
// already holds.
//
// The file implementation of the live session's state store ({ load, save,
// logDecision }, see server/session.js), used by `npm run live`. The API uses a
// Postgres store of the same shape, since a web host's disk does not survive a
// restart.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'live');

function file(name) {
  fs.mkdirSync(DIR, { recursive: true });
  return path.join(DIR, name);
}

function load(date) {
  const f = file(`state-${date}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { date, symbols: {} };
}

function save(state) {
  fs.writeFileSync(file(`state-${state.date}.json`), JSON.stringify(state, null, 2));
}

// Append-only log of every decision change, so the day can be replayed later and
// diffed against what the backtest says about the same session.
function logDecision(date, entry) {
  fs.appendFileSync(file(`decisions-${date}.jsonl`), JSON.stringify(entry) + '\n');
}

module.exports = { load, save, logDecision, DIR };
