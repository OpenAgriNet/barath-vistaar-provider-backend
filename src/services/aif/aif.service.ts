import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { LoggerService } from "../logger/logger.service";

export interface AifSupportTicket {
  beneficiaryId: number;
  /** 0 when the ticket is not tied to a loan application. */
  loanApplicationNumber: number;
  subQueryType: string;
  question: string;
  description: string;
  status: string;
}

export interface AifOtpSent {
  maskedMobile: string;
  message: string;
}

export interface AifVerifiedSession {
  token: string;
  expiresIn: number;
  beneficiaryName?: string;
}

/**
 * Farmer-facing failure codes. The AIF error codes and HTTP statuses are collapsed
 * onto these so the agent can pick wording without seeing AIF internals.
 */
export type AifErrorCode =
  | "beneficiary_not_found"
  | "mobile_not_registered"
  | "invalid_mobile_on_record"
  | "otp_service_unavailable"
  | "otp_invalid"
  | "otp_expired"
  | "otp_attempts_exceeded"
  | "loan_application_not_found"
  | "session_expired"
  | "aif_unavailable";

export class AifError extends Error {
  constructor(readonly code: AifErrorCode, message: string) {
    super(message);
    this.name = "AifError";
  }
}

@Injectable()
export class AifService {
  constructor(
    private readonly logger: LoggerService,
    private readonly configService?: ConfigService
  ) {}

  /**
   * No hardcoded default on purpose: a fallback to the live Amnex host would mean a
   * deployment with a missing AIF_BASE_URL silently talks to production.
   */
  private getBaseUrl(): string {
    return (
      this.configService?.get<string>("AIF_BASE_URL") || process.env.AIF_BASE_URL
    );
  }

  private getApiKey(): string {
    return (
      this.configService?.get<string>("AIF_API_KEY") || process.env.AIF_API_KEY
    );
  }

  private getTimeout(): number {
    return Number(this.configService?.get<number>("AIF_TIMEOUT")) || 20000;
  }

  private buildHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apiKey: this.getApiKey(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /**
   * AIF is inconsistent about casing: most responses use `Success`/`Message`, but the
   * BV42201 error uses `success`/`message`. Read every field case-insensitively.
   */
  private field<T = any>(payload: any, name: string): T | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const key = Object.keys(payload).find(
      (k) => k.toLowerCase() === name.toLowerCase()
    );
    return key === undefined ? undefined : payload[key];
  }

  /**
   * Collapses an AIF failure onto a farmer-facing code. `errorCode` alone is not enough:
   * BV40401 means "API key missing" on a 401 but "beneficiary not found" on a 404.
   */
  private toAifError(status: number, payload: any): AifError {
    const errorCode = String(this.field(payload, "ErrorCode") ?? "");
    const message = String(this.field(payload, "Message") ?? "").trim();

    switch (errorCode) {
      case "BV42201":
        return new AifError(
          "mobile_not_registered",
          "No mobile number is registered against this beneficiary ID."
        );
      case "BV40005":
        return new AifError(
          "invalid_mobile_on_record",
          "The mobile number on record is not valid."
        );
      case "BV50301":
      case "BV50302":
      case "BV50401":
        return new AifError(
          "otp_service_unavailable",
          "The AIF OTP service is not responding."
        );
      case "BV40402":
        // Bad API key is our misconfiguration, not the farmer's problem.
        this.logger.error("AIF rejected the API key (BV40402)");
        return new AifError("aif_unavailable", "AIF is not reachable.");
      case "BV40401":
        if (status === 404) {
          return new AifError(
            "beneficiary_not_found",
            "No beneficiary found for that ID."
          );
        }
        this.logger.error("AIF API key missing from request (BV40401)");
        return new AifError("aif_unavailable", "AIF is not reachable.");
    }

    if (status === 429) {
      return new AifError(
        "otp_attempts_exceeded",
        "Maximum OTP attempts exceeded."
      );
    }
    if (status === 401) {
      return new AifError("session_expired", "The AIF session has expired.");
    }
    if (status === 400 && /expired/i.test(message)) {
      return new AifError("otp_expired", "The OTP has expired.");
    }
    if (status === 400 && /otp/i.test(message)) {
      // Covers "Invalid OTP." and "OTP has already been used."
      return new AifError("otp_invalid", "That OTP did not match.");
    }
    if (status === 404) {
      return new AifError(
        "beneficiary_not_found",
        "No beneficiary found for that ID."
      );
    }

    // Nothing matched: log the upstream status and message so an AIF-side failure is
    // diagnosable from our logs. ExceptionMessage is where AIF puts the real cause on
    // a 500; the stack trace is deliberately not logged.
    this.logger.error(
      `AIF returned an unmapped error status=${status} message=${message || "(none)"} exception=${String(
        this.field(payload, "ExceptionMessage") ?? "(none)",
      ).slice(0, 300)}`,
    );
    return new AifError("aif_unavailable", "AIF is not reachable.");
  }

