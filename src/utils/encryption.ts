import * as crypto from 'crypto';
import { createCipheriv, createDecipheriv } from 'crypto';

export function getUniqueKey(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function encrypt(text: string, key: string): Promise<string> {
  try {
    const keyBytes = Buffer.alloc(16); // Create a buffer of 16 bytes for the key
    const pwdBytes = Buffer.from(key, 'utf-8'); // Convert the key to bytes
    const len = Math.min(pwdBytes.length, keyBytes.length);
    pwdBytes.copy(keyBytes, 0, 0, len); // Copy the key into the buffer

    // Initialize the cipher configuration
    const cipher = createCipheriv('aes-128-cbc', keyBytes, keyBytes);
    cipher.setAutoPadding(true);

    // Encrypt the data
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

export async function decrypt(textToDecrypt: string, key: string): Promise<string> {
  try {
    const keyBytes = Buffer.alloc(16); // Create a buffer of 16 bytes for the key
    const pwdBytes = Buffer.from(key, 'utf-8'); // Convert the key to bytes
    const len = Math.min(pwdBytes.length, keyBytes.length);
    pwdBytes.copy(keyBytes, 0, 0, len); // Copy the key into the buffer

    const encryptedData = Buffer.from(textToDecrypt, 'base64'); // Convert the encrypted text from Base64 to bytes

    // Initialize the cipher configuration
    const decipher = createDecipheriv('aes-128-cbc', keyBytes, keyBytes);
    decipher.setAutoPadding(true); // Use PKCS#7 padding (matches encrypt)

    // Decrypt the data
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Convert the decrypted data to a UTF-8 string
    const decryptedText = decrypted.toString('utf-8').trim();
    return decryptedText;
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

function tryParseJsonOrLooseObject(text: string): any | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return null;
  // Quote unquoted keys and bareword values to coerce to strict JSON
  let candidate = trimmed;
  candidate = candidate.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  candidate = candidate.replace(/:\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*([,}])/g, (_m, v, tail) => {
    // If value is a valid number, keep as is; else quote
    const isNumber = /^-?\d+(\.\d+)?$/.test(v);
    return isNumber ? `:${v}${tail}` : `:"${v}"${tail}`;
  });
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function decryptRequest(encryptedText: string, key: string): Promise<string> {
  try {
    const plain = await decrypt(encryptedText, key);
    const parsed = tryParseJsonOrLooseObject(plain);
    // Return strict JSON string if we could parse; otherwise return original plaintext
    return parsed ? JSON.stringify(parsed) : plain;
  } catch (error) {
    console.error('Decrypt request error:', error);
    throw error;
  }
} 