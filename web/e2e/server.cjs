// The API for end-to-end tests and local UI previews: the real Fastify app,
// run worker and Postgres schema, on a throwaway local database, with Fyers
// replaced by deterministic stubs. Nothing here reads .env or calls Fyers.
//
//   E2E_DATABASE_URL=postgres://localhost/postgres node web/e2e/server.cjs
//
// Creates database `orb_e2e_<pid>`, migrates and seeds it, serves on :4000
// (Vite proxies /api there), and drops the database on SIGINT/SIGTERM.
// Sign in with password `e2e-password`.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..', '..');
const req = (p) => require(path.join(root, p));

const { Pool } = require(path.join(root, 'node_modules', 'pg'));
const bcrypt = require(path.join(root, 'node_modules', 'bcryptjs'));
const fyers = req('src/fyers');
const { dateToEpoch, istToday, IST_OFFSET_SECONDS } = req('src/time');
const { round } = req('src/util');
const { buildApp } = req('api/server');
const { loadConfig } = req('api/config');
const { migrate } = req('api/db/migrate');
const { createPgStore } = req('api/db/fyersStore');
const { createWorker } = req('api/worker');
const { createSymbolMaster } = req('api/symbols');
const { seedWatchlists } = req('api/db/watchlists');

const PASSWORD = 'e2e-password';
const PORT = Number(process.env.E2E_API_PORT) || 4000;
const adminUrl = process.env.E2E_DATABASE_URL || 'postgres://localhost/postgres';
if (!/(localhost|127\.0\.0\.1|@postgres:)/.test(adminUrl)) {
  console.error('E2E_DATABASE_URL must point at a local Postgres server.');
  process.exit(1);
}

// Symbols present in the symbol-master fixture, so runs validate.
const LISTS = {
  'core.txt': ['NSE:SBIN-EQ', 'NSE:RELIANCE-EQ', 'NSE:ETERNAL-EQ'],
  'final.txt': ['NSE:SBIN-EQ', 'NSE:SBILIFE-EQ'],
  'fno.txt': ['NSE:SBIN-EQ', 'NSE:RELIANCE-EQ', 'NSE:ETERNAL-EQ', 'NSE:SBICARD-EQ', 'NSE:SBILIFE-EQ', 'NSE:TMPV-EQ'],
  'live.txt': ['NSE:SBIN-EQ', 'NSE:RELIANCE-EQ', 'NSE:ETERNAL-EQ', 'NSE:SBILIFE-EQ'],
};

// Deterministic 1-minute candles, 09:15–15:29 on weekdays, seeded by symbol and
// date so every run, reload and chart sees the same prices.
function seedOf(text) {
  return crypto.createHash('md5').update(text).digest().readUInt32BE(0) % 2147483647 || 1;
}
function dayCandles(symbol, date) {
  let s = seedOf(`${symbol}|${date}`);
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const day = dateToEpoch(date);
  let price = 100 + (seedOf(symbol) % 2000);
  const vol = price * 0.0015;
  const out = [];
  for (let m = 9 * 60 + 15; m < 15 * 60 + 30; m++) {
    const o = round(price);
    const c = round(o + (rand() - 0.5) * 2 * vol);
    out.push([day + m * 60, o, round(Math.max(o, c) + rand() * vol), round(Math.min(o, c) - rand() * vol), c, 1000]);
    price = c;
  }
  return out;
}
function isWeekday(date) {
  const wd = new Date((dateToEpoch(date) + IST_OFFSET_SECONDS) * 1000).getUTCDay();
  return wd !== 0 && wd !== 6;
}
const addDays = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
async function getCandles({ symbol, fromDate, toDate }, { onCall = () => {} } = {}) {
  onCall();
  const out = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) if (isWeekday(d)) out.push(...dayCandles(symbol, d));
  return out;
}

// Last n weekdays before today (IST), oldest first.
function lastWeekdays(n) {
  const out = [];
  for (let d = addDays(istToday(), -1); out.length < n; d = addDays(d, -1)) if (isWeekday(d)) out.unshift(d);
  return out;
}

// Paper trades priced off the same stub candles, so the Live chart's entry and
// exit lines sit on the candles. One target, one stop, one EOD per day shape.
function paperTrade(date, symbol, side, quantity, entryTime, exitTime, reason) {
  const close = (time) => {
    const [h, m] = time.split(':').map(Number);
    return dayCandles(symbol, date)[(h * 60 + m) - (9 * 60 + 15)][4];
  };
  const entry = close(entryTime);
  const sign = side === 'long' ? 1 : -1;
  const sl = round(entry * (1 - sign * 0.01));
  const target = reason === 'EOD' ? null : round(entry * (1 + sign * 0.015));
  const exit = reason === 'TARGET' ? target : reason === 'SL' ? sl : close(exitTime);
  return [date, symbol, side, quantity, entryTime, entry, sl, target, exitTime, exit, reason, round(sign * (exit - entry) * quantity)];
}

