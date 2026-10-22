// Default storage for the Fyers token and the REST usage counter: two JSON files
// under data/. Used by the CLI and the live runner. The web service swaps in a
// Postgres store with the same shape (see setStore in src/fyers.js).
//
// Store contract — every method is async:
//   readToken()          -> { access_token, expiresAt } | null   (expiresAt: epoch ms)
//   saveToken(record)    -> void
//   readUsage()          -> raw usage record | null
//   updateUsage(fn)      -> fn(raw | null) returns { usage, result }; usage is
//                           written atomically with respect to other processes,
//                           result is returned. fn may throw to abort.

const fs = require('fs');
const path = require('path');
const { dateToEpoch, fyersTokenExpiry } = require('./time');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STALE_LOCK_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function createFileStore({ dir = DATA_DIR } = {}) {
  const tokenFile = path.join(dir, 'token.json');
  const usageFile = path.join(dir, 'rest-usage.json');
  const lockDir = usageFile + '.lock';

  // mkdir is atomic, so it doubles as a cross-process lock. A lock left behind by
  // a killed process is cleared once it is older than STALE_LOCK_MS.
  async function withLock(fn) {
    fs.mkdirSync(dir, { recursive: true });
    for (;;) {
      try {
        fs.mkdirSync(lockDir);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lockDir).mtimeMs > STALE_LOCK_MS) fs.rmdirSync(lockDir);
        } catch {}
        await sleep(20);
      }
    }
    try {
      return await fn();
    } finally {
      fs.rmdirSync(lockDir);
    }
  }

  return {
    async readToken() {
      const saved = readJson(tokenFile);
      if (!saved?.access_token) return null;
      // Files written before expiresAt existed carry only the IST date of issue;
      // assume it was issued after that morning's expiry, so it lives until the next.
      const expiresAt = saved.expiresAt ?? fyersTokenExpiry(dateToEpoch(saved.date) * 1000 + 7 * 3600000);
      return { access_token: saved.access_token, expiresAt };
    },

    async saveToken({ access_token, expiresAt }) {
      fs.mkdirSync(dir, { recursive: true });
      const record = { access_token, expiresAt, expires: new Date(expiresAt).toISOString() };
      fs.writeFileSync(tokenFile, JSON.stringify(record, null, 2));
    },

    async readUsage() {
      return readJson(usageFile);
    },

    async updateUsage(fn) {
      return withLock(() => {
        const { usage, result } = fn(readJson(usageFile));
        fs.writeFileSync(usageFile, JSON.stringify(usage));
        return result;
      });
    },
  };
}

module.exports = { createFileStore };
