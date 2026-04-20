import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import * as crypto from "crypto";

const GCM_AUTH_TAG_LENGTH = 16;
const AES_256_KEY_LENGTH = 32;
const MIN_GCM_PAYLOAD_LENGTH = GCM_AUTH_TAG_LENGTH + 1;

function parseHexEnv(envName: "GRIEVANCE_KEY_1" | "GRIEVANCE_KEY_2"): Buffer {
  const rawValue = process.env[envName];
  if (!rawValue) {
    throw new Error(`${envName} is not set`);
  }

  const normalized = rawValue.trim().replace(/\s+/g, "");
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error(`${envName} must be a valid even-length hex string`);
  }

  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`${envName} must contain only hex characters`);
  }

  return Buffer.from(normalized, "hex");
}

function getGrievanceCryptoMaterial(): { key: Buffer; nonce: Buffer } {
  const key = parseHexEnv("GRIEVANCE_KEY_1");
  const nonce = parseHexEnv("GRIEVANCE_KEY_2");

  if (key.length !== AES_256_KEY_LENGTH) {
    throw new Error(
      `GRIEVANCE_KEY_1 must decode to ${AES_256_KEY_LENGTH} bytes, got ${key.length}`,
    );
  }

  if (nonce.length === 0) {
    throw new Error("GRIEVANCE_KEY_2 must decode to a non-empty nonce");
  }

  return { key, nonce };
}


