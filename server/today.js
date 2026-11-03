// Reads the day's decision log and prints it as a table.
//
//   npm run today              today's session
//   npm run today 2026-09-23   a specific date
//
// Reads only. Safe to run while the live runner is going.

const fs = require('fs');
const path = require('path');
const { istToday } = require('../src/time');
const { round, shortSymbol: short } = require('../src/util');

const DIR = path.join(__dirname, '..', 'data', 'live');
const money = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);

function main() {
  const date = process.argv[2] || istToday();
  const file = path.join(DIR, `decisions-${date}.jsonl`);

  if (!fs.existsSync(file)) {
    console.log(`\nNo log for ${date}. Looked in ${path.relative(process.cwd(), file)}\n`);
    const found = fs.existsSync(DIR)
      ? fs.readdirSync(DIR).filter((f) => f.startsWith('decisions-'))
      : [];
    if (found.length) console.log('Available:', found.map((f) => f.slice(10, 20)).join(', '), '\n');
    return;
  }

  const events = fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const rows = tradeRows(events);

  if (rows.length === 0) {
    console.log(`\n${date}: log exists but holds no entries yet.\n`);
    return;
  }

  rows.sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
  console.log(`\nLive decisions — ${date}\n`);
  // The two flows trade the same entries, so each gets its own totals (D25).
  for (const flow of [...new Set(rows.map((r) => r.flow))]) {
    const mine = rows.filter((r) => r.flow === flow);
    if (rows.some((r) => r.flow !== flow)) console.log(`${flow} flow`);
    console.table(mine.map(({ flow: _, ...r }) => r));

    const closed = mine.filter((r) => r.pnl !== null);
    const open = mine.filter((r) => r.pnl === null);
    const total = closed.reduce((s, r) => s + r.pnl, 0);
    const wins = closed.filter((r) => r.pnl > 0).length;

    const byReason = {};
    for (const r of closed) byReason[r.why] = (byReason[r.why] || 0) + 1;

    console.log(
      `${mine.length} trades · ${closed.length} closed · ${open.length} still open · ` +
        `${wins}/${closed.length} winners`
    );
    console.log(`P&L ${money(total)} · exits: ${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
    if (open.length) console.log(`open: ${open.map((r) => r.symbol).join(', ')}`);
    console.log('');
  }
  console.log('Paper only — no orders were placed.\n');
}

// One row per paper trade: each flow's entry paired with its exit (no flow
// means the single fixed flow, D25). A TRAIL moves the trail's stop, so the
// row shows the stop it ended on. Still open: no exit yet.
function tradeRows(events) {
  const trades = new Map();
  for (const e of events) {
    const key = `${e.symbol}|${e.flow || 'fixed'}`;
    if (!trades.has(key)) trades.set(key, { flow: e.flow || 'fixed' });
    const t = trades.get(key);
    if (e.kind === 'ENTRY') t.entry ??= e;
    else if (e.kind === 'EXIT') t.exit = e;
    else if (e.kind === 'TRAIL') t.sl = e.sl;
  }

  const rows = [];
  for (const [key, { flow, entry, exit, sl }] of trades) {
    if (!entry) continue;
    rows.push({
      flow,
      symbol: short(key.split('|')[0]),
      side: entry.side,
      'entry @': entry.time,
      entry: entry.price,
      qty: entry.quantity,
      sl: sl ?? entry.sl,
      target: entry.target ?? '—',
      'exit @': exit ? exit.time : '—',
      exit: exit ? exit.price : '—',
      why: exit ? exit.reason : 'OPEN',
      pnl: exit ? round(exit.pnl) : null,
    });
  }
  return rows;
}

if (require.main === module) main();

module.exports = { tradeRows };
