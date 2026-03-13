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
    decipher.setAutoPadding(false); // Set auto padding to false

    // Decrypt the data
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Convert the decrypted data to a UTF-8 string
    let decryptedText = decrypted.toString('utf-8');

    // Trim the decrypted text to remove padding and get the JSON object
    const lastIndex = decryptedText.lastIndexOf('}');
    const trimmedText = lastIndex !== -1 
      ? decryptedText.substring(0, lastIndex + 1) 
      : decryptedText;

    return trimmedText;
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

export async function decryptRequest(encryptedText: string, key: string): Promise<string> {
  try {
    return await decrypt(encryptedText, key);
  } catch (error) {
    console.error('Decrypt request error:', error);
    throw error;
  }
} 