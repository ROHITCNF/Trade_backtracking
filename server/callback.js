// Catches the OAuth redirect so the auth code never has to be copy-pasted.
// The redirect URI registered on the Fyers app must match REDIRECT_URI exactly.

const http = require('http');

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
    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for login (5 min).')); }, 300000);
  });
}

module.exports = { waitForAuthCode };
