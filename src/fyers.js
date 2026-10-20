// Fyers OAuth client, shared by the backtest and the live runner. The access
// token dies at the end of each trading day, so this caches it and tells you
// plainly when it needs regenerating (`npm run login`).

const fs = require('fs');
const path = require('path');
const { fyersModel } = require('fyers-api-v3');
const { istToday } = require('./time');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'token.json');

// Standard plan, Data APIs (history included): 5/sec, 50/min, 5,000/day.
// Breaching the per-minute cap three times in a day blocks the account until
// tomorrow — live runner included. Every REST call goes through rest(), which
// spaces calls at least MIN_GAP_MS apart (≤46/min) and counts them against
// DAILY_CAP. Both live in data/rest-usage.json, so the live runner and a
// backtest running at the same time share one clock and one count.
// https://fyers.in/api-docs/v3/getting-started/plans-and-limits/
const MIN_GAP_MS = 1300;
const DAILY_CAP = 4800;
const USAGE_FILE = path.join(__dirname, '..', 'data', 'rest-usage.json');
const LOCK_DIR = USAGE_FILE + '.lock';
const STALE_LOCK_MS = 5000;

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

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  // Tokens expire end of day (IST), so one saved yesterday is already dead.
  return saved.date === istToday() ? saved.access_token : null;
}

function saveToken(access_token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ date: istToday(), access_token }, null, 2));
}

function accessToken() {
  const access_token = readToken();
  if (!access_token) throw new Error('No Fyers token for today. Run `npm run login` first.');
  return access_token;
}

// Ready-to-use client, or an error telling you to log in.
let cached = null;
function client() {
  if (!cached) {
    cached = newClient();
    cached.setAccessToken(accessToken());
  }
  return cached;
}

function socketToken() {
  return `${required('FYERS_APP_ID')}:${accessToken()}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mkdir is atomic, so it doubles as a cross-process lock. A lock left behind by
// a killed process is cleared once it is older than STALE_LOCK_MS.
async function withLock(fn) {
  fs.mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > STALE_LOCK_MS) fs.rmdirSync(LOCK_DIR);
      } catch {}
      await sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(LOCK_DIR);
  }
}

function readUsage() {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (u.date === istToday()) return u;
  } catch {}
  return { date: istToday(), count: 0, next: 0, limited: false };
}

// Claims the next free slot across all processes: returns when this call may go.
async function reserveSlot() {
  const at = await withLock(() => {
    const u = readUsage();
    if (u.limited) throw new Error('Fyers returned 429 earlier today; REST paused to avoid a block. Wait for the window to reset, then delete data/rest-usage.json.');
    if (u.count >= DAILY_CAP) throw new Error(`Fyers daily REST budget used (${u.count}/${DAILY_CAP}). Try again tomorrow.`);
    const at = Math.max(Date.now(), u.next);
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ ...u, count: u.count + 1, next: at + MIN_GAP_MS }));
    return at;
  });
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}

// One 429 is the first strike toward a block, so stop every process from
// making further calls today rather than letting a loop keep hammering.
const isRateLimited = (r) => r && (r.code === -429 || r.code === 429 || r.status === 429);

async function markLimited() {
  await withLock(() => {
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ ...readUsage(), limited: true }));
  });
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

module.exports = { newClient, client, socketToken, readToken, saveToken, rest };
