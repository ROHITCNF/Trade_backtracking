// Watchlists: import parsing (pure), then seed and routes against a real
// database (TEST_DATABASE_URL, see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseImport, previewImport } = require('../api/watchlists');
const { seedWatchlists } = require('../api/db/watchlists');
const { createSymbolMaster } = require('../api/symbols');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { readTickers } = require('../src/tickers');
const { createTestDb, noDb } = require('./db');

const CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'NSE_CM.sample.csv'), 'utf8');
async function loadedMaster() {
  const m = createSymbolMaster({ fetch: async () => ({ ok: true, text: async () => CSV }), log: () => {} });
  await m.load();
  return m;
}

test('parse accepts lines, commas, bare and full symbols; ignores blanks and comments', () => {
  const entries = parseImport('SBIN\n\nNSE:RELIANCE-EQ, tmpv ,\n# a comment\nNIFTY  # trailing\r\n');
  assert.deepEqual(entries, [
    { line: 1, text: 'SBIN' },
    { line: 3, text: 'NSE:RELIANCE-EQ' },
    { line: 3, text: 'tmpv' },
    { line: 5, text: 'NIFTY' },
  ]);
  assert.throws(() => parseImport('SBIN\n'.repeat(501)), /At most 500 lines/);
});

test('preview classifies add / already / index / not found, by line', async () => {
  const m = await loadedMaster();
  const text = 'SBIN\nPAYTM\nNIFTY\nNSE:RELIANCE-EQ,sbin\nZOMATO\nETERNAL';
  const p = previewImport(text, { classify: m.classify, existing: ['NSE:RELIANCE-EQ'] });
  assert.deepEqual(p.add.map((a) => a.symbol), ['NSE:SBIN-EQ', 'NSE:ETERNAL-EQ']);
  assert.equal(p.add[0].name, 'STATE BANK OF INDIA');
  assert.deepEqual(p.already, ['NSE:RELIANCE-EQ']);
  assert.deepEqual(p.skipped, [
    { line: 2, text: 'PAYTM', reason: 'not_found' }, // not in the fixture master
    { line: 3, text: 'NIFTY', reason: 'index' },
    { line: 5, text: 'ZOMATO', reason: 'not_found' },
  ]);
  assert.deepEqual(p.counts, { add: 2, already: 1, skipped: 3 });
});

const config = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
const headers = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };

async function withApi(fn) {
  const db = await createTestDb();
  const app = buildApp({ pool: db.pool, config, symbols: await loadedMaster() });
  const call = (method, url, payload) => app.inject({ method, url, payload, headers });
  try {
    await fn({ app, call, pool: db.pool });
  } finally {
    await app.close();
    await db.drop();
  }
}

test('seed runs once from lists/*.txt; F&O is read-only', { skip: noDb }, () =>
  withApi(async ({ call, pool }) => {
    const seeded = await seedWatchlists(pool);
    const fno = readTickers('fno.txt');
    assert.deepEqual(seeded, ['core', 'final', `F&O – ${fno.length}`]);
    assert.deepEqual(await seedWatchlists(pool), [], 'second boot does nothing');

    const lists = (await call('GET', '/api/watchlists')).json().watchlists;
    assert.deepEqual(lists.map((l) => [l.name, l.count, l.readOnly, l.source]), [
      ['core', readTickers('core.txt').length, false, 'seed'],
      ['final', readTickers('final.txt').length, false, 'seed'],
      [`F&O – ${fno.length}`, fno.length, true, 'seed'],
    ]);

    const fnoId = lists[2].id;
    assert.equal((await call('POST', `/api/watchlists/${fnoId}/symbols`, { symbol: 'SBIN' })).statusCode, 409);
    assert.equal((await call('DELETE', `/api/watchlists/${fnoId}/symbols/NSE:SBIN-EQ`)).statusCode, 409);
    assert.equal((await call('PATCH', `/api/watchlists/${fnoId}`, { name: 'mine' })).statusCode, 409);
    assert.equal((await call('DELETE', `/api/watchlists/${fnoId}`)).statusCode, 409);
    assert.equal((await call('POST', `/api/watchlists/${fnoId}/import`, { mode: 'add', symbols: ['SBIN'] })).statusCode, 409);
    // …but it can be the source of a new list, and exported.
    const copy = await call('POST', `/api/watchlists/${fnoId}/import`, { mode: 'new', name: 'my fno', symbols: ['SBIN'] });
    assert.equal(copy.statusCode, 201);
    const exported = await call('GET', `/api/watchlists/${fnoId}/export`);
    assert.equal(exported.body.trim().split('\n').length, fno.length);
  }));

