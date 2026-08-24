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

export interface AifSupportTickets {
  tickets: AifSupportTicket[];
  /** Sent by AIF only when there are no tickets, in place of the array. */
  message?: string;
}

export interface AifOtpSent {
  maskedMobile: string;
  message: string;
}

export interface AifVerifiedSession {
  token: string;
  expiresIn: number;
  beneficiaryName?: string;
  message: string;
}

/**
 * An AIF failure. `message` is the message AIF returned, passed through untouched —
 * as with PMFBY and PM Kisan, the upstream wording is what the farmer is shown.
 */
export class AifError extends Error {
  constructor(message: string) {
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
   * Turns an AIF failure into an error carrying AIF's own message. The status, error
   * code and ExceptionMessage (where AIF puts the real cause on a 500) are logged for
   * diagnosis; only `Message`, AIF's user-level text, is passed on.
   */
  private toAifError(status: number, payload: any): AifError {
    const errorCode = String(this.field(payload, "ErrorCode") ?? "");
    const message = String(this.field(payload, "Message") ?? "").trim();

    this.logger.error(
      `AIF error status=${status} code=${errorCode || "(none)"} message=${
        message || "(none)"
      } exception=${String(
        this.field(payload, "ExceptionMessage") ?? "(none)",
      ).slice(0, 300)}`,
    );

    return new AifError(message || `AIF request failed (status ${status}).`);
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
      // Timeout, DNS, connection refused — there is no AIF message to pass on, so the
      // transport error itself is what is reported.
      this.logger.error(
        `AIF request failed without a response: ${error?.message ?? error}`
      );
      throw new AifError(String(error?.message ?? "AIF could not be reached."));
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
      message: String(this.field(data, "Message") ?? "OTP verified."),
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
      const message = String(this.field(data, "Message") ?? "").trim();
      throw new AifError(message || "Loan application not found.");
    }
    if (/not found/i.test(data)) {
      throw new AifError(data);
    }
    return data;
  }

  /**
   * Step 4 — support tickets. AIF returns an array, or the bare string
   * "No support tickets found for this beneficiary." when there are none.
   * No tickets is a successful result, so it maps to an empty list rather than an error,
   * and AIF's wording comes back with it as `message`.
   */
  async getSupportTickets(
    beneficiaryId: string,
    token: string
  ): Promise<AifSupportTickets> {
    const data = await this.statusRequest("/support-tickets", token, {
      beneficiaryId: Number(beneficiaryId),
    });

    if (typeof data === "string") return { tickets: [], message: data };
    if (!Array.isArray(data)) {
      const message = String(this.field(data, "Message") ?? "").trim();
      throw new AifError(message || "Unexpected response from AIF.");
    }

    const tickets = data.map((ticket: any) => ({
      beneficiaryId: Number(this.field(ticket, "BeneficiaryId") ?? 0),
      loanApplicationNumber: Number(
        this.field(ticket, "LoanApplicationNumber") ?? 0
      ),
      subQueryType: String(this.field(ticket, "subQueryType") ?? ""),
      question: String(this.field(ticket, "Question") ?? ""),
      description: String(this.field(ticket, "description") ?? ""),
      status: String(this.field(ticket, "Status") ?? ""),
    }));

    return { tickets };
  }
}
