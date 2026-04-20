/**
 * PM Kisan Grievance — Encryption variant tester
 *
 * Tests all possible key-encoding + algorithm combinations.
 * Send each "EncryptedRequest" to the PM Kisan Grievance API and
 * whichever one does NOT return NullReferenceException is the correct variant.
 *
 * Usage:  node test-grievance-variants.js
 */

const crypto = require("crypto");

const KEY1 = "B275D03C722F85941A287A08B27EA7C70BE436D9BC85A7EB60BFB53AFEA273C6";
const KEY2 = "62958328A844AAE69BDFFBFC7F3D9E1C";

const payload = {
  Type: "Reg_No_Details",
  TokenNo: "PMK_123456",
  IdentityNo: "BR295454592",
  GrievanceType: "101",
  GrievanceDescription: "Test grievance description from documentation",
};

const plainText = JSON.stringify(payload);

// ── Helper ─────────────────────────────────────────────────────────────────
function makeKey(str, size, encoding) {
  const buf = Buffer.alloc(size);
  const src = Buffer.from(str, encoding);
  src.copy(buf, 0, 0, Math.min(src.length, size));
  return buf;
}

function encryptWith(algorithm, keyBuf, ivBuf, text) {
  try {
    const cipher = crypto.createCipheriv(algorithm, keyBuf, ivBuf);
    cipher.setAutoPadding(true);
    let out = cipher.update(text, "utf8", "base64");
    out += cipher.final("base64");
    return out;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

// ── All variants ───────────────────────────────────────────────────────────
const variants = [
  {
    label: "Variant 1 — aes-256-cbc | KEY1 as HEX (32 bytes) | KEY2 as HEX (16 bytes)  [CURRENT]",
    algorithm: "aes-256-cbc",
    key: Buffer.from(KEY1, "hex"),       // 32 bytes
    iv:  Buffer.from(KEY2, "hex"),       // 16 bytes
  },
  {
    label: "Variant 2 — aes-256-cbc | KEY1 as UTF-8 (32 bytes) | KEY2 as UTF-8 (16 bytes)",
    algorithm: "aes-256-cbc",
    key: makeKey(KEY1, 32, "utf8"),      // first 32 chars of KEY1
    iv:  makeKey(KEY2, 16, "utf8"),      // first 16 chars of KEY2
  },
  {
    label: "Variant 3 — aes-128-cbc | KEY1 as UTF-8 (16 bytes) | KEY2 as UTF-8 (16 bytes)",
    algorithm: "aes-128-cbc",
    key: makeKey(KEY1, 16, "utf8"),      // first 16 chars of KEY1
    iv:  makeKey(KEY2, 16, "utf8"),      // first 16 chars of KEY2
  },
  {
    label: "Variant 4 — aes-128-cbc | KEY1 as UTF-8 (16 bytes) | KEY1 as IV (same key pattern)",
    algorithm: "aes-128-cbc",
    key: makeKey(KEY1, 16, "utf8"),      // first 16 chars of KEY1
    iv:  makeKey(KEY1, 16, "utf8"),      // same (like existing PM Kisan encrypt.ts)
  },
  {
    label: "Variant 5 — aes-256-cbc | KEY1 as UTF-8 (32 bytes) | KEY1 as IV (32→16 bytes)",
    algorithm: "aes-256-cbc",
    key: makeKey(KEY1, 32, "utf8"),
    iv:  makeKey(KEY1, 16, "utf8"),      // KEY1 first 16 as IV
  },
  {
    label: "Variant 6 — aes-128-cbc | KEY2 as UTF-8 (16 bytes) | KEY2 as IV (same key)",
    algorithm: "aes-128-cbc",
    key: makeKey(KEY2, 16, "utf8"),
    iv:  makeKey(KEY2, 16, "utf8"),
  },
];

// ── Run all ────────────────────────────────────────────────────────────────
console.log("\nPlain text being encrypted:");
console.log(plainText);
console.log("\n" + "=".repeat(80));

variants.forEach((v, i) => {
  const encrypted = encryptWith(v.algorithm, v.key, v.iv, plainText);
  console.log(`\n${v.label}`);
  console.log(`Key bytes (hex): ${v.key.toString("hex")}`);
  console.log(`IV  bytes (hex): ${v.iv.toString("hex")}`);
  console.log(`EncryptedRequest: ${encrypted}`);
  console.log(`Request body: ${JSON.stringify({ EncryptedRequest: encrypted })}`);
  console.log("-".repeat(80));
});

console.log(`
HOW TO USE:
  Copy each "Request body" above and POST it to:
  https://ws.pmkisan.gov.in/GrievanceService.asmx/LodgeGrievance
  with header: Content-Type: application/json

  The variant that does NOT return NullReferenceException is the correct one.
`);
