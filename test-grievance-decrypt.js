/**
 * PM Kisan Grievance — DECRYPT test
 * Usage:
 *   node test-grievance-decrypt.js "<encryptedBase64>"
 *   node test-grievance-decrypt.js decrypt "<encryptedBase64>"
 *
 * Paste the encrypted base64 string from the API response into ENCRYPTED_INPUT.
 * Decrypts using AES-256-GCM with GRIEVANCE_KEY_1 (key) + GRIEVANCE_KEY_2 (nonce).
 * Input format must be base64(ciphertext + tag).
 */

const crypto = require("crypto");

// ── Keys ───────────────────────────────────────────────────────────────────
const GRIEVANCE_KEY_1 =
  process.env.GRIEVANCE_KEY_1 ||
  "B275D03C722F85941A287A08B27EA7C70BE436D9BC85A7EB60BFB53AFEA273C6";

const GRIEVANCE_KEY_2 =
  process.env.GRIEVANCE_KEY_2 || "62958328A844AAE69BDFFBFC7F3D9E1C";

// ── Paste the encrypted base64 string here ─────────────────────────────────
const ENCRYPTED_INPUT =
  "dP8MTRIK+MKV+xbeHfVQMSEGFmC7ALStUEZypYngqk0nfay3KESWxNnv5lQi8z4y" +
  "wlF2hVQcNOWCoYNtOccDz3MKbZNcGoiOHvZvYrK/AvCqseveth9zoyJWgSa4sFqi" +
  "K0F0w4aQSquWhO3EEMzR9+wywnM+ZuusMyRaKNqWYpNm7zuHBSBVxNNsGQMh1Hwm" +
  "P/XavkKV69XAMRonIElJagJbplN6vcErIokQJvYbYaE=";

// ── Decrypt ────────────────────────────────────────────────────────────────
function decrypt(encryptedBase64) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex"); // 32 bytes
  const nonce  = Buffer.from(GRIEVANCE_KEY_2, "hex"); // nonce
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");
  if (encryptedBytes.length < 17) {
    throw new Error("Invalid encrypted payload: too short for GCM tag");
  }
  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── CLI input handling ─────────────────────────────────────────────────────
function getEncryptedInputFromArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  if (args[0] === "decrypt") return args[1] || null;
  return args[0];
}

const encryptedInput = getEncryptedInputFromArgs() || ENCRYPTED_INPUT;

// ── Run ────────────────────────────────────────────────────────────────────
console.log("\n=== ENCRYPTED INPUT ===");
console.log(encryptedInput);

try {
  const decryptedText = decrypt(encryptedInput);

  console.log("\n=== DECRYPTED STRING ===");
  console.log(decryptedText);

  try {
    const parsed = JSON.parse(decryptedText);
    console.log("\n=== PARSED JSON ===");
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("\n[Note] Decrypted value is not JSON — shown as plain text above.");
  }
} catch (err) {
  console.error("\n=== DECRYPTION FAILED ===");
  console.error(err.message);
  console.error(
    "\nPossible reasons:\n" +
    "  1. The encrypted string is not valid base64\n" +
    "  2. The keys do not match what was used during encryption\n" +
    "  3. The string is a plain-text error, not an encrypted response"
  );
}
