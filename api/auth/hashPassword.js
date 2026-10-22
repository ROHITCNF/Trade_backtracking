// Prints a bcrypt hash for APP_PASSWORD_HASH. The password is read from stdin,
// never argv, so it stays out of shell history:
//   npm run -s hash-password            (prompts)
//   printf '%s' "$PW" | npm run -s hash-password

const bcrypt = require('bcryptjs');
const readline = require('readline');

function readPassword() {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (c) => (data += c)).on('end', () => resolve(data.replace(/\r?\n$/, '')));
    });
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl.question('Password: ', (pw) => {
      rl.close();
      process.stdout.write('\n');
      resolve(pw);
    });
    rl._writeToOutput = (s) => rl.output.write(s.startsWith('Password: ') ? s : ''); // no echo
  });
}

readPassword().then((pw) => {
  if (pw.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
  }
  console.log(bcrypt.hashSync(pw, 12));
});
