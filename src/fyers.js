// Fyers OAuth client, shared by the backtest and the live runner. The access
// token dies at the end of each trading day, so this caches it and tells you
// plainly when it needs regenerating (`npm run login`).

const fs = require('fs');
const path = require('path');
const { fyersModel } = require('fyers-api-v3');
const { istToday } = require('./time');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'token.json');

// Fyers allows 200 REST calls a minute, and breaching that three times in a day
// blocks the account until tomorrow — live runner included. Every REST call goes
// through rest(), one at a time and at least this far apart (≤171/min).
const MIN_GAP_MS = 350;

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

let queue = Promise.resolve();
let lastCall = 0;

// Runs fn() once it is this call's turn and the gap since the last call has passed.
function rest(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { newClient, client, socketToken, readToken, saveToken, rest };
