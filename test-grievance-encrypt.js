/**
 * PM Kisan Grievance — Encrypt / Decrypt CLI
 *
 * Usage:
 *   node test-grievance-encrypt.js encrypt '{"Type":"IdentityNo_Details","TokenNo":"PMK_123456","IdentityNo":"b239...","GrievanceType":"G002","GrievanceDescription":"Test"}'
 *   node test-grievance-encrypt.js decrypt 'base64(ciphertext+tag)'
 */

const crypto = require("crypto");

// ── Keys (set via env or fallback to defaults) ──────────────────────────────
const GRIEVANCE_KEY_1 =
  process.env.GRIEVANCE_KEY_1 ||
  "B275D03C722F85941A287A08B27EA7C70BE436D9BC85A7EB60BFB53AFEA273C6";

const GRIEVANCE_KEY_2 =
  process.env.GRIEVANCE_KEY_2 || "62958328A844AAE69BDFFBFC7F3D9E1C";

function encrypt(plainText) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex"); // 32 bytes
  const nonce = Buffer.from(GRIEVANCE_KEY_2, "hex"); // nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ciphertext, tag]).toString("base64");
}

function decrypt(encryptedBase64) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex");
  const nonce = Buffer.from(GRIEVANCE_KEY_2, "hex");
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");
  if (encryptedBytes.length < 17) {
    throw new Error("Invalid encrypted payload: too short for GCM tag");
  }
  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

// ── CLI ────────────────────────────────────────────────────────────────────
const [, , command, input] = process.argv;

if (!command || !input) {
  console.log(`
Usage:
  node test-grievance-encrypt.js encrypt '<json string>'
  node test-grievance-encrypt.js decrypt '<base64 string>'
`);
  process.exit(1);
}

if (command === "encrypt") {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    console.error("Error: input is not valid JSON");
    process.exit(1);
  }

  const encryptedText = encrypt(JSON.stringify(parsed));
  console.log("\n=== INPUT JSON ===");
  console.log(JSON.stringify(parsed, null, 2));
  console.log("\n=== ENCRYPTED (base64) ===");
  console.log(encryptedText);
  console.log("\n=== REQUEST BODY ===");
  console.log(JSON.stringify({ EncryptedRequest: encryptedText }, null, 2));
} else if (command === "decrypt") {
  try {
    const decryptedText = decrypt(input);
    console.log("\n=== DECRYPTED STRING ===");
    console.log(decryptedText);
    try {
      console.log("\n=== PARSED JSON ===");
      console.log(JSON.stringify(JSON.parse(decryptedText), null, 2));
    } catch {
      console.log("\n[Note] Decrypted value is plain text, not JSON.");
    }
  } catch (err) {
    console.error("\n=== DECRYPTION FAILED ===");
    console.error(err.message);
  }
} else {
  console.error(`Unknown command: "${command}". Use "encrypt" or "decrypt".`);
  process.exit(1);
}
