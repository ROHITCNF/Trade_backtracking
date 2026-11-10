const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../api/config');

const env = { DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) };

test('mail is off unless BREVO_API_KEY and MAIL_TO are both set', () => {
  assert.equal(loadConfig(env).mail, null);
  assert.equal(loadConfig({ ...env, BREVO_API_KEY: 'k' }).mail, null);
  assert.equal(loadConfig({ ...env, MAIL_TO: 'me@example.com' }).mail, null);
});

test('mail settings default the sender to the recipient and the list to final', () => {
  assert.deepEqual(loadConfig({ ...env, BREVO_API_KEY: 'k', MAIL_TO: 'me@example.com' }).mail, {
    apiKey: 'k',
    from: 'me@example.com',
    to: 'me@example.com',
    watchlist: 'final',
  });
  const set = loadConfig({ ...env, BREVO_API_KEY: 'k', MAIL_TO: 'me@example.com', MAIL_FROM: 'bot@example.com', MAIL_WATCHLIST: 'core' });
  assert.equal(set.mail.from, 'bot@example.com');
  assert.equal(set.mail.watchlist, 'core');
});