function encryptGrievancePayload(plainText: string): string {
  // Matches provided Python implementation:
  // AES.new(key, AES.MODE_GCM, nonce=iv) and base64(ciphertext + tag)
  const { key, nonce } = getGrievanceCryptoMaterial();

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key as unknown as crypto.CipherKey,
    nonce as unknown as crypto.BinaryLike,
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
  const { key, nonce } = getGrievanceCryptoMaterial();
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");
  if (encryptedBytes.length < MIN_GCM_PAYLOAD_LENGTH) {
    throw new Error("Invalid encrypted response: too short for GCM tag");
  }

  const tag = encryptedBytes.subarray(encryptedBytes.length - GCM_AUTH_TAG_LENGTH);
  const ciphertext = encryptedBytes.subarray(
    0,
    encryptedBytes.length - GCM_AUTH_TAG_LENGTH,
  );

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

  private getIdentityFromPerson(person: any): {
    regNumber?: string;
    aadhaarNumber?: string;
  } {
    const regTag = person?.tags?.find(
      (tag: any) => tag?.descriptor?.code === "reg-details",
    );

    const regNumber = regTag?.list?.find(
      (item: any) => item?.descriptor?.code === "reg-number",
    )?.value;

    const aadhaarNumber = regTag?.list?.find(
      (item: any) =>
        item?.descriptor?.code === "aad-number" ||
        item?.descriptor?.code === "add-number",
    )?.value;

    return { regNumber, aadhaarNumber };
  }

  private async callEncryptedEndpoint(
    baseUrl: string,
    endpoint: string,
    payload: any,
    logPrefix: string,
  ): Promise<any> {
    console.log("=".repeat(60));
    console.log(`[PMKISAN GRIEVANCE] ${logPrefix} JSON being encrypted:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log("=".repeat(60));

    const encryptedText = encryptGrievancePayload(JSON.stringify(payload));
    const requestBody = { EncryptedRequest: encryptedText };

    console.log(`[PMKISAN GRIEVANCE] ${logPrefix} EncryptedRequest body sent to API:`);
    console.log(JSON.stringify(requestBody, null, 2));
    console.log("=".repeat(60));

    const url = `${baseUrl}${endpoint}`;
    const response = await axios.request({
      method: "post",
      maxBodyLength: Infinity,
      url,
      headers: { "Content-Type": "application/json" },
      data: requestBody,
      timeout: 15000,
    });

    const rawApiResponse = response.data;
    console.log(`[PMKISAN GRIEVANCE] ${logPrefix} Raw API response:`);
    console.log(JSON.stringify(rawApiResponse, null, 2));
    console.log("=".repeat(60));

    const outputField: string =
      rawApiResponse?.d?.output ?? rawApiResponse?.output ?? rawApiResponse;

    if (typeof outputField !== "string" || outputField.length === 0) {
      return rawApiResponse;
    }

    const looksEncrypted = /^[A-Za-z0-9+/]+=*$/.test(outputField.trim());
    if (!looksEncrypted) {
      return { status: "False", Message: outputField };
    }

    console.log(`[PMKISAN GRIEVANCE] ${logPrefix} Encrypted output from API:`);
    console.log(outputField.trim());
    console.log("=".repeat(60));

    const decryptedOutput = decryptGrievanceResponse(outputField.trim());
    console.log(`[PMKISAN GRIEVANCE] ${logPrefix} Decrypted output (parsed JSON):`);
    console.log(JSON.stringify(decryptedOutput, null, 2));
    console.log("=".repeat(60));

    return decryptedOutput;
  }

  async searchGrievanceStatus(body: any): Promise<any> {
    const fulfillment = body?.message?.order?.fulfillments?.[0];
    const person = fulfillment?.customer?.person;
    const customerName = person?.name;
    const phone = fulfillment?.customer?.contact?.phone;
    const context = body?.context;

    const { regNumber, aadhaarNumber } = this.getIdentityFromPerson(person);

    const baseUrl = (process.env.PMKISAN_GRIEVANCE_BASE_URL ?? "").replace(
      /\/$/,
      "",
    );

    let decryptedOutput: any = {};
    let finalIdentityNo = regNumber ?? "";
    let requestType = "Reg_No_Status";

    try {
      // Prefer registration number when present in reg-details.
      if (regNumber) {
        requestType = "Reg_No_Status";
        finalIdentityNo = regNumber;
      } else if (aadhaarNumber) {
        requestType = "IdentityNo_Status";
        const aadhaarTokenPayload = {
          Type: "IdentityNo_Details",
          TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN,
          IdentityNo: aadhaarNumber,
        };
        const aadhaarTokenResponse = await this.callEncryptedEndpoint(
          baseUrl,
          "/GrievanceService.asmx/GrievanceAadhaarToken",
          aadhaarTokenPayload,
          "Aadhaar Token for Status",
        );

        const aadhaarToken =
          aadhaarTokenResponse?.AadhaarToken ??
          aadhaarTokenResponse?.aadhaarToken ??
          aadhaarTokenResponse?.AadharToken ??
          aadhaarTokenResponse?.aadharToken;

        if (!aadhaarToken) {
          decryptedOutput = {
            status: "False",
            Message:
              aadhaarTokenResponse?.message ??
              aadhaarTokenResponse?.Message ??
              "Aadhaar token not received from GrievanceAadhaarToken API",
          };
        } else {
          finalIdentityNo = aadhaarToken;
        }
      } else {
        decryptedOutput = {
          status: "False",
          Message:
            "Missing identity data in reg-details. Provide reg-number or aad-number.",
        };
      }

      if (!decryptedOutput?.status || decryptedOutput?.status !== "False") {
        const statusPayload = {
          Type: requestType,
          TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN,
          IdentityNo: finalIdentityNo,
        };
        decryptedOutput = await this.callEncryptedEndpoint(
          baseUrl,
          "/GrievanceService.asmx/GrievanceStatusCheck",
          statusPayload,
          "Grievance Status Check",
        );
      }
    } catch (error) {
      console.error(
        "PM Kisan Grievance Status API call error:",
        error.message,
        error.response?.data ?? "",
      );
      decryptedOutput = { status: "False", Message: error.message };
    }

    const isSuccess =
      decryptedOutput?.status !== "False" &&
      decryptedOutput?.Status !== "False" &&
      decryptedOutput?.Responce !== "False";

    const responseMessage =
      decryptedOutput?.Message ??
      decryptedOutput?.message ??
      decryptedOutput?.Remark ??
      "";

    const firstDetail = decryptedOutput?.details?.[0] ?? {};

    return {
      context: {
        ...context,
        action: "on_search",
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
                code: "grievance-status-response",
                name: "Grievance Status Response",
              },
              list: [
                {
                  descriptor: { code: "status", name: "Status" },
                  value: isSuccess ? "Success" : "Failed",
                },
                {
                  descriptor: { code: "message", name: "Message" },
                  value: responseMessage,
                },
                {
                  descriptor: { code: "lookup-type", name: "Lookup Type" },
                  value: requestType,
                },
                {
                  descriptor: { code: "identity-no", name: "Identity Number" },
                  value: finalIdentityNo,
                },
                {
                  descriptor: {
                    code: "grievance-status",
                    name: "Grievance Status",
                  },
                  value: firstDetail?.GrievanceStatus ?? "",
                },
                {
                  descriptor: {
                    code: "grievance-date",
                    name: "Grievance Date",
                  },
                  value: firstDetail?.GrievanceDate ?? "",
                },
                {
                  descriptor: {
                    code: "details",
                    name: "Details",
                  },
                  value: JSON.stringify(decryptedOutput?.details ?? []),
                },
              ],
            },
          ],
        },
      },
    };
  }

  async createGrievance(body: any): Promise<any> {
    const fulfillment = body?.message?.order?.fulfillments?.[0];
    const person = fulfillment?.customer?.person;
    const customerName = person?.name;
    const phone = fulfillment?.customer?.contact?.phone;

    const { regNumber, aadhaarNumber } = this.getIdentityFromPerson(person);

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
    const baseUrl = (process.env.PMKISAN_GRIEVANCE_BASE_URL ?? "").replace(
      /\/$/,
      "",
    );

    let decryptedOutput: any = {};
    let finalIdentityNo = regNumber;
    try {
      // Aadhaar flow:
      // 1) call GrievanceAadhaarToken using aad-number
      // 2) use returned AadhaarToken as IdentityNo for LodgeGrievance
      if (aadhaarNumber) {
        const aadhaarTokenPayload = {
          Type: "IdentityNo_Details",
          TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN,
          IdentityNo: aadhaarNumber,
        };
        const aadhaarTokenResponse = await this.callEncryptedEndpoint(
          baseUrl,
          "/GrievanceService.asmx/GrievanceAadhaarToken",
          aadhaarTokenPayload,
          "Aadhaar Token",
        );
        const aadhaarToken =
          aadhaarTokenResponse?.AadhaarToken ??
          aadhaarTokenResponse?.aadhaarToken ??
          aadhaarTokenResponse?.AadharToken ??
          aadhaarTokenResponse?.aadharToken;

        if (!aadhaarToken) {
          decryptedOutput = {
            status: "False",
            Message:
              aadhaarTokenResponse?.message ??
              aadhaarTokenResponse?.Message ??
              "Aadhaar token not received from GrievanceAadhaarToken API and sreerag is great ",
          };
        } else {
          finalIdentityNo = aadhaarToken;
          console.log("[PMKISAN GRIEVANCE] Aadhaar token received:", aadhaarToken);
        }
      }

      if (!decryptedOutput?.status || decryptedOutput?.status !== "False") {
        const lodgePayload = {
          Type: aadhaarNumber ? "IdentityNo_Details" : "Reg_No_Details",
          TokenNo: process.env.PMKISAN_GRIEVANCE_TOKEN,
          IdentityNo: finalIdentityNo,
          GrievanceType: grievanceType,
          GrievanceDescription: grievanceDescription,
        };
        decryptedOutput = await this.callEncryptedEndpoint(
          baseUrl,
          "/GrievanceService.asmx/LodgeGrievance",
          lodgePayload,
          "Create Grievance",
        );
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
                  value: finalIdentityNo,
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
