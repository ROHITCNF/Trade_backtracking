// Fyers OAuth. The access token dies at the end of each trading day, so this
// caches it and tells you plainly when it needs regenerating.

const fs = require('fs');
const path = require('path');
const { fyersModel } = require('fyers-api-v3');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'live', 'token.json');

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Fill it in server/.env (see .env.example).`);
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
  // Tokens expire end of day, so one saved yesterday is already dead.
  return saved.date === today() ? saved.access_token : null;
}

function saveToken(access_token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ date: today(), access_token }, null, 2));
}

function today() {
  // IST date, so the token expires on the market's calendar rather than UTC's.
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Ready-to-use client, or an error telling you to log in.
function client() {
  const access_token = readToken();
  if (!access_token) throw new Error("No token for today. Run `npm run login` first.");
  const fyers = newClient();
  fyers.setAccessToken(access_token);
  return fyers;
}

function socketToken() {
  const access_token = readToken();
  if (!access_token) throw new Error("No token for today. Run `npm run login` first.");
  return `${required('FYERS_APP_ID')}:${access_token}`;
}

module.exports = { newClient, client, socketToken, readToken, saveToken, today };
