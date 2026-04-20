import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import * as crypto from "crypto";


function encryptGrievancePayload(plainText: string): string {
  // Matches provided Python implementation:
  // AES.new(key, AES.MODE_GCM, nonce=iv) and base64(ciphertext + tag)
  const key = Buffer.from(process.env.GRIEVANCE_KEY_1, "hex"); // 32 bytes
  const iv = Buffer.from(process.env.GRIEVANCE_KEY_2, "hex"); // nonce bytes

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key as unknown as crypto.CipherKey,
    iv as unknown as crypto.BinaryLike,
  );

  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8") as unknown as Uint8Array,
    cipher.final() as unknown as Uint8Array,
  ]);
  const tag = cipher.getAuthTag() as unknown as Uint8Array;

  // Python code sends ciphertext || tag
  return Buffer.concat([
    ciphertext as unknown as Uint8Array,
    tag,
  ]).toString("base64");
}

function decryptGrievanceResponse(encryptedBase64: string): any {
  // Matches Python decrypt counterpart for AES-GCM with ciphertext||tag payload
  const key = Buffer.from(process.env.GRIEVANCE_KEY_1, "hex");
  const nonce = Buffer.from(process.env.GRIEVANCE_KEY_2, "hex");
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");
  if (encryptedBytes.length < 17) {
    throw new Error("Invalid encrypted response: too short for GCM tag");
  }

  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key as unknown as crypto.CipherKey,
    nonce as unknown as crypto.BinaryLike,
  );
  decipher.setAuthTag(tag as unknown as Uint8Array);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext as unknown as Uint8Array) as unknown as Uint8Array,
    decipher.final() as unknown as Uint8Array,
  ]).toString("utf8");

  console.log("PM Kisan Grievance decrypted response string:", decrypted);

  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

@Injectable()
export class PmkisanGrievanceService {
  private readonly logger = new Logger(PmkisanGrievanceService.name);

