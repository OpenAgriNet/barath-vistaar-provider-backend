import { Injectable } from "@nestjs/common";
import axios from "axios";
import { format } from "date-fns";
import { LoggerService } from "../logger/logger.service";
import { DatabaseService, MandiMasterRow } from "../weatherforecast/database.service";
import { AgmarknetApiService } from "./agmarknet-api.service";
import { BecknContextService } from "./beckn-context.service";
import { CatalogCompactService } from "./catalog-compact.service";
import { CommodityResolverService } from "./commodity-resolver.service";

export interface AgmarknetVistaarParams {
  statecode: string;
  from_date: string;
  to_date: string;
  commoditycode: string;
  districtcode: string;
  marketcode: string;
}

@Injectable()
export class MandiService {
  private readonly baseUrl = process.env.MANDI_BASE_URL;
  private readonly token = process.env.MANDI_TOKEN;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly becknContext: BecknContextService,
    private readonly commodityResolver: CommodityResolverService,
    private readonly agmarknetApi: AgmarknetApiService,
    private readonly catalogCompact: CatalogCompactService,
    private readonly logger: LoggerService,
  ) {}

  private logCtx(body: any, operation = "mandiLocationSearch"): string {
    const transactionId = body?.context?.transaction_id;
    return `[${operation}][txn:${transactionId ?? "unknown"}]`;
  }

  private logMandi(body: any, message: string, operation = "mandiLocationSearch"): void {
    this.logger.log(message, this.logCtx(body, operation));
  }

  private warnMandi(body: any, message: string, operation = "mandiLocationSearch"): void {
    this.logger.warn(message, this.logCtx(body, operation));
  }

  private summarizeSearchParams(body: any): Record<string, unknown> {
    const intent = body?.message?.intent;
    const endLoc = intent?.fulfillment?.end?.location;
    const stopLoc = intent?.fulfillment?.stops?.[0]?.location;
    const location = endLoc || stopLoc;
    const dateTag = intent?.tags?.find((t: { code?: string }) => t.code === "date")?.value;

    return {
      commodity: intent?.item?.descriptor?.name,
      location: location?.descriptor?.name,
      gps: location?.gps,
      lat: location?.lat,
      lon: location?.lon,
      date: dateTag,
    };
  }

  /**
   * New mandi flow (schemes:vistaar + item.name + gps):
   * item.descriptor.name (string) + gps → Postgres commodity resolve → vistaar-location → compact catalog.
   */
  async mandiLocationSearch(body: {
    context: any;
    message?: any;
  }): Promise<{ context: any; message?: any }> {
    const onSearchContext = { ...body.context, action: "on_search" };
    const ctx = body?.context ?? {};
    const searchParams = this.summarizeSearchParams(body);

    this.logMandi(
      body,
      `MANDI received search request message_id=${ctx.message_id ?? ""} domain=${ctx.domain ?? ""} action=${ctx.action ?? ""} bap_id=${ctx.bap_id ?? ""}`,
    );
    this.logMandi(
      body,
      `MANDI search params commodity=${searchParams.commodity ?? ""} location=${searchParams.location ?? ""} gps=${searchParams.gps ?? ""} lat=${searchParams.lat ?? ""} lon=${searchParams.lon ?? ""} date=${searchParams.date ?? ""}`,
    );

    const intent = this.becknContext.parseMandiLocationIntent(body);
    if (!intent) {
      this.warnMandi(
        body,
        "MANDI invalid request missing commodity name or gps/lat/lon",
      );
      return {
        context: onSearchContext,
        message: {
          catalog: this.catalogCompact.errorCatalog(
            "invalid_request",
            "commodity name and gps/lat/lon required in intent",
          ),
        },
      };
    }

    this.logMandi(
      body,
      `MANDI parsed intent commodity=${intent.commodityName} location=${intent.locationName} lat=${intent.lat} lon=${intent.lon} date=${intent.date}`,
    );

    this.logMandi(body, `MANDI looking up commodity in Postgres query=${intent.commodityName}`);
    const resolved = await this.commodityResolver.resolve(intent.commodityName);

    if (resolved.status === "ambiguous") {
      const catalog = this.catalogCompact.ambiguous(resolved.query, resolved.options);
      this.logMandi(
        body,
        `MANDI ambiguous commodity query=${resolved.query}`,
      );
      return {
        context: onSearchContext,
        message: { catalog },
      };
    }

    if (resolved.status === "not_found") {
      const catalog = this.catalogCompact.notFound(resolved.query);
      this.logMandi(body, `MANDI commodity not found query=${resolved.query}`);
      return {
        context: onSearchContext,
        message: { catalog },
      };
    }

    this.logMandi(
      body,
      `MANDI commodity resolved commodity_id=${resolved.commodity.commodity_id} name=${resolved.commodity.commodity_name} group=${resolved.commodity.group_name ?? ""}`,
    );

    try {
      const logCtx = this.logCtx(body);
      const raw = await this.agmarknetApi.fetchVistaarLocation(
        {
          commodityId: resolved.commodity.commodity_id,
          lat: intent.lat,
          lon: intent.lon,
          date: intent.date,
        },
        logCtx,
      );

      const catalog = this.catalogCompact.buildFromVistaarLocation(
        raw,
        intent,
        resolved.commodity,
      );
      const itemCount =
        catalog.providers?.[0]?.items?.length ?? 0;
      this.logMandi(
        body,
        `MANDI returning on_search items=${itemCount} location=${intent.locationName} date=${intent.date}`,
      );
      if (itemCount > 0) {
        const firstTags =
          catalog.providers[0].items[0]?.tags?.[0]?.list ?? [];
        const summary = Object.fromEntries(
          firstTags.map((t: { descriptor?: { code?: string }; value?: string }) => [
            t.descriptor?.code ?? "",
            t.value,
          ]),
        );
        this.logMandi(body, `MANDI on_search sample price-info: ${JSON.stringify(summary)}`);
      }

      return {
        context: onSearchContext,
        message: { catalog },
      };
    } catch (err) {
      const ax = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const apiError = ax?.response?.data?.error;
      const message = apiError || (err as Error).message;
      this.logger.error(
        `MANDI search failed commodity=${intent.commodityName} location=${intent.locationName} error=${message}`,
        ax?.response?.data ?? "",
        this.logCtx(body),
      );

      const isAuthFailure =
        ax?.response?.status === 401 ||
        ax?.response?.status === 403 ||
        /generate-dynamic-token failed status=40[13]/i.test(message) ||
        /token rejected|invalid token|agmarknet auth/i.test(message);

      if (isAuthFailure) {
        const inactive = /inactive/i.test(message) || /inactive/i.test(apiError || "");
        const htmlForbidden = /<!doctype html>|403 Forbidden/i.test(message);
        return {
          context: onSearchContext,
          message: {
            catalog: this.catalogCompact.errorCatalog(
              "agmarknet_auth_failed",
              inactive
                ? "Agmarknet credentials inactive for data APIs — contact Agmarknet to activate BV-Data-Agmarknet"
                : htmlForbidden
                  ? "Agmarknet blocked this server (HTTP 403 HTML). Credentials may work from other networks — allowlist this host egress IP for api.agmarknet.gov.in or fix AGMARKNET_ACCESS_NAME/PASSWORD on this host"
                  : "Agmarknet token/auth failed — verify MANDI_TOKEN, AGMARKNET_ACCESS_NAME and AGMARKNET_PASSWORD",
            ),
          },
        };
      }

      throw err;
    }
  }

  /**
   * Route mandi search: new payload (string commodity + gps) vs legacy (commoditycode + stops).
   */
  async mandiSearchRoute(body: { context: any; message?: any }) {
    // if (this.becknContext.isNewMandiPayload(body)) {
    //   return this.mandiLocationSearch(body);
    // }
    // return this.mandiSearch(body);

    return this.mandiLocationSearch(body);
  }

  /**
   * Get mandi master data from IMD DB by lat/lon (geometry match).
   */
  async getMandiMasterData(lat: number, lon: number): Promise<MandiMasterRow[]> {
    return this.databaseService.findMandiMasterData(lat, lon);
  }

  /**
   * Call Agmarknet Vistaar API: GET /v1/fetch-agmarknet-vistaar
   */
  async fetchAgmarknetVistaar(params: AgmarknetVistaarParams): Promise<any> {
    const url = `${this.baseUrl}/v1/fetch-agmarknet-vistaar`;
    const buildQuery = (includeMarketcode: boolean): string => {
      const queryParams = new URLSearchParams({
        token: this.token || "",
        statecode: params.statecode,
        from_date: params.from_date,
        to_date: params.to_date,
        commoditycode: params.commoditycode,
        districtcode: params.districtcode,
      });
      if (includeMarketcode && params.marketcode) {
        queryParams.set("marketcode", params.marketcode);
      }
      return queryParams.toString();
    };

    const requestKey = this.getApiRequestKey(params);
    const query = buildQuery(true);
    this.logger.log(`MANDI_API_REQUEST key=${requestKey} method=GET url=${url}?${query}`);
    try {
      const response = await axios.get(`${url}?${query}`, { timeout: 15000 });
      let data = response.data;
      let records = this.normalizeApiRecords(data);
      const sample = records[0] ? JSON.stringify(records[0]).slice(0, 500) : "";
      this.logger.log(
        `MANDI_API_RESPONSE key=${requestKey} status=${response.status} records=${records.length} sample=${sample || "none"}`
      );

      // If marketcode-level query returns empty, retry without marketcode to avoid false negatives.
      if (records.length === 0 && params.marketcode) {
        const fallbackQuery = buildQuery(false);
        this.logger.log(
          `MANDI_API_FALLBACK key=${requestKey} reason=empty_records retry_without=marketcode url=${url}?${fallbackQuery}`
        );
        const fallbackResponse = await axios.get(`${url}?${fallbackQuery}`, { timeout: 15000 });
        data = fallbackResponse.data;
        records = this.normalizeApiRecords(data);
        const fallbackSample = records[0] ? JSON.stringify(records[0]).slice(0, 500) : "";
        this.logger.log(
          `MANDI_API_FALLBACK_RESPONSE key=${requestKey} status=${fallbackResponse.status} records=${records.length} sample=${fallbackSample || "none"}`
        );
      }

      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const msg = typeof body === "object" ? JSON.stringify(body) : body ?? err.message;
      this.logger.warn(`MANDI_API_ERROR key=${requestKey} status=${status ?? "unknown"} message=${msg}`);
      throw err;
    }
  }

  private getApiRequestKey(params: AgmarknetVistaarParams): string {
    return [
      `state=${params.statecode || "NA"}`,
      `district=${params.districtcode || "NA"}`,
      `market=${params.marketcode || "NA"}`,
      `commodity=${params.commoditycode || "NA"}`,
      `from=${params.from_date || "NA"}`,
      `to=${params.to_date || "NA"}`,
    ].join("|");
  }

  /**
   * Parse ISO date to dd-MM-yyyy for Agmarknet API.
   */
  private parseDateForApi(isoDate: string): string {
    try {
      const d = new Date(isoDate);
      if (Number.isNaN(d.getTime())) return format(new Date(), "dd-MM-yyyy");
      return format(d, "dd-MM-yyyy");
    } catch {
      return format(new Date(), "dd-MM-yyyy");
    }
  }

  private parseDdMmYyyyToDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = Number(parts[2]);
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
    const d = new Date(year, month - 1, day);
    if (
      Number.isNaN(d.getTime()) ||
      d.getDate() !== day ||
      d.getMonth() !== month - 1 ||
      d.getFullYear() !== year
    ) {
      return null;
    }
    return d;
  }

  /**
   * Normalize Agmarknet Vistaar API response to an array of price records.
   */
  private normalizeApiRecords(apiData: any): any[] {
    if (Array.isArray(apiData)) return apiData;
    if (apiData?.data && Array.isArray(apiData.data)) return apiData.data;
    if (apiData?.records && Array.isArray(apiData.records)) return apiData.records;
    if (apiData?.result && Array.isArray(apiData.result)) return apiData.result;
    if (apiData?.results && Array.isArray(apiData.results)) return apiData.results;
    if (apiData && typeof apiData === "object") return [apiData];
    return [];
  }

  /**
   * Build Beckn on_search catalog from mandi + API results.
   */
  private buildMandiCatalog(
    results: Array<{ mandi: MandiMasterRow; api: any }>,
    lat: number,
    lon: number,
  ): { descriptor: { name: string }; providers: any[] } {
    const allRecords: any[] = [];

    for (const { mandi, api } of results) {
      const records = this.normalizeApiRecords(api);
      for (const rec of records) {
        allRecords.push({
          ...rec,
          State: rec?.State ?? mandi.state,
          District: rec?.District ?? mandi.district_name,
          Market: rec?.Market ?? mandi.marketcode,
        });
      }
    }

    return this.catalogCompact.buildCatalogFromRecords(allRecords, lat, lon);
  }

  /**
   * Mandi search: requires fulfillment.stops[0] with location (lat, lon), time.range (start, end), and commoditycode.
   * Resolves mandi from IMD DB by location, calls Agmarknet Vistaar API with required params, returns on_search catalog.
   */
  async mandiSearch(body: {
    context: any;
    message?: {
      intent?: {
        fulfillment?: {
          stops?: Array<{
            location?: { lat?: string; lon?: string; gps?: string };
            time?: { range?: { start?: string; end?: string } };
            commoditycode?: number;
          }>;
        };
      };
    };
  }): Promise<{ context: any; message?: any }> {
    const intent = body?.message?.intent;
    const fulfillment = intent?.fulfillment;
    const stop = fulfillment?.stops?.[0];
    let lat = 0;
    let lon = 0;

    if (stop?.location) {
      const location = stop.location;
      if (location.lat != null && location.lon != null) {
        lat = parseFloat(String(location.lat));
        lon = parseFloat(String(location.lon));
      } else if (location.gps) {
        const [latStr, lonStr] = (location.gps as string).split(",").map((s: string) => s.trim());
        lat = parseFloat(latStr) || 0;
        lon = parseFloat(lonStr) || 0;
      }
    }

    const timeRange = stop?.time?.range;
    const startStr = timeRange?.start;
    const endStr = timeRange?.end;
    let fromDate = startStr ? this.parseDateForApi(startStr) : "";
    let toDate = endStr ? this.parseDateForApi(endStr) : "";

    const commoditycode = stop?.commoditycode;
    const commoditycodeStr =
      commoditycode !== undefined && commoditycode !== null ? String(commoditycode) : "";

    const onSearchContext = { ...body.context, action: "on_search" };
    const emptyCatalog = () => ({
      context: onSearchContext,
      message: {
        catalog: {
          descriptor: { name: "Mandi Price Discovery" },
          providers: [],
        },
      },
    });

    if (!lat || !lon) {
      this.logger.warn("Mandi search: missing required location (lat, lon) in fulfillment.stops[0].location");
      return emptyCatalog();
    }
    if (!fromDate || !toDate) {
      this.logger.warn("Mandi search: missing required time.range.start or time.range.end in fulfillment.stops[0]");
      return emptyCatalog();
    }
    if (commoditycodeStr === "") {
      this.logger.warn("Mandi search: missing required commoditycode (number) in fulfillment.stops[0]");
      return emptyCatalog();
    }

    const fromDateObj = this.parseDdMmYyyyToDate(fromDate);
    const toDateObj = this.parseDdMmYyyyToDate(toDate);
    if (fromDateObj && toDateObj && fromDateObj.getTime() > toDateObj.getTime()) {
      this.logger.warn(
        `MANDI_DATE_RANGE_SWAPPED reason=from_gt_to original_from=${fromDate} original_to=${toDate}`
      );
      const temp = fromDate;
      fromDate = toDate;
      toDate = temp;
    }

    try {
      const rows = await this.getMandiMasterData(lat, lon);
      this.logger.log(
        `MANDI_DB_ROWS lat=${lat} lon=${lon} commodity=${commoditycodeStr} rows=${rows.length}`
      );

      const results: Array<{ mandi: MandiMasterRow; api: any }> = [];
      const uniqueParamsByKey = new Map<string, { params: AgmarknetVistaarParams; mandi: MandiMasterRow }>();

      for (const row of rows) {
        const params: AgmarknetVistaarParams = {
          statecode: row.statecode,
          from_date: fromDate,
          to_date: toDate,
          commoditycode: commoditycodeStr,
          districtcode: row.districtcode ?? "",
          marketcode: row.marketcode,
        };
        const key = this.getApiRequestKey(params);
        if (!uniqueParamsByKey.has(key)) {
          uniqueParamsByKey.set(key, { params, mandi: row });
        }
      }

      this.logger.log(
        `MANDI_API_DEDUP total_rows=${rows.length} unique_requests=${uniqueParamsByKey.size}`
      );

      for (const [key, entry] of uniqueParamsByKey.entries()) {
        try {
          const apiData = await this.fetchAgmarknetVistaar(entry.params);
          results.push({ mandi: entry.mandi, api: apiData });
        } catch (err) {
          this.logger.warn(`MANDI_API_CALL_FAILED key=${key} message=${(err as Error).message}`);
        }
      }

      const catalog = this.buildMandiCatalog(results, lat, lon);
      return {
        context: onSearchContext,
        message: { catalog },
      };
    } catch (err) {
      this.logger.error("Mandi search failed", err);
      throw err;
    }
  }
}
