// AES-256-GCM for the Fyers token at rest (NFR-8). Stored layout:
// iv (12 bytes) | auth tag (16 bytes) | ciphertext. TOKEN_ENC_KEY is 32 random
// bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

const crypto = require('crypto');

const IV_BYTES = 12;
const TAG_BYTES = 16;

function encKey() {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) throw new Error('Missing TOKEN_ENC_KEY. Fill it in .env (see .env.example).');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`TOKEN_ENC_KEY must be 32 bytes of base64, got ${key.length} bytes.`);
  return key;
}

function encrypt(plaintext, key = encKey()) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

// Throws if the data was tampered with or the key is wrong.
function decrypt(blob, key = encKey()) {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
