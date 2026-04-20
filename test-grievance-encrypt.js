/**
 * PM Kisan Grievance — ENCRYPT test
 * Usage: node test-grievance-encrypt.js
 *
 * Encrypts the payload JSON using AES-256-CBC
 * Keys: GRIEVANCE_KEY_1 (32-byte AES key) + GRIEVANCE_KEY_2 (16-byte IV)
 */

const crypto = require("crypto");

// ── Keys (paste your actual keys here or export them as env vars) ──────────
const GRIEVANCE_KEY_1 =
  process.env.GRIEVANCE_KEY_1 ||
  "B275D03C722F85941A287A08B27EA7C70BE436D9BC85A7EB60BFB53AFEA273C6";

const GRIEVANCE_KEY_2 =
  process.env.GRIEVANCE_KEY_2 || "62958328A844AAE69BDFFBFC7F3D9E1C";

// ── Payload to encrypt ─────────────────────────────────────────────────────
const payload = {
  Type: "Reg_No_Details",
  TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN || "PMK_123456",
  IdentityNo: "BR295454592",         // reg-number from Beckn body
  GrievanceType: "101",              // grievance type code
  GrievanceDescription: "Test grievance description from documentation",
};

// ── Encrypt ────────────────────────────────────────────────────────────────
function encrypt(plainText) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex"); // 32 bytes → AES-256
  const iv  = Buffer.from(GRIEVANCE_KEY_2, "hex"); // 16 bytes → CBC IV

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(true);

  let encrypted = cipher.update(plainText, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

// ── Run ────────────────────────────────────────────────────────────────────
const plainText = JSON.stringify(payload);

console.log("\n=== INPUT PAYLOAD ===");
console.log(JSON.stringify(payload, null, 2));

console.log("\n=== PLAIN TEXT STRING ===");
console.log(plainText);

const encryptedText = encrypt(plainText);

console.log("\n=== ENCRYPTED (base64) ===");
console.log(encryptedText);

console.log("\n=== REQUEST BODY TO SEND ===");
console.log(JSON.stringify({ EncryptedRequest: encryptedText }, null, 2));
