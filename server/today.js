// Reads the day's decision log and prints it as a table.
//
//   npm run today              today's session
//   npm run today 2026-09-23   a specific date
//
// Reads only. Safe to run while the live runner is going.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'live');
const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const money = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

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

  // Pair each entry with its exit. A symbol still open has no exit yet.
  const bySymbol = new Map();
  for (const e of events) {
    if (!bySymbol.has(e.symbol)) bySymbol.set(e.symbol, {});
    bySymbol.get(e.symbol)[e.kind === 'ENTRY' ? 'entry' : 'exit'] = e;
  }

  const rows = [];
  for (const [symbol, { entry, exit }] of bySymbol) {
    if (!entry) continue;
    rows.push({
      symbol: short(symbol),
      side: entry.side,
      'entry @': entry.time,
      entry: entry.price,
      qty: entry.quantity,
      sl: entry.sl,
      target: entry.target ?? '—',
      'exit @': exit ? exit.time : '—',
      exit: exit ? exit.price : '—',
      why: exit ? exit.reason : 'OPEN',
      pnl: exit ? Math.round(exit.pnl * 100) / 100 : null,
    });
  }

  if (rows.length === 0) {
    console.log(`\n${date}: log exists but holds no entries yet.\n`);
    return;
  }

  rows.sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
  console.log(`\nLive decisions — ${date}\n`);
  console.table(rows);

  const closed = rows.filter((r) => r.pnl !== null);
  const open = rows.filter((r) => r.pnl === null);
  const total = closed.reduce((s, r) => s + r.pnl, 0);
  const wins = closed.filter((r) => r.pnl > 0).length;

  const byReason = {};
  for (const r of closed) byReason[r.why] = (byReason[r.why] || 0) + 1;

  console.log(
    `${rows.length} trades · ${closed.length} closed · ${open.length} still open · ` +
      `${wins}/${closed.length} winners`
  );
  console.log(`P&L ${money(total)} · exits: ${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
  if (open.length) console.log(`open: ${open.map((r) => r.symbol).join(', ')}`);
  console.log('\nPaper only — no orders were placed.\n');
}

main();
