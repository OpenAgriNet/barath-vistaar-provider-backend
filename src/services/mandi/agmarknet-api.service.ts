import { Injectable } from "@nestjs/common";
import axios, { AxiosError } from "axios";
import { format } from "date-fns";
import { LoggerService } from "../logger/logger.service";

export interface VistaarLocationParams {
  commodityId: number;
  lat: number;
  lon: number;
  date: string;
}

@Injectable()
export class AgmarknetApiService {
  private readonly baseUrl = (
    process.env.AGMARKNET_BASE_URL || ""
  ).replace(/\/$/, "");
  private readonly accessName = process.env.AGMARKNET_ACCESS_NAME;
  private readonly password = process.env.AGMARKNET_PASSWORD;
  /**
   * Preferred token from .env (MANDI_TOKEN). Tried first on cold start.
   * If Agmarknet rejects it (expired / invalid), we generate a fresh token
   * and never reuse the dead seed for the rest of the process lifetime.
   */
  private readonly seedToken = (process.env.MANDI_TOKEN || "").trim();
  private readonly tokenTtlMs = 24 * 60 * 60 * 1000;

  /** Live token — seed or generated. */
  private cachedToken: string | null = null;
  private tokenIssuedAt: number | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;
  /** After MANDI_TOKEN is rejected once, skip it and always generate. */
  private seedTokenRejected = false;

