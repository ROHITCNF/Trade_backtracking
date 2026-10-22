const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileStore } = require('../src/fileStore');
const fyers = require('../src/fyers');
const { getCandles, isTransient, RETRY_DELAYS_MS } = require('../src/fetch');

// Every call still goes through rest(), so each test gets a fresh usage store
// and pays its 1.3 s spacing. Retry delays are shrunk to keep tests quick.
const fresh = () => fyers.setStore(createFileStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-')) }));
const fast = { retryDelays: [1, 1] };
const oneDay = { symbol: 'NSE:TEST-EQ', resolution: '1', fromDate: '2026-10-21', toDate: '2026-10-21' };
const ok = { s: 'ok', candles: [[1, 10, 11, 9, 10, 100]] };

// A client whose getHistory plays back the given outcomes in order: an object
// resolves, an { reject } wrapper rejects with its value.
function stubClient(outcomes) {
  const calls = [];
  return {
    calls,
    getHistory: async (req) => {
      calls.push(req);
      const next = outcomes[calls.length - 1];
      if (next && next.reject) throw next.reject;
      return next;
    },
  };
}

test('retries are 2 s then 5 s', () => {
  assert.deepEqual(RETRY_DELAYS_MS, [2000, 5000]);
});

test('timeouts, network errors and 5xx are transient; 429 and 4xx are not', () => {
  assert.equal(isTransient({ s: 'error', code: 500, message: 'ETIMEDOUT' }), true);
  assert.equal(isTransient({ s: 'error', code: -3008, message: 'ENOTFOUND' }), true);
  assert.equal(isTransient({ s: 'error', code: 503, message: 'Service Unavailable' }), true);
  assert.equal(isTransient({ s: 'error', code: 429 }), false);
  assert.equal(isTransient({ s: 'error', code: -429 }), false);
  assert.equal(isTransient({ s: 'error', code: -300, message: 'Invalid symbol' }), false);
  assert.equal(isTransient(new Error('No Fyers token for today.')), false);
});

test('a transient failure retries through rest() and then succeeds', async () => {
  fresh();
  const client = stubClient([
    { reject: { s: 'error', code: 500, message: 'ECONNRESET' } },
    { s: 'error', code: 502, message: 'Bad Gateway' },
    ok,
  ]);
  let calls = 0;
  const candles = await getCandles(oneDay, { ...fast, client, onCall: () => calls++ });
  assert.deepEqual(candles, ok.candles);
  assert.equal(client.calls.length, 3);
  assert.equal(calls, 3, 'retries are counted');
  assert.equal((await fyers.usageToday()).count, 3, 'retries spend budget');
});

test('a transient failure gives up after two retries', async () => {
  fresh();
  const outage = { reject: { s: 'error', code: 500, message: 'ETIMEDOUT' } };
  const client = stubClient([outage, outage, outage, ok]);
  await assert.rejects(getCandles(oneDay, { ...fast, client }), /Fyers history failed for NSE:TEST-EQ.*ETIMEDOUT/);
  assert.equal(client.calls.length, 3);
});

test('a 429 never retries', async () => {
  fresh();
  const client = stubClient([{ reject: { s: 'error', code: 429, message: 'rate limited' } }, ok]);
  let calls = 0;
  await assert.rejects(getCandles(oneDay, { ...fast, client, onCall: () => calls++ }), /429/);
  assert.equal(client.calls.length, 1);
  assert.equal(calls, 1);
  assert.equal((await fyers.usageToday()).limited, true);
});

test('onCall counts one call per chunk', async () => {
  fresh();
  // 61 days spans two 60-day chunks.
  const client = stubClient([ok, { s: 'no_data' }]);
  let calls = 0;
  const range = { ...oneDay, fromDate: '2026-08-21', toDate: '2026-10-20' };
  assert.deepEqual(await getCandles(range, { ...fast, client, onCall: () => calls++ }), ok.candles);
  assert.equal(calls, 2);
});
