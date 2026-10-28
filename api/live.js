// Hosts the live paper session (server/session.js) inside the API process. The
// free Render instance has no worker or cron, so a timer here starts the session
// once the market day begins and stops it after sessionEnd; an external pinger
// on /api/health keeps the instance awake in between (docs/deploy.md).
//
// Every check is idempotent: a restart mid-session simply starts a new session,
// which restores its positions from Postgres and backfills today's candles.
// After the session ends, the day is reconciled once against a backtest
// (api/reconcile.js).

const baseConfig = require('../config');
const { createLiveSession } = require('../server/session');
const { createLiveStore } = require('./db/liveStore');
const { reconcileDay } = require('./reconcile');
const { readToken } = require('../src/fyers');
const { istParts, toMinutes, IST_OFFSET_SECONDS } = require('../src/time');

const START_AT = toMinutes('09:10'); // early enough to connect before the 09:15 open
const STOP_GRACE_MIN = 5; // after sessionEnd, so the last minute's candle exists over REST

async function loadWatchlist(pool, name) {
  const { rows } = await pool.query(
    `select s.symbol from watchlist_symbols s join watchlists w on w.id = s.watchlist_id
     where w.name = $1 order by s.symbol`,
    [name]
  );
  return rows.map((r) => r.symbol);
}

const isWeekday = (epochSeconds) => {
  const day = new Date((epochSeconds + IST_OFFSET_SECONDS) * 1000).getUTCDay();
  return day !== 0 && day !== 6;
};

function createLiveScheduler({
  pool,
  enabled,
  watchlist,
  config = baseConfig,
  store = createLiveStore(pool),
  hasToken = async () => Boolean(await readToken()),
  symbolsFor = (name) => loadWatchlist(pool, name),
  createSession = createLiveSession,
  reconcile = (args) => reconcileDay({ pool, ...args }),
  isReconciled = async (date) => (await pool.query('select 1 from paper_reconciliations where date = $1', [date])).rows.length > 0,
  now = () => Date.now(),
  intervalMs = 30000,
  log = (msg) => console.log(`live: ${msg}`),
}) {
  const stopAt = toMinutes(config.sessionEnd) + STOP_GRACE_MIN;
  let session = null;
  let timer = null;
  let busy = false;
  let waiting = null; // the date we last logged "waiting for a token", so it logs once a day
  let lastError = null;
  let reconciledFor = null; // the date already reconciled, so the check runs once a day

  async function endSession() {
    const ending = session;
    session = null;
    try {
      await ending.refresh(); // books EOD exits for anything still held
    } catch (err) {
      log(`end-of-day refresh failed: ${err.message}`);
    }
    await ending.stop();
    log(`session ${ending.status().date} stopped`);
  }

  async function check() {
    const nowSec = Math.floor(now() / 1000);
    const { date, minute } = istParts(nowSec);
    const inWindow = isWeekday(nowSec) && minute >= START_AT && minute < stopAt;

    if (session && (session.status().date !== date || !inWindow)) await endSession();
    if (session) return;
    if (!inWindow) {
      if (isWeekday(nowSec) && minute >= stopAt) await reconcileOnce(date);
      return;
    }

    if (!(await hasToken())) {
      if (waiting !== date) log('market day, but no Fyers token yet; connect Fyers to start');
      waiting = date;
      return;
    }

    const symbols = await symbolsFor(watchlist);
    if (!symbols.length) {
      lastError = `watchlist "${watchlist}" is empty or missing`;
      if (waiting !== `${date}:list`) log(lastError);
      waiting = `${date}:list`;
      return;
    }

    const next = createSession({ symbols, config, store, date, log: (msg) => log(msg) });
    try {
      await next.start();
      session = next;
      lastError = null;
      log(`session ${date} started on "${watchlist}" (${symbols.length} symbols)`);
    } catch (err) {
      // Retried on the next check, e.g. once a missing token arrives.
      await next.stop().catch(() => {});
      lastError = err.message;
      log(`session start failed: ${err.message}`);
    }
  }

  // Costs one REST call per symbol, so it waits for a token and runs once.
  async function reconcileOnce(date) {
    if (reconciledFor === date || !(await hasToken())) return;
    if (await isReconciled(date)) {
      reconciledFor = date;
      return;
    }
    try {
      await reconcile({ date, symbols: await symbolsFor(watchlist), config, log });
      reconciledFor = date;
    } catch (err) {
      lastError = `reconcile failed: ${err.message}`;
      log(lastError);
      reconciledFor = date; // a spent budget or dead token won't heal today; reconcile by hand later
    }
  }

  // One check at a time: a session start (warm start) takes about a minute.
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await check();
    } catch (err) {
      lastError = err.message;
      log(`check failed: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (!enabled) return log('disabled (set LIVE_ENABLED=true to run paper trading)');
    log(`scheduler on, watchlist "${watchlist}"`);
    timer = setInterval(tick, intervalMs);
    return tick();
  }

  async function stop() {
    clearInterval(timer);
    timer = null;
    if (session) {
      const ending = session;
      session = null;
      await ending.stop();
    }
  }

  function status() {
    return { enabled, watchlist, lastError, session: session ? session.status() : null };
  }

  return { start, stop, status, tick };
}

module.exports = { createLiveScheduler, loadWatchlist };
