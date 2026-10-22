// Daily login. Prints the Fyers URL, catches the OAuth redirect on localhost so
// the auth code never has to be copy-pasted, and saves the token.
//
//   npm run login
//
// The redirect URI registered on the Fyers app must match FYERS_REDIRECT_URI exactly.

require('../src/env').loadEnv();

const http = require('http');
const { newClient, saveToken, readToken } = require('../src/fyers');

function waitForAuthCode(redirectUri) {
  const url = new URL(redirectUri);
  const port = Number(url.port || 80);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const code = new URL(req.url, redirectUri).searchParams.get('auth_code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        code
          ? '<h2>Logged in.</h2><p>You can close this tab and go back to the terminal.</p>'
          : '<h2>No auth_code in that redirect.</h2>'
      );
      if (code) {
        server.close();
        resolve(code);
      }
    });

    server.on('error', reject);
    server.listen(port, () => console.log(`Waiting for the redirect on ${redirectUri} ...`));
    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for login (5 min).')); }, 300000).unref();
  });
}

async function main() {
  if (await readToken()) {
    console.log('Already have a live token (Fyers expires it at 06:30 IST). Nothing to do.');
    return;
  }

  const fyers = newClient();

  console.log('\nOpen this URL and log in:\n');
  console.log(fyers.generateAuthCode());
  console.log('');

  const auth_code = await waitForAuthCode(process.env.FYERS_REDIRECT_URI);

  const res = await fyers.generate_access_token({
    client_id: process.env.FYERS_APP_ID,
    secret_key: process.env.FYERS_SECRET_ID,
    auth_code,
  });
  if (res.s !== 'ok') throw new Error(`Token exchange failed: ${JSON.stringify(res)}`);

  await saveToken(res.access_token);
  fyers.setAccessToken(res.access_token);

  const profile = await fyers.get_profile();
  console.log(`\nLogged in as ${profile.data?.name ?? '(name unavailable)'} — token saved until 06:30 IST tomorrow.\n`);
}

main().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