  /** Serialize Agmarknet calls so concurrent requests do not race on token refresh. */
  private agmarknetChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly logger: LoggerService) {}

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.agmarknetChain.then(fn, fn);
    this.agmarknetChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertCredentials(): void {
    if (!this.baseUrl) {
      throw new Error(
        "Agmarknet base URL not configured: set AGMARKNET_BASE_URL",
      );
    }
    if (!this.accessName || !this.password) {
      throw new Error(
        "Agmarknet auth not configured: set AGMARKNET_ACCESS_NAME and AGMARKNET_PASSWORD",
      );
    }
  }

  private isTokenRejected(err: unknown): boolean {
    const ax = err as AxiosError<{ error?: string; message?: string }>;
    const status = ax?.response?.status;
    const data = ax?.response?.data;
    const msg = String(
      data?.error ?? data?.message ?? ax?.message ?? "",
    ).toLowerCase();

    if (status === 401 || status === 403) return true;

    return (
      msg.includes("token expired") ||
      msg.includes("invalid token") ||
      msg.includes("inactive") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid or already used") ||
      msg.includes("already used")
    );
  }

  private isNoDataResponse(err: unknown): boolean {
    const ax = err as AxiosError<{ message?: string; success?: boolean }>;
    if (ax?.response?.status !== 400) return false;
    const msg = String(ax?.response?.data?.message ?? "").toLowerCase();
    return msg.includes("no data");
  }

  private async requestNewToken(logCtx: string): Promise<string> {
    this.assertCredentials();
    const url = `${this.baseUrl}/v1/generate-dynamic-token-agmarknet`;
    this.logger.log("MANDI generating new Agmarknet token via generate-dynamic-token", logCtx);

    const response = await axios.post(
      url,
      { access_name: this.accessName, password: this.password },
      { timeout: 30000 },
    );
    const token = response.data?.token;
    if (!token || typeof token !== "string") {
      throw new Error("Agmarknet token response missing token field");
    }

    this.cachedToken = token;
    this.tokenIssuedAt = Date.now();
    this.logger.log("MANDI Agmarknet token generated successfully", logCtx);
    return token;
  }

  private invalidateToken(): void {
    this.cachedToken = null;
    this.tokenIssuedAt = null;
  }

  private isTokenExpiredByTtl(): boolean {
    if (!this.tokenIssuedAt) return false;
    return Date.now() - this.tokenIssuedAt >= this.tokenTtlMs;
  }

  private markTokenValid(token: string): void {
    this.cachedToken = token;
    if (!this.tokenIssuedAt) {
      // Seed token from env — treat first successful use as issue time for TTL.
      this.tokenIssuedAt = Date.now();
    }
  }

  private markSeedRejected(logCtx: string): void {
    if (!this.seedTokenRejected && this.seedToken) {
      this.seedTokenRejected = true;
      this.logger.warn(
        "MANDI_TOKEN from .env rejected/expired — will generate new tokens from now on",
        logCtx,
      );
    }
  }

  /**
   * Token resolution:
   *  1. Reuse valid cached token (generated or previously validated seed)
   *  2. Else try MANDI_TOKEN from .env once (if not already rejected)
   *  3. Else POST generate-dynamic-token-agmarknet and cache the result
   *
   * forceRefresh always skips cache/seed and generates a new token.
   */
  private async getToken(logCtx: string, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cachedToken && !this.isTokenExpiredByTtl()) {
      return this.cachedToken;
    }

    if (forceRefresh || this.isTokenExpiredByTtl()) {
      this.invalidateToken();
    }

    if (
      !forceRefresh &&
      !this.cachedToken &&
      this.seedToken &&
      !this.seedTokenRejected
    ) {
      this.cachedToken = this.seedToken;
      this.tokenIssuedAt = null; // unknown age — rely on API rejection + TTL after first success
      this.logger.log("MANDI using MANDI_TOKEN from .env", logCtx);
      return this.cachedToken;
    }

    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.requestNewToken(logCtx).finally(() => {
      this.tokenRefreshPromise = null;
    });
    return this.tokenRefreshPromise;
  }

  private async getWithAuth(
    path: string,
    params: Record<string, string>,
    logCtx: string,
    label: string,
  ): Promise<any> {
    return this.runSerialized(async () => {
      // attempt 1: cached / MANDI_TOKEN
      // attempt 2: freshly generated token after rejection or expiry
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const forceRefresh = attempt > 1;
        if (forceRefresh) {
          this.invalidateToken();
          this.logger.warn(
            `MANDI token invalid/expired — generating new token attempt=${attempt}`,
            logCtx,
          );
        }

        const token = await this.getToken(logCtx, forceRefresh);
        const usingSeed = !!this.seedToken && token === this.seedToken;
        const query = new URLSearchParams({ ...params, token });
        const url = `${this.baseUrl}${path}?${query.toString()}`;

        this.logger.log(
          `MANDI calling ${label} attempt=${attempt} tokenSource=${usingSeed ? "MANDI_TOKEN" : "generated"}`,
          logCtx,
        );

        try {
          const response = await axios.get(url, { timeout: 30000 });
          this.markTokenValid(token);
          return response.data;
        } catch (err) {
          if (this.isNoDataResponse(err)) {
            this.logger.warn(`MANDI ${label} no data available`, logCtx);
            // No-data is a valid business response; keep token if it was accepted.
            this.markTokenValid(token);
            return [];
          }

          if (this.isTokenRejected(err) && attempt < maxAttempts) {
            if (usingSeed) {
              this.markSeedRejected(logCtx);
            }
            const ax = err as AxiosError<{ error?: string; message?: string }>;
            const reason =
              ax?.response?.data?.error ||
              ax?.response?.data?.message ||
              ax?.message ||
              "token rejected";
            this.logger.warn(
              `MANDI ${label} token rejected (${reason}) — will generate and retry`,
              logCtx,
            );
            continue;
          }

          throw err;
        }
      }

      throw new Error(`MANDI ${label} failed after token refresh`);
    });
  }

  async fetchMasterData(option = 2, trigger = "sync"): Promise<any[]> {
    const logCtx = `[commoditySync][txn:${trigger}]`;
    const data = await this.getWithAuth(
      "/v1/fetch-agmarknet-master-data",
      { option: String(option) },
      logCtx,
      `master-data option=${option}`,
    );
    if (!Array.isArray(data)) {
      throw new Error(`Master data option=${option} did not return an array`);
    }
    this.logger.log(`MANDI master data fetched rows=${data.length}`, logCtx);
    return data;
  }

  async fetchVistaarLocation(
    params: VistaarLocationParams,
    logCtx: string,
  ): Promise<any[]> {
    const data = await this.getWithAuth(
      "/v1/fetch-agmarknet-vistaar-location",
      {
        commodity_id: String(params.commodityId),
        date: params.date,
        lat: String(params.lat),
        long: String(params.lon),
      },
      logCtx,
      `vistaar-location commodity_id=${params.commodityId} date=${params.date} lat=${params.lat} lon=${params.lon}`,
    );
    const records = this.normalizeRecords(data);
    this.logger.log(`MANDI vistaar-location returned rows=${records.length}`, logCtx);
    return records;
  }

  normalizeRecords(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (data?.records && Array.isArray(data.records)) return data.records;
    return [];
  }

  todayDdMmYyyy(): string {
    return format(new Date(), "dd-MM-yyyy");
  }

  parseDateTag(value: string | undefined): string {
    if (!value) return this.todayDdMmYyyy();
    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
    try {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return format(d, "dd-MM-yyyy");
    } catch {
      /* fall through */
    }
    return this.todayDdMmYyyy();
  }
}
