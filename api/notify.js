// Trade emails for the live paper session (#155, D26): one mail when a `fixed`
// paper trade on the mail watchlist closes, and one end-of-day summary.
//
// Mail goes through Brevo's HTTPS API, not SMTP: Render's free plan blocks the
// SMTP ports. Nothing here may ever throw into the session: a failed send is
// logged and dropped.

const { round, shortSymbol } = require('../src/util');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function summarize(trades) {
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    pnl: round(trades.reduce((sum, t) => sum + t.pnl, 0)),
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? Math.round((wins / trades.length) * 1000) / 10 : null,
  };
}

const rupees = (n) => `${n < 0 ? '-' : n > 0 ? '+' : ''}₹${Math.abs(round(n)).toFixed(2)}`;
const colour = (n) => (n > 0 ? '#0a7f3f' : n < 0 ? '#b42318' : '#555');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const table = (rows) =>
  `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${v}</b></td></tr>`)
    .join('')}</table>`;

function tradeMail(date, trade) {
  const name = shortSymbol(trade.symbol);
  const pnl = `<span style="color:${colour(trade.pnl)}">${rupees(trade.pnl)}</span>`;
  return {
    subject: `${name} ${trade.reason} ${rupees(trade.pnl)} · paper trade closed ${date}`,
    html: table([
      ['Symbol', esc(name)],
      ['Side', esc(trade.side)],
      ['Quantity', trade.quantity],
      ['Entry', `${trade.entry} at ${esc(trade.entryTime)}`],
      ['Exit', `${trade.exit} at ${esc(trade.exitTime)}`],
      ['Reason', esc(trade.reason)],
      ['Net P&L', pnl],
    ]),
  };
}

function eodMail(date, trades) {
  const s = summarize(trades);
  const head = `<h3 style="font-family:sans-serif">Paper trading · ${date}</h3>`;
  if (!trades.length) return { subject: `Paper EOD ${date}: no trades`, html: `${head}<p style="font-family:sans-serif">No trades today.</p>` };
  const summary = table([
    ["Today's P&L", `<span style="color:${colour(s.pnl)}">${rupees(s.pnl)}</span>`],
    ['Trades taken', s.trades],
    ['Wins / losses', `${s.wins} / ${s.losses}`],
    ['Win rate', `${s.winRate}%`],
  ]);
  const th = (t) => `<th style="text-align:left;border-bottom:1px solid #ccc">${t}</th>`;
  const rows = trades
    .map(
      (t) =>
        `<tr><td>${esc(shortSymbol(t.symbol))}</td><td>${esc(t.side)}</td><td>${t.entry} @ ${esc(t.entryTime)}</td>` +
        `<td>${t.exit} @ ${esc(t.exitTime)}</td><td>${esc(t.reason)}</td><td style="color:${colour(t.pnl)}">${rupees(t.pnl)}</td></tr>`
    )
    .join('');
  const list = `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:16px">
<tr>${['Symbol', 'Side', 'Entry', 'Exit', 'Reason', 'P&L'].map(th).join('')}</tr>${rows}</table>`;
  return { subject: `Paper EOD ${date}: ${rupees(s.pnl)} · ${s.trades} trades · ${s.winRate}% win`, html: head + summary + list };
}

function createBrevoSender({ apiKey, from, to, fetchImpl = fetch }) {
  return async function send({ subject, html }) {
    const res = await fetchImpl(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: from }, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Brevo ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
  };
}

const flowOf = (x) => x.flow || 'fixed';

// loadSymbols() -> the mail watchlist's symbols; loadTrades(date) -> that day's
// paper_trades rows. Both are read when needed, so a watchlist edit applies at once.
function createNotifier({ send, loadSymbols, loadTrades, log = () => {} }) {
  const entries = new Map(); // `${date}|${symbol}` -> the fixed ENTRY event this process saw

  async function mailExit(date, event) {
    if (!(await loadSymbols()).includes(event.symbol)) return;
    let entry = entries.get(`${date}|${event.symbol}`);
    if (!entry) {
      // Entered before a restart: the open row in paper_trades holds the entry.
      const row = (await loadTrades(date)).find((t) => t.symbol === event.symbol && flowOf(t) === 'fixed');
      entry = row ? { price: row.entry, time: row.entryTime } : { price: null, time: null };
    }
    const trade = {
      symbol: event.symbol,
      side: event.side,
      quantity: event.quantity,
      entry: entry.price,
      entryTime: entry.time,
      exit: event.price,
      exitTime: event.time,
      reason: event.reason,
      pnl: event.pnl,
    };
    await send(tradeMail(date, trade));
  }

  // Called synchronously from the session's broker: it must return at once and never throw.
  function onDecision(date, event) {
    try {
      if (flowOf(event) !== 'fixed') return Promise.resolve();
      if (event.kind === 'ENTRY') {
        entries.set(`${date}|${event.symbol}`, event);
        return Promise.resolve();
      }
      if (event.kind !== 'EXIT') return Promise.resolve();
      return mailExit(date, event).catch((err) => log(`trade mail for ${event.symbol} failed: ${err.message}`));
    } catch (err) {
      log(`trade mail failed: ${err.message}`);
      return Promise.resolve();
    }
  }

  async function endOfDay(date) {
    try {
      const symbols = new Set(await loadSymbols());
      const trades = (await loadTrades(date)).filter((t) => flowOf(t) === 'fixed' && t.status === 'closed' && symbols.has(t.symbol));
      await send(eodMail(date, trades));
      log(`EOD mail sent for ${date} (${trades.length} trades)`);
    } catch (err) {
      log(`EOD mail failed: ${err.message}`);
    }
  }

  return { onDecision, endOfDay };
}

// paper_trades rows for a day, numbers as numbers (pg returns numeric as strings).
async function loadPaperTrades(pool, date) {
  const { rows } = await pool.query(
    `select symbol, flow, status, side, quantity, entry, entry_time as "entryTime", exit, exit_time as "exitTime", reason, pnl
     from paper_trades where date = $1 order by entry_time, symbol, flow`,
    [date]
  );
  const num = (v) => (v == null ? null : Number(v));
  return rows.map((r) => ({ ...r, entry: num(r.entry), exit: num(r.exit), pnl: num(r.pnl) }));
}

module.exports = { summarize, tradeMail, eodMail, createBrevoSender, createNotifier, loadPaperTrades };
