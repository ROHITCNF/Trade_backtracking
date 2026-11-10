const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, tradeMail, eodMail, createBrevoSender, createNotifier } = require('../api/notify');

const DATE = '2026-01-05';
const trade = (over = {}) => ({
  symbol: 'NSE:LUPIN-EQ', side: 'long', quantity: 10, entry: 2000.5, entryTime: '09:31',
  exit: 2040.25, exitTime: '10:12', reason: 'TARGET', pnl: 397.5, ...over,
});

test('summarize totals pnl, wins, losses and win rate', () => {
  assert.deepEqual(summarize([{ pnl: 100.105 }, { pnl: -40 }, { pnl: 25.2 }]),
    { pnl: 85.31, trades: 3, wins: 2, losses: 1, winRate: 66.7 });
});

test('summarize counts a zero-pnl trade as a loss, not a win', () => {
  assert.deepEqual(summarize([{ pnl: 0 }, { pnl: 10 }]), { pnl: 10, trades: 2, wins: 1, losses: 1, winRate: 50 });
});

test('summarize of no trades has a null win rate', () => {
  assert.deepEqual(summarize([]), { pnl: 0, trades: 0, wins: 0, losses: 0, winRate: null });
});

test('tradeMail subject names the short symbol, reason and pnl', () => {
  const { subject } = tradeMail(DATE, trade());
  assert.match(subject, /LUPIN/);
  assert.doesNotMatch(subject, /NSE:|-EQ/);
  assert.match(subject, /TARGET/);
  assert.match(subject, /397\.5/);
});

test('tradeMail html carries prices, times, side and quantity', () => {
  const { html } = tradeMail(DATE, trade());
  for (const s of ['2000.5', '2040.25', '09:31', '10:12', 'long', '10']) assert.ok(html.includes(s), `missing ${s}`);
});

test('tradeMail for a losing short shows the negative pnl and reason', () => {
  const { subject, html } = tradeMail(DATE, trade({ side: 'short', reason: 'SL', pnl: -120.25 }));
  assert.match(subject, /SL/);
  assert.match(subject, /-\D{0,2}120\.25/);
  assert.ok(html.includes('short'));
});

test('eodMail shows date, totals, win rate and a row per trade', () => {
  const trades = [trade(), trade({ symbol: 'NSE:RVNL-EQ', pnl: -100, reason: 'SL' })];
  const { subject, html } = eodMail(DATE, trades);
  assert.ok(subject.includes(DATE));
  assert.ok(html.includes('297.5'), 'total pnl');
  assert.ok(html.includes('50'), 'win rate');
  assert.ok(html.includes('LUPIN'));
  assert.ok(html.includes('RVNL'));
});

test('eodMail with no trades says so', () => {
  const { subject, html } = eodMail(DATE, []);
  assert.ok(subject.includes(DATE));
  assert.match(html, /No trades today/);
});

test('brevo sender POSTs the documented request', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 }; };
  const send = createBrevoSender({ apiKey: 'K', from: 'a@x.com', to: 'b@y.com', fetchImpl });
  await send({ subject: 'S', html: '<p>h</p>' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['api-key'], 'K');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sender: { email: 'a@x.com' }, to: [{ email: 'b@y.com' }], subject: 'S', htmlContent: '<p>h</p>',
  });
});

test('brevo sender rejects on a non-ok response', async () => {
  const send = createBrevoSender({ apiKey: 'K', from: 'a', to: 'b', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'no' }) });
  await assert.rejects(() => send({ subject: 's', html: 'h' }));
});

function notifierHarness({ symbols = ['NSE:LUPIN-EQ'], rows = [], failSend = false, failLoad = false } = {}) {
  const h = { sent: [], logs: [], loads: [] };
  h.notifier = createNotifier({
    send: async (m) => { h.sent.push(m); if (failSend) throw new Error('smtp down'); },
    loadSymbols: async () => symbols,
    loadTrades: async (d) => { h.loads.push(d); if (failLoad) throw new Error('db down'); return rows; },
    log: (m) => h.logs.push(m),
  });
  return h;
}
const entry = (over = {}) => ({ kind: 'ENTRY', symbol: 'NSE:LUPIN-EQ', side: 'long', price: 2000.5, quantity: 10, sl: 1980, target: 2040, time: '09:31', ...over });
const exit = (over = {}) => ({ kind: 'EXIT', symbol: 'NSE:LUPIN-EQ', side: 'long', price: 2040.25, quantity: 10, reason: 'TARGET', pnl: 397.5, time: '10:12', ...over });

test('a fixed EXIT in the list sends one mail using the earlier ENTRY', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry());
  assert.equal(h.sent.length, 0, 'entry sends nothing');
  await h.notifier.onDecision(DATE, exit());
  assert.equal(h.sent.length, 1);
  const expected = tradeMail(DATE, trade());
  assert.deepEqual(h.sent[0], expected);
});

test('an event with flow "fixed" is treated like one with no flow', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry({ flow: 'fixed' }));
  await h.notifier.onDecision(DATE, exit({ flow: 'fixed' }));
  assert.equal(h.sent.length, 1);
});

test('after a restart the entry comes from the paper_trades fixed row', async () => {
  const row = { symbol: 'NSE:LUPIN-EQ', flow: 'fixed', status: 'closed', side: 'long', quantity: 10, entry: 2000.5, entryTime: '09:31', exit: 2040.25, exitTime: '10:12', reason: 'TARGET', pnl: 397.5 };
  const trailRow = { ...row, flow: 'trail', entry: 1, entryTime: '09:59' };
  const h = notifierHarness({ rows: [trailRow, row] });
  await h.notifier.onDecision(DATE, exit());
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.loads, [DATE]);
  assert.deepEqual(h.sent[0], tradeMail(DATE, trade()));
});

