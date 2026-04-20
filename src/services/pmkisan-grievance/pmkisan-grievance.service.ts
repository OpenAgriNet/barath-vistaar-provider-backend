import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import * as crypto from "crypto";


function encryptGrievancePayload(plainText: string): string {
  const key = Buffer.from(process.env.GRIEVANCE_KEY_1, "hex"); // 32 bytes → AES-256
  const iv = Buffer.from(process.env.GRIEVANCE_KEY_2, "hex");  // 16 bytes → CBC IV

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    key as unknown as crypto.CipherKey,
    iv as unknown as crypto.BinaryLike,
  );
  cipher.setAutoPadding(true);

  let encrypted = cipher.update(plainText, "utf8", "base64");
  encrypted += cipher.final("base64");

  return encrypted;
}

function decryptGrievanceResponse(encryptedBase64: string): any {
  const key = Buffer.from(process.env.GRIEVANCE_KEY_1, "hex"); // same 32-byte key
  const iv = Buffer.from(process.env.GRIEVANCE_KEY_2, "hex");  // same 16-byte IV

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    key as unknown as crypto.CipherKey,
    iv as unknown as crypto.BinaryLike,
  );
  decipher.setAutoPadding(true);

  let decrypted = decipher.update(encryptedBase64, "base64", "utf8");
  decrypted += decipher.final("utf8");

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

    console.log(
      "PM Kisan Grievance raw payload:",
      JSON.stringify(rawPayload, null, 2),
    );

    // ── Encrypt using AES-256-CBC with GRIEVANCE_KEY_1 (key) + GRIEVANCE_KEY_2 (IV) ──
    const encryptedText = encryptGrievancePayload(JSON.stringify(rawPayload));
    const requestBody = { EncryptedRequest: encryptedText };

    console.log("PM Kisan Grievance encrypted request:", requestBody);

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
      console.log(
        "PM Kisan Grievance raw API response:",
        JSON.stringify(rawApiResponse, null, 2),
      );

      // ── Decrypt the response using the same AES-256-CBC keys ─────────
      const outputField: string =
        rawApiResponse?.d?.output ?? rawApiResponse?.output ?? rawApiResponse;

      if (typeof outputField === "string" && outputField.length > 0) {
        // Only attempt decrypt when the string looks like valid base64
        // (no spaces, no newlines — plain error messages have those)
        const looksEncrypted = /^[A-Za-z0-9+/]+=*$/.test(outputField.trim());

        if (looksEncrypted) {
          try {
            decryptedOutput = decryptGrievanceResponse(outputField.trim());
            console.log(
              "PM Kisan Grievance decrypted output:",
              JSON.stringify(decryptedOutput, null, 2),
            );
          } catch (decryptErr) {
            console.error(
              "PM Kisan Grievance decryption failed:",
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
          console.error(
            "PM Kisan Grievance server returned plain-text error:",
            outputField,
          );
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
