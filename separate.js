const crypto = require('crypto');

// Same as getUniqueKey() in encryption.ts – key is auto-generated per encrypt.
// For decrypt you must use the same key that was used when encrypting (e.g. from API response).
function getUniqueKey() {
  return crypto.randomBytes(16).toString('hex');
}

function encrypt(text, key) {
  const keyBytes = Buffer.alloc(16);
  const pwdBytes = Buffer.from(key, 'utf-8');
  const len = Math.min(pwdBytes.length, keyBytes.length);
  pwdBytes.copy(keyBytes, 0, 0, len);

  const cipher = crypto.createCipheriv('aes-128-cbc', keyBytes, keyBytes);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function tryParseJsonOrLooseObject(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // continue
  }

  // Heuristic: convert "{Types:Mobile,Values:876,...}" into valid JSON
  // by quoting keys and bareword (non-numeric) values.
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return null;

  let candidate = trimmed;
  candidate = candidate.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  candidate = candidate.replace(/:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*([,}])/g, ':"$1"$2');

  try {
    return JSON.parse(candidate);
  } catch (_) {
    return null;
  }
}

function decrypt(textToDecrypt, key) {
  const keyBytes = Buffer.alloc(16);
  const pwdBytes = Buffer.from(key, 'utf-8');
  const len = Math.min(pwdBytes.length, keyBytes.length);
  pwdBytes.copy(keyBytes, 0, 0, len);

  const encryptedData = Buffer.from(textToDecrypt, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBytes, keyBytes);
  decipher.setAutoPadding(true);

  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf-8').trim();
}

// Usage:
//   Encrypt: node scripts/separate.js encrypt "<json_string>"
//   Decrypt: node scripts/separate.js "encrypted_base64@key"
//   Decrypt: node scripts/separate.js "encrypted_base64" "key"
const mode = process.argv[2];

if (mode === 'encrypt') {
  const jsonString = process.argv[3] || '';
  if (!jsonString) {
    console.error('Usage: node scripts/separate.js encrypt \'<json_string>\'');
    process.exit(1);
  }
  try {
    const key = getUniqueKey();
    const encrypted = encrypt(jsonString, key);
    console.log('Encrypted (base64):', encrypted);
    console.log('Key:', key);
    console.log('EncryptedRequest:', encrypted + '@' + key);
  } catch (err) {
    console.error('Encryption error:', err.message);
    process.exit(1);
  }
  process.exit(0);
}

const arg1 = process.argv[2];
const arg2 = process.argv[3];

let encryptedText, key;
if (arg2) {
  encryptedText = arg1;
  key = arg2;
} else if (arg1 && arg1.includes('@')) {
  const at = arg1.lastIndexOf('@');
  encryptedText = arg1.substring(0, at);
  key = arg1.substring(at + 1);
} else {
  encryptedText = arg1 || 'YOUR_ENCRYPTED_BASE64_HERE';
  key = 'YOUR_KEY_HERE';
}

if (!encryptedText || !key || key === 'YOUR_KEY_HERE') {
  console.error('Encrypt: node scripts/separate.js encrypt \'<json_string>\'');
  console.error('Decrypt: node scripts/separate.js "<encrypted_base64>" "<key>"');
  console.error('Decrypt: node scripts/separate.js "<encrypted_base64@key>"');
  process.exit(1);
}

try {
  const decrypted = decrypt(encryptedText, key);
  try {
    const parsed = tryParseJsonOrLooseObject(decrypted);
    if (parsed) {
      console.log(JSON.stringify(parsed, null, 2));
      process.exit(0);
    }
  } catch (_) {}
  console.log(decrypted);
} catch (err) {
  console.error('Decryption error:', err.message);
  process.exit(1);
}
