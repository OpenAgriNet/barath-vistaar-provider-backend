/**
 * PM Kisan Grievance — Encrypt / Decrypt CLI tool
 *
 * Usage:
 *   node test-grievance.js encrypt '{"Type":"Reg_No_Details","TokenNo":"PMK_123456","IdentityNo":"BR295454592","GrievanceType":"101","GrievanceDescription":"Test"}'
 *   node test-grievance.js decrypt 'dP8MTRIK+MKV+xbe...'
 */

const crypto = require("crypto");

const GRIEVANCE_KEY_1 =
  process.env.GRIEVANCE_KEY_1 ||
  "B275D03C722F85941A287A08B27EA7C70BE436D9BC85A7EB60BFB53AFEA273C6";

const GRIEVANCE_KEY_2 =
  process.env.GRIEVANCE_KEY_2 || "62958328A844AAE69BDFFBFC7F3D9E1C";

function encrypt(plainText) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex");
  const iv  = Buffer.from(GRIEVANCE_KEY_2, "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(true);
  let out = cipher.update(plainText, "utf8", "base64");
  out += cipher.final("base64");
  return out;
}

function decrypt(encryptedBase64) {
  const key = Buffer.from(GRIEVANCE_KEY_1, "hex");
  const iv  = Buffer.from(GRIEVANCE_KEY_2, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  let out = decipher.update(encryptedBase64, "base64", "utf8");
  out += decipher.final("utf8");
  return out;
}

// ── CLI ────────────────────────────────────────────────────────────────────
const [, , command, input] = process.argv;

if (!command || !input) {
  console.log(`
Usage:
  node test-grievance.js encrypt '<json string>'
  node test-grievance.js decrypt '<base64 string>'
  `);
  process.exit(1);
}

if (command === "encrypt") {
  // Validate JSON first
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    console.error("Error: input is not valid JSON");
    process.exit(1);
  }

  const plainText = JSON.stringify(parsed);
  const encryptedText = encrypt(plainText);

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
      const parsed = JSON.parse(decryptedText);
      console.log("\n=== PARSED JSON ===");
      console.log(JSON.stringify(parsed, null, 2));
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
