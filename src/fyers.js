// Fyers OAuth client, shared by the backtest, the live runner and the web API.
// The access token dies every morning at 06:30 IST, so this keeps it in a store
// and tells you plainly when it needs regenerating (`npm run login`).
//
// Storage is pluggable: the CLI uses files under data/ (src/fileStore.js); the
// web service calls setStore() with a Postgres store of the same shape.

const path = require('path');
const { fyersModel } = require('fyers-api-v3');
const { istToday, fyersTokenExpiry } = require('./time');
const { createFileStore } = require('./fileStore');

// Standard plan, Data APIs (history included): 5/sec, 50/min, 5,000/day.
// Breaching the per-minute cap three times in a day blocks the account until
// tomorrow — live runner included. Every REST call goes through rest(), which
// spaces calls at least MIN_GAP_MS apart (≤46/min) and counts them against the
// daily cap. Both live in the store, so processes sharing a store share one
// clock and one count.
// https://fyers.in/api-docs/v3/getting-started/plans-and-limits/
const MIN_GAP_MS = 1300;
const DEFAULT_DAILY_CAP = 4800;

// Read lazily: entry scripts load .env after requiring this module.
const dailyCap = () => Number(process.env.REST_DAILY_CAP) || DEFAULT_DAILY_CAP;

let store = createFileStore();
let cached = null; // { client, token }

function setStore(next) {
  store = next;
  cached = null;
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Fill it in .env (see .env.example).`);
  return v;
}

function newClient() {
  const fyers = new fyersModel({ path: path.join(__dirname, '..', 'logs'), enableLogging: false });
  fyers.setAppId(required('FYERS_APP_ID'));
  fyers.setRedirectUrl(required('FYERS_REDIRECT_URI'));
  return fyers;
}

// The access token if one is stored and still alive, else null.
async function readToken() {
  const saved = await store.readToken();
  return saved && saved.expiresAt > Date.now() ? saved.access_token : null;
}

async function tokenStatus() {
  const saved = await store.readToken();
  const valid = Boolean(saved && saved.expiresAt > Date.now());
  return { connected: valid, expiresAt: valid ? saved.expiresAt : null };
}

async function saveToken(access_token, issuedAt = Date.now()) {
  await store.saveToken({ access_token, expiresAt: fyersTokenExpiry(issuedAt) });
  cached = null;
}

async function accessToken() {
  const access_token = await readToken();
  if (!access_token) throw new Error('No Fyers token for today. Run `npm run login` first.');
  return access_token;
}

// Ready-to-use client, or an error telling you to log in.
async function getClient() {
  const token = await accessToken();
  if (!cached || cached.token !== token) {
    const client = newClient();
    client.setAccessToken(token);
    cached = { client, token };
  }
  return cached.client;
}

async function socketToken() {
  return `${required('FYERS_APP_ID')}:${await accessToken()}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Today's usage record; a record from an earlier IST day counts as empty.
function today(raw) {
  return raw && raw.date === istToday() ? raw : { date: istToday(), count: 0, next: 0, limited: false };
}

async function usageToday() {
  return { ...today(await store.readUsage()), cap: dailyCap() };
}

// Claims the next free slot across all processes: returns when this call may go.
async function reserveSlot() {
  const at = await store.updateUsage((raw) => {
    const u = today(raw);
    if (u.limited) throw new Error('Fyers returned 429 earlier today; REST paused to avoid a block. Wait for the window to reset at 00:00 IST.');
    if (u.count >= dailyCap()) throw new Error(`Fyers daily REST budget used (${u.count}/${dailyCap()}). Try again tomorrow.`);
    const slot = Math.max(Date.now(), u.next);
    return { usage: { ...u, count: u.count + 1, next: slot + MIN_GAP_MS }, result: slot };
  });
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

// One 429 is the first strike toward a block, so stop every process from
// making further calls today rather than letting a loop keep hammering.
const isRateLimited = (r) => Boolean(r && (r.code === -429 || r.code === 429 || r.status === 429));

async function markLimited() {
  await store.updateUsage((raw) => ({ usage: { ...today(raw), limited: true } }));
}

let queue = Promise.resolve();

// Runs fn() once it is this call's turn and a slot is free.
function rest(fn) {
  const run = queue.then(async () => {
    await reserveSlot();
    let res;
    try {
      res = await fn();
    } catch (err) {
      if (isRateLimited(err)) await markLimited();
      throw err;
    }
    if (isRateLimited(res)) await markLimited();
    return res;
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = {
  newClient,
  getClient,
  socketToken,
  readToken,
  saveToken,
  tokenStatus,
  usageToday,
  rest,
  setStore,
  isRateLimited,
  MIN_GAP_MS,
};
