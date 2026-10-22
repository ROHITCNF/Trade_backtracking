const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fyersTokenExpiry } = require('../src/time');
const { createFileStore } = require('../src/fileStore');
const fyers = require('../src/fyers');

const ist = (s) => Date.parse(s + '+05:30');

test('token expiry is the next 06:30 IST', () => {
  assert.equal(fyersTokenExpiry(ist('2026-10-22T09:00:00')), ist('2026-10-23T06:30:00'));
  assert.equal(fyersTokenExpiry(ist('2026-10-22T23:59:00')), ist('2026-10-23T06:30:00'));
  // Issued after midnight but before 06:30: dies the same morning.
  assert.equal(fyersTokenExpiry(ist('2026-10-23T02:00:00')), ist('2026-10-23T06:30:00'));
  assert.equal(fyersTokenExpiry(ist('2026-10-23T06:30:00')), ist('2026-10-24T06:30:00'));
});

const tmpStore = () => createFileStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fyers-')) });

test('file store round-trips the token and reads legacy files', async () => {
  const store = tmpStore();
  assert.equal(await store.readToken(), null);
  await store.saveToken({ access_token: 'abc', expiresAt: 123 });
  assert.deepEqual(await store.readToken(), { access_token: 'abc', expiresAt: 123 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fyers-'));
  fs.writeFileSync(path.join(dir, 'token.json'), JSON.stringify({ date: '2026-10-22', access_token: 'old' }));
  const legacy = await createFileStore({ dir }).readToken();
  assert.equal(legacy.expiresAt, ist('2026-10-23T06:30:00'));
});

test('readToken ignores an expired token', async () => {
  const store = tmpStore();
  fyers.setStore(store);
  await store.saveToken({ access_token: 'dead', expiresAt: Date.now() - 1 });
  assert.equal(await fyers.readToken(), null);
  await fyers.saveToken('live');
  assert.equal(await fyers.readToken(), 'live');
  assert.equal((await fyers.tokenStatus()).connected, true);
});

test('rest() counts calls, enforces the daily cap and spaces calls', async () => {
  fyers.setStore(tmpStore());
  process.env.REST_DAILY_CAP = '2';
  try {
    const t0 = Date.now();
    await fyers.rest(async () => ({ s: 'ok' }));
    await fyers.rest(async () => ({ s: 'ok' }));
    assert.ok(Date.now() - t0 >= fyers.MIN_GAP_MS - 20, 'second call waited for its slot');
    assert.equal((await fyers.usageToday()).count, 2);
    await assert.rejects(fyers.rest(async () => ({ s: 'ok' })), /daily REST budget used/);
  } finally {
    delete process.env.REST_DAILY_CAP;
  }
});

test('a 429 pauses every later call for the day', async () => {
  fyers.setStore(tmpStore());
  const res = await fyers.rest(async () => ({ s: 'error', code: 429 }));
  assert.equal(res.code, 429);
  assert.equal((await fyers.usageToday()).limited, true);
  await assert.rejects(fyers.rest(async () => ({ s: 'ok' })), /429 earlier today/);
});