  private async request(config: Parameters<typeof axios.request>[0]) {
    try {
      const response = await axios.request({
        timeout: this.getTimeout(),
        ...config,
      });
      return response.data;
    } catch (error: any) {
      if (error?.response) {
        throw this.toAifError(error.response.status, error.response.data);
      }
      // Timeout, DNS, connection refused — the farmer just sees "try again shortly".
      this.logger.error(
        `AIF request failed without a response: ${error?.message ?? error}`
      );
      throw new AifError("aif_unavailable", "AIF is not reachable.");
    }
  }

  /**
   * Step 1 — send an OTP to the beneficiary's registered mobile.
   * The same URL verifies the OTP; including `otp` in the body is what switches the mode.
   */
  async sendOtp(beneficiaryId: string): Promise<AifOtpSent> {
    const data = await this.request({
      method: "post",
      url: `${this.getBaseUrl()}/validate_beneficiaries/`,
      headers: this.buildHeaders(),
      data: { beneficiaryId: Number(beneficiaryId) },
    });

    if (this.field(data, "Success") !== true) {
      throw this.toAifError(200, data);
    }

    return {
      maskedMobile: String(this.field(data, "MobileNumber") ?? ""),
      message: String(this.field(data, "Message") ?? "OTP sent successfully."),
    };
  }

  /**
   * Step 2 — verify the OTP and obtain the session token.
   * The OTP is never logged, and the token is returned to the caller only so the
   * session store can hold it; it is never placed in a Beckn response.
   */
  async verifyOtp(
    beneficiaryId: string,
    otp: string
  ): Promise<AifVerifiedSession> {
    const data = await this.request({
      method: "post",
      url: `${this.getBaseUrl()}/validate_beneficiaries/`,
      headers: this.buildHeaders(),
      data: { beneficiaryId: Number(beneficiaryId), otp: String(otp) },
    });

    const token = this.field<string>(data, "Token");
    if (this.field(data, "Success") !== true || !token) {
      throw this.toAifError(200, data);
    }

    const beneficiary = this.field<any>(data, "Beneficiary");
    return {
      token,
      expiresIn: Number(this.field(data, "ExpiresIn")) || 3600,
      beneficiaryName: this.field<string>(beneficiary, "Beneficiary_Name"),
    };
  }

  /**
   * Endpoints 3 and 4 are documented as GET with a JSON body. Some proxies drop bodies
   * on GET, so the same values also go on the query string — AIF ignores the spare copy.
   */
  private statusRequest(path: string, token: string, payload: any) {
    return this.request({
      method: "get",
      url: `${this.getBaseUrl()}${path}`,
      headers: this.buildHeaders(token),
      data: payload,
      params: payload,
    });
  }

  /** Step 3 — loan application status. Returns a bare JSON string such as `"Disbursed"`. */
  async getLoanStatus(
    loanApplicationNumber: string,
    token: string
  ): Promise<string> {
    const data = await this.statusRequest("/Status", token, {
      loanApplicationNumber: Number(loanApplicationNumber),
    });

    if (typeof data !== "string") {
      // The only object AIF returns here is { Message: "Invalid loanApplicationNumber." }
      throw new AifError(
        "loan_application_not_found",
        String(this.field(data, "Message") ?? "Loan application not found.")
      );
    }
    if (/not found/i.test(data)) {
      throw new AifError("loan_application_not_found", data);
    }
    return data;
  }

  /**
   * Step 4 — support tickets. AIF returns an array, or the bare string
   * "No support tickets found for this beneficiary." when there are none.
   * No tickets is a successful result, so it maps to an empty array rather than an error.
   */
  async getSupportTickets(
    beneficiaryId: string,
    token: string
  ): Promise<AifSupportTicket[]> {
    const data = await this.statusRequest("/support-tickets", token, {
      beneficiaryId: Number(beneficiaryId),
    });

    if (typeof data === "string") return [];
    if (!Array.isArray(data)) {
      throw new AifError(
        "aif_unavailable",
        String(this.field(data, "Message") ?? "Unexpected response from AIF.")
      );
    }

    return data.map((ticket: any) => ({
      beneficiaryId: Number(this.field(ticket, "BeneficiaryId") ?? 0),
      loanApplicationNumber: Number(
        this.field(ticket, "LoanApplicationNumber") ?? 0
      ),
      subQueryType: String(this.field(ticket, "subQueryType") ?? ""),
      question: String(this.field(ticket, "Question") ?? ""),
      description: String(this.field(ticket, "description") ?? ""),
      status: String(this.field(ticket, "Status") ?? ""),
    }));
  }
}