// Trail rows (M10, #150) for the same entry as a fixed row: same entry and
// starting SL (1% from entry), no target. Each step is [time, g], the stop
// set g × entry from entry on the loss side (negative = past entry, in
// profit), and it is written as a TRAIL decision too, as the live session logs
// it. The trade exits at its last stop (SL) or at the close (EOD).
function trailTrade(date, symbol, side, quantity, entryTime, steps, exitTime, reason) {
  const close = (time) => {
    const [h, m] = time.split(':').map(Number);
    return dayCandles(symbol, date)[(h * 60 + m) - (9 * 60 + 15)][4];
  };
  const entry = close(entryTime);
  const sign = side === 'long' ? 1 : -1;
  const stopAt = (g) => round(entry * (1 - sign * g));
  const initialSl = stopAt(0.01);
  const stepped = steps.map(([time, g]) => ({ time, sl: stopAt(g), best: round(entry * (1 + sign * 0.012)) }));
  const last = stepped.at(-1);
  const sl = last ? last.sl : initialSl;
  const exit = reason === 'EOD' ? close(exitTime) : sl;
  return {
    row: [date, symbol, side, quantity, entryTime, entry, sl, exitTime, exit, reason, round(sign * (exit - entry) * quantity), initialSl, last?.best ?? initialSl, last?.time ?? null],
    decisions: stepped.map((s) => ({ date, symbol, time: s.time, sl: s.sl, best: s.best, side })),
  };
}

async function seedPaperTrades(pool) {
  const days = lastWeekdays(3);
  const rows = [];
  const trail = [];
  days.forEach((date, i) => {
    rows.push(paperTrade(date, 'NSE:SBIN-EQ', 'long', 10, '09:34', '10:12', 'TARGET'));
    rows.push(paperTrade(date, 'NSE:SBILIFE-EQ', 'short', 5, '09:41', '11:05', 'SL'));
    if (i === days.length - 1) rows.push(paperTrade(date, 'NSE:ETERNAL-EQ', 'long', 20, '09:52', '15:14', 'EOD'));
    trail.push(trailTrade(date, 'NSE:SBIN-EQ', 'long', 10, '09:34', [['09:50', 0.005], ['10:05', -0.002]], '10:12', 'SL'));
    trail.push(trailTrade(date, 'NSE:SBILIFE-EQ', 'short', 5, '09:41', [['10:00', 0.006], ['10:30', 0.003]], '11:05', 'SL'));
    if (i === days.length - 1) trail.push(trailTrade(date, 'NSE:ETERNAL-EQ', 'long', 20, '09:52', [['11:00', 0.004]], '15:14', 'EOD'));
  });
  for (const r of rows) {
    await pool.query(
      `insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target, exit_time, exit, reason, pnl)
       values ($1, $2, 'closed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      r,
    );
  }
  for (const { row, decisions } of trail) {
    await pool.query(
      `insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target, exit_time, exit, reason, pnl,
         flow, initial_sl, best, sl_time)
       values ($1, $2, 'closed', $3, $4, $5, $6, $7, null, $8, $9, $10, $11, 'trail', $12, $13, $14)`,
      row,
    );
    for (const d of decisions) {
      const payload = { kind: 'TRAIL', flow: 'trail', symbol: d.symbol, side: d.side, sl: d.sl, best: d.best, time: d.time };
      await pool.query(`insert into live_decisions (date, symbol, kind, payload) values ($1, $2, 'TRAIL', $3)`, [d.date, d.symbol, JSON.stringify(payload)]);
    }
  }
}

async function main() {
  const name = `orb_e2e_${process.pid}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    try {
      await app?.close();
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let app;
  await migrate(pool, { log: () => {} });
  await seedWatchlists(pool, { read: (file) => LISTS[file] ?? [] });
  await seedPaperTrades(pool);

  process.env.TOKEN_ENC_KEY ||= crypto.randomBytes(32).toString('base64');
  fyers.setStore(createPgStore(pool));
  await fyers.saveToken('e2e-token');

  const csv = fs.readFileSync(path.join(root, 'test', 'fixtures', 'NSE_CM.sample.csv'), 'utf8');
  const symbols = createSymbolMaster({ fetch: async () => ({ ok: true, text: async () => csv }), log: () => {} });
  await symbols.load();

  const config = loadConfig({
    DATABASE_URL: url.toString(),
    APP_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 4),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  const worker = createWorker({ pool, getCandles, log: () => {} });
  // Mail never leaves the machine: the Mail report button gets a stub that
  // counts the day's closed fixed trades and sends nothing.
  const notifier = {
    sendDay: async (date) =>
      (await pool.query("select count(*)::int as n from paper_trades where date = $1 and flow = 'fixed' and status = 'closed'", [date])).rows[0].n,
  };
  app = buildApp({ pool, config, worker, symbols, getCandles, notifier });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  worker.wake();
  console.log(`e2e api on :${PORT}, database ${name}, password ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