test('an EXIT for a symbol outside the list sends nothing', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry({ symbol: 'NSE:OTHER-EQ' }));
  await h.notifier.onDecision(DATE, exit({ symbol: 'NSE:OTHER-EQ' }));
  assert.equal(h.sent.length, 0);
});

test('a trail-flow EXIT sends nothing, even after a trail ENTRY', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry({ flow: 'trail' }));
  await h.notifier.onDecision(DATE, exit({ flow: 'trail' }));
  assert.equal(h.sent.length, 0);
});

test('a trail EXIT does not supply or disturb the fixed entry', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry());
  await h.notifier.onDecision(DATE, entry({ flow: 'trail', price: 1, time: '09:59' }));
  await h.notifier.onDecision(DATE, exit({ flow: 'trail' }));
  await h.notifier.onDecision(DATE, exit());
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0], tradeMail(DATE, trade()));
});

test('ENTRY and TRAIL events send nothing', async () => {
  const h = notifierHarness();
  await h.notifier.onDecision(DATE, entry());
  await h.notifier.onDecision(DATE, { kind: 'TRAIL', symbol: 'NSE:LUPIN-EQ', sl: 2010, time: '09:40' });
  assert.equal(h.sent.length, 0);
});

test('a rejecting send is logged as a string and does not throw', async () => {
  const h = notifierHarness({ failSend: true });
  await h.notifier.onDecision(DATE, entry());
  await assert.doesNotReject(() => h.notifier.onDecision(DATE, exit()));
  assert.equal(h.logs.length, 1);
  assert.equal(typeof h.logs[0], 'string');
  assert.match(h.logs[0], /smtp down/);
});

test('onDecision never throws synchronously or rejects when loads fail', async () => {
  const h = notifierHarness({ failLoad: true });
  let p;
  assert.doesNotThrow(() => { p = h.notifier.onDecision(DATE, exit()); });
  await assert.doesNotReject(() => p);
  assert.equal(h.sent.length, 0);
});

const closed = (over = {}) => ({ symbol: 'NSE:LUPIN-EQ', flow: 'fixed', status: 'closed', side: 'long', quantity: 10, entry: 2000.5, entryTime: '09:31', exit: 2040.25, exitTime: '10:12', reason: 'TARGET', pnl: 397.5, ...over });

test('endOfDay sends one summary of the list\'s closed fixed trades only', async () => {
  const rows = [
    closed(),
    closed({ symbol: 'NSE:RVNL-EQ', pnl: -100, reason: 'SL' }),
    closed({ symbol: 'NSE:OTHER-EQ', pnl: 5000 }),
    closed({ flow: 'trail', pnl: 9000 }),
    closed({ status: 'open', pnl: 7000 }),
  ];
  const h = notifierHarness({ symbols: ['NSE:LUPIN-EQ', 'NSE:RVNL-EQ'], rows });
  await h.notifier.endOfDay(DATE);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.loads, [DATE]);
  assert.deepEqual(h.sent[0], eodMail(DATE, [rows[0], rows[1]]));
  assert.ok(h.sent[0].html.includes('297.5'));
});

test('endOfDay with zero trades still sends "No trades today"', async () => {
  const h = notifierHarness({ rows: [closed({ symbol: 'NSE:OTHER-EQ' })] });
  await h.notifier.endOfDay(DATE);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].html, /No trades today/);
});

test('endOfDay logs a failing send and does not reject', async () => {
  const h = notifierHarness({ failSend: true });
  await assert.doesNotReject(() => h.notifier.endOfDay(DATE));
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /smtp down/);
});

test('endOfDay does not reject when loading trades fails', async () => {
  const h = notifierHarness({ failLoad: true });
  await assert.doesNotReject(() => h.notifier.endOfDay(DATE));
});

test('sendDay mails the list\'s closed fixed trades so far, returns the count, and throws on failure (#157)', async () => {
  const rows = [
    { symbol: 'NSE:LUPIN-EQ', flow: 'fixed', status: 'closed', side: 'long', quantity: 5, entry: 100, entryTime: '09:31', exit: 101, exitTime: '10:00', reason: 'TARGET', pnl: 5 },
    { symbol: 'NSE:LUPIN-EQ', flow: 'trail', status: 'closed', side: 'long', quantity: 5, entry: 100, entryTime: '09:31', exit: 102, exitTime: '11:00', reason: 'SL', pnl: 10 },
    { symbol: 'NSE:OIL-EQ', flow: 'fixed', status: 'open', side: 'short', quantity: 3, entry: 50, entryTime: '09:40', exit: null, exitTime: null, reason: null, pnl: null },
    { symbol: 'NSE:SBIN-EQ', flow: 'fixed', status: 'closed', side: 'long', quantity: 1, entry: 800, entryTime: '09:35', exit: 790, exitTime: '09:50', reason: 'SL', pnl: -10 },
  ];
  const mails = [];
  const notifier = createNotifier({
    send: async (m) => { mails.push(m); },
    loadSymbols: async () => ['NSE:LUPIN-EQ', 'NSE:OIL-EQ'],
    loadTrades: async () => rows,
  });
  assert.equal(await notifier.sendDay(DATE), 1);
  assert.equal(mails.length, 1);
  assert.ok(mails[0].html.includes('LUPIN'));
  assert.ok(!mails[0].html.includes('SBIN'));

  const failing = createNotifier({ send: async () => { throw new Error('Brevo 401: nope'); }, loadSymbols: async () => [], loadTrades: async () => [] });
  await assert.rejects(failing.sendDay(DATE), /Brevo 401/);
});