  async createGrievance(body: any): Promise<any> {
    const fulfillment = body?.message?.order?.fulfillments?.[0];
    const person = fulfillment?.customer?.person;
    const customerName = person?.name;
    const phone = fulfillment?.customer?.contact?.phone;

    // Extract IdentityNo (reg-number) from reg-details tag
    const regTag = person?.tags?.find(
      (tag: any) => tag?.descriptor?.code === "reg-details",
    );
    const identityNo = regTag?.list?.find(
      (item: any) => item?.descriptor?.code === "reg-number",
    )?.value;

    // Extract GrievanceType and GrievanceDescription from grievance-details tag
    const grievanceDetailsTag = person?.tags?.find(
      (tag: any) => tag?.descriptor?.code === "grievance-details",
    );
    const grievanceType =
      grievanceDetailsTag?.list?.find(
        (item: any) => item?.descriptor?.code === "grievance-type",
      )?.value ?? "101";

    const grievanceDescription =
      grievanceDetailsTag?.list?.find(
        (item: any) => item?.descriptor?.code === "grievance-description",
      )?.value ?? "Grievance submitted via Vistaar platform";

    const context = body?.context;

    // ── Build raw PM Kisan payload ────────────────────────────────────────
    const rawPayload = {
      Type: "Reg_No_Details",
      TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN,
      IdentityNo: identityNo,
      GrievanceType: grievanceType,
      GrievanceDescription: grievanceDescription,
    };

    console.log("=".repeat(60));
    console.log("[PMKISAN GRIEVANCE] JSON being encrypted:");
    console.log(JSON.stringify(rawPayload, null, 2));
    console.log("=".repeat(60));

    // ── Encrypt using AES-256-GCM with GRIEVANCE_KEY_1 (key) + GRIEVANCE_KEY_2 (nonce) ──
    const encryptedText = encryptGrievancePayload(JSON.stringify(rawPayload));
    const requestBody = { EncryptedRequest: encryptedText };

    console.log("[PMKISAN GRIEVANCE] EncryptedRequest body sent to API:");
    console.log(JSON.stringify(requestBody, null, 2));
    console.log("=".repeat(60));

    // ── Call external PM Kisan Grievance API ─────────────────────────────
    const baseUrl = (process.env.PMKISAN_GRIEVANCE_BASE_URL ?? "").replace(
      /\/$/,
      "",
    );
    const url = `${baseUrl}/GrievanceService.asmx/LodgeGrievance`;

    let decryptedOutput: any = {};
    try {
      const response = await axios.request({
        method: "post",
        maxBodyLength: Infinity,
        url,
        headers: { "Content-Type": "application/json" },
        data: requestBody,
        timeout: 15000,
      });

      const rawApiResponse = response.data;
      console.log("[PMKISAN GRIEVANCE] Raw API response:");
      console.log(JSON.stringify(rawApiResponse, null, 2));
      console.log("=".repeat(60));

      // ── Decrypt the response using the same AES-256-CBC keys ─────────
      const outputField: string =
        rawApiResponse?.d?.output ?? rawApiResponse?.output ?? rawApiResponse;

      if (typeof outputField === "string" && outputField.length > 0) {
        // Only attempt decrypt when the string looks like valid base64
        // (no spaces, no newlines — plain error messages have those)
        const looksEncrypted = /^[A-Za-z0-9+/]+=*$/.test(outputField.trim());

        if (looksEncrypted) {
          try {
            console.log("[PMKISAN GRIEVANCE] Encrypted output from API:");
            console.log(outputField.trim());
            console.log("=".repeat(60));

            decryptedOutput = decryptGrievanceResponse(outputField.trim());

            console.log("[PMKISAN GRIEVANCE] Decrypted output (raw string):");
            console.log(
              typeof decryptedOutput === "string"
                ? decryptedOutput
                : JSON.stringify(decryptedOutput),
            );
            console.log("=".repeat(60));

            console.log("[PMKISAN GRIEVANCE] Decrypted output (parsed JSON):");
            console.log(JSON.stringify(decryptedOutput, null, 2));
            console.log("=".repeat(60));
          } catch (decryptErr) {
            console.error(
              "[PMKISAN GRIEVANCE] Decryption failed:",
              decryptErr.message,
            );
            decryptedOutput = {
              status: "False",
              Message: `Decryption failed: ${decryptErr.message}`,
              RawOutput: outputField,
            };
          }
        } else {
          // Server returned a plain-text error (e.g. NullReferenceException)
          decryptedOutput = {
            status: "False",
            Message: outputField,
          };
        }
      } else {
        decryptedOutput = rawApiResponse;
      }
    } catch (error) {
      console.error(
        "PM Kisan Grievance API call error:",
        error.message,
        error.response?.data ?? "",
      );
      decryptedOutput = { status: "False", Message: error.message };
    }

    // ── Map decrypted response fields to Beckn on_init ───────────────────
    const isSuccess =
      decryptedOutput?.status !== "False" &&
      decryptedOutput?.Status !== "False" &&
      decryptedOutput?.Rsponce !== "False";

    const grievanceId =
      decryptedOutput?.GrievanceID ??
      decryptedOutput?.grievanceId ??
      decryptedOutput?.GrievanceNo ??
      "";

    const responseMessage =
      decryptedOutput?.Message ??
      decryptedOutput?.message ??
      decryptedOutput?.Remark ??
      "";

    return {
      context: {
        ...context,
        action: "on_init",
        timestamp: new Date().toISOString(),
      },
      message: {
        order: {
          provider: { id: "pmkisan-greviance" },
          items: [{ id: "pmkisan-greviance" }],
          fulfillments: [
            {
              customer: {
                person: { name: customerName },
                contact: { phone },
              },
            },
          ],
          tags: [
            {
              descriptor: {
                code: "grievance-response",
                name: "Grievance Response",
              },
              list: [
                {
                  descriptor: { code: "status", name: "Status" },
                  value: isSuccess ? "Submitted" : "Failed",
                },
                {
                  descriptor: {
                    code: "grievance-id",
                    name: "Grievance ID",
                  },
                  value: grievanceId,
                },
                {
                  descriptor: {
                    code: "identity-no",
                    name: "Registration Number",
                  },
                  value: identityNo,
                },
                {
                  descriptor: {
                    code: "grievance-type",
                    name: "Grievance Type",
                  },
                  value: grievanceType,
                },
                {
                  descriptor: { code: "message", name: "Message" },
                  value: responseMessage,
                },
              ],
            },
          ],
        },
      },
    };
  }
}