test('create, rename, add and remove symbols, delete', { skip: noDb }, () =>
  withApi(async ({ call }) => {
    const created = await call('POST', '/api/watchlists', { name: ' Banks ', description: 'PSU' });
    assert.equal(created.statusCode, 201);
    const { id } = created.json().watchlist;
    assert.equal(created.json().watchlist.name, 'Banks');
    assert.equal((await call('POST', '/api/watchlists', { name: 'Banks' })).statusCode, 409, 'names are unique');

    assert.equal((await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'sbin' })).json().symbol, 'NSE:SBIN-EQ');
    await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'NSE:SBIN-EQ' }); // duplicate ignored
    await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'SBICARD' });
    assert.match((await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'BANKNIFTY' })).json().error, /index/);
    assert.match((await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'ZOMATO' })).json().error, /not an NSE equity/);

    let got = (await call('GET', `/api/watchlists/${id}`)).json();
    assert.deepEqual(got.symbols.map((s) => [s.symbol, s.name, s.latest]), [
      ['NSE:SBIN-EQ', 'STATE BANK OF INDIA', null],
      ['NSE:SBICARD-EQ', 'SBI CARDS & PAY SER LTD', null],
    ]);

    assert.equal((await call('DELETE', `/api/watchlists/${id}/symbols/${encodeURIComponent('NSE:SBIN-EQ')}`)).statusCode, 204);
    const renamed = (await call('PATCH', `/api/watchlists/${id}`, { name: 'PSU banks', description: null })).json().watchlist;
    assert.deepEqual([renamed.name, renamed.description], ['PSU banks', null]);
    got = (await call('GET', `/api/watchlists/${id}`)).json();
    assert.deepEqual(got.symbols.map((s) => s.symbol), ['NSE:SBICARD-EQ']);

    assert.equal((await call('DELETE', `/api/watchlists/${id}`)).statusCode, 204);
    assert.equal((await call('GET', `/api/watchlists/${id}`)).statusCode, 404);
  }));

test('import: preview writes nothing; add, replace and new modes', { skip: noDb }, () =>
  withApi(async ({ call }) => {
    const { id } = (await call('POST', '/api/watchlists', { name: 'L' })).json().watchlist;
    await call('POST', `/api/watchlists/${id}/symbols`, { symbol: 'RELIANCE' });

    const preview = (await call('POST', `/api/watchlists/${id}/import/preview`, { fileName: 'x.txt', text: 'SBIN,RELIANCE\nNIFTY\nNOPE' })).json();
    assert.deepEqual(preview.counts, { add: 1, already: 1, skipped: 2 });
    assert.equal((await call('GET', `/api/watchlists/${id}`)).json().symbols.length, 1, 'preview wrote nothing');
    assert.equal((await call('POST', `/api/watchlists/${id}/import/preview`, { text: 'A\n'.repeat(501) })).statusCode, 400);

    let res = await call('POST', `/api/watchlists/${id}/import`, { mode: 'add', fileName: 'x.txt', symbols: ['SBIN', 'NSE:SBIN-EQ'] });
    assert.equal(res.json().watchlist.count, 2);
    assert.equal(res.json().watchlist.sourceFile, 'x.txt');

    res = await call('POST', `/api/watchlists/${id}/import`, { mode: 'replace', fileName: 'y.txt', symbols: ['TMPV', 'ETERNAL'] });
    const symbols = (await call('GET', `/api/watchlists/${id}`)).json().symbols.map((s) => s.symbol);
    assert.deepEqual(symbols.sort(), ['NSE:ETERNAL-EQ', 'NSE:TMPV-EQ']);

    res = await call('POST', `/api/watchlists/${id}/import`, { mode: 'new', name: 'Fresh', fileName: 'z.txt', symbols: ['SBILIFE'] });
    assert.equal(res.statusCode, 201);
    assert.deepEqual([res.json().watchlist.name, res.json().watchlist.source, res.json().watchlist.count], ['Fresh', 'import', 1]);
    assert.equal((await call('GET', `/api/watchlists/${id}`)).json().symbols.length, 2, 'source list untouched');

    assert.equal((await call('POST', `/api/watchlists/${id}/import`, { mode: 'add', symbols: ['NIFTY'] })).statusCode, 400, 're-validated');
    assert.equal((await call('POST', `/api/watchlists/${id}/import`, { mode: 'new', symbols: ['SBIN'] })).statusCode, 400, 'new needs a name');
  }));

test('symbols show the latest finished run that included them; export is one per line', { skip: noDb }, () =>
  withApi(async ({ call, pool }) => {
    const { id } = (await call('POST', '/api/watchlists', { name: 'L' })).json().watchlist;
    await call('POST', `/api/watchlists/${id}/import`, { mode: 'add', symbols: ['SBIN', 'TMPV'] });

    const insertRun = async (finishedAt, pnl) => {
      const { rows } = await pool.query(
        `insert into runs (status, config, from_date, to_date, symbols, total, finished_at)
         values ('done', '{}', '2026-01-01', '2026-01-31', '{NSE:SBIN-EQ}', 1, $1) returning id`,
        [finishedAt]
      );
      await pool.query(
        `insert into run_symbols (run_id, symbol, position, status, metrics) values ($1, 'NSE:SBIN-EQ', 0, 'done', $2)`,
        [rows[0].id, { totalTrades: 12, winRate: 50, totalPnl: pnl }]
      );
      return Number(rows[0].id);
    };
    await insertRun('2026-02-01', -100);
    const latest = await insertRun('2026-03-01', 250);

    const got = (await call('GET', `/api/watchlists/${id}`)).json().symbols;
    assert.deepEqual(got.find((s) => s.symbol === 'NSE:SBIN-EQ').latest, { runId: latest, trades: 12, winRate: 50, totalPnl: 250 });
    assert.equal(got.find((s) => s.symbol === 'NSE:TMPV-EQ').latest, null, 'not in a run');

    const exp = await call('GET', `/api/watchlists/${id}/export`);
    assert.match(exp.headers['content-disposition'], /filename="L.txt"/);
    assert.deepEqual(exp.body.trim().split('\n').sort(), ['NSE:SBIN-EQ', 'NSE:TMPV-EQ']);
  }));
