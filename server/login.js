// Daily login. Prints the Fyers URL, waits for the redirect, saves the token.
//
//   npm run login

require('../src/env').loadEnv();

const { newClient, saveToken, readToken, today } = require('../src/fyers');
const { waitForAuthCode } = require('./callback');

async function main() {
  if (readToken()) {
    console.log(`Already have a token for ${today()}. Nothing to do.`);
    return;
  }

  const fyers = newClient();
  const redirectUri = process.env.FYERS_REDIRECT_URI;

  console.log('\nOpen this URL and log in:\n');
  console.log(fyers.generateAuthCode());
  console.log('');

  const auth_code = await waitForAuthCode(redirectUri);

  const res = await fyers.generate_access_token({
    client_id: process.env.FYERS_APP_ID,
    secret_key: process.env.FYERS_SECRET_ID,
    auth_code,
  });
  if (res.s !== 'ok') throw new Error(`Token exchange failed: ${JSON.stringify(res)}`);

  saveToken(res.access_token);
  fyers.setAccessToken(res.access_token);

  const profile = await fyers.get_profile();
  console.log(`\nLogged in as ${profile.data?.name ?? '(name unavailable)'} — token saved for ${today()}.\n`);
}

main().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
