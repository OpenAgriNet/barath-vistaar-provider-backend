import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { format } from "date-fns";
import { DatabaseService, MandiMasterRow } from "../weatherforecast/database.service";

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
  private readonly logger = new Logger(MandiService.name);
  private readonly baseUrl = process.env.MANDI_BASE_URL;
  private readonly token = process.env.MANDI_TOKEN;

  constructor(private readonly databaseService: DatabaseService) {}

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
    const query = new URLSearchParams({
      token: this.token || "",
      statecode: params.statecode,
      from_date: params.from_date,
      to_date: params.to_date,
      commoditycode: params.commoditycode,
      districtcode: params.districtcode,
      // marketcode: params.marketcode,
    }).toString();
    this.logger.log(`Mandi API: GET ${url}?${query}`);
    try {
      const response = await axios.get(`${url}?${query}`, { timeout: 15000 });
      return response.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const msg = typeof body === "object" ? JSON.stringify(body) : body ?? err.message;
      this.logger.warn(`Mandi API ${status}: ${msg}`);
      throw err;
    }
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

  /**
   * Normalize Agmarknet Vistaar API response to an array of price records.
   */
  private normalizeApiRecords(apiData: any): any[] {
    if (Array.isArray(apiData)) return apiData;
    if (apiData?.data && Array.isArray(apiData.data)) return apiData.data;
    if (apiData?.records && Array.isArray(apiData.records)) return apiData.records;
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
    const items: any[] = [];
    let itemId = 0;

    for (const { mandi, api } of results) {
      const records = this.normalizeApiRecords(api);
      for (const rec of records) {
        itemId += 1;
        const state = rec?.State ?? mandi.state ?? "N/A";
        const district = rec?.District ?? mandi.district_name ?? "N/A";
        const market = rec?.Market ?? mandi.marketcode ?? "N/A";
        const commodity = rec?.Commodity ?? "N/A";
        const tags: any[] = [
          { descriptor: { code: "State" }, value: state },
          { descriptor: { code: "District" }, value: district },
          { descriptor: { code: "Market" }, value: market },
          { descriptor: { code: "Commodity" }, value: commodity },
          { descriptor: { code: "Modal Price" }, value: rec?.["Modal Price"] ?? "N/A" },
          { descriptor: { code: "Min Price" }, value: rec?.["Min Price"] ?? "N/A" },
          { descriptor: { code: "Max Price" }, value: rec?.["Max Price"] ?? "N/A" },
          { descriptor: { code: "Price Unit" }, value: rec?.["Price Unit"] ?? "N/A" },
          { descriptor: { code: "Arrival Date" }, value: rec?.["Arrival Date"] ?? "N/A" },
        ];
        if (rec?.Grade) tags.push({ descriptor: { code: "Grade" }, value: rec.Grade });
        if (rec?.Group) tags.push({ descriptor: { code: "Group" }, value: rec.Group });
        if (rec?.Variety) tags.push({ descriptor: { code: "Variety" }, value: rec.Variety });

        items.push({
          id: `mandi-${itemId}`,
          descriptor: {
            name: `${commodity} - ${market}`,
            short_desc: `${commodity} at ${market}, ${district}, ${state}`,
            images: [],
          },
          matched: true,
          category_ids: ["mandi-price"],
          fulfillment_ids: ["mandi-f1"],
          tags: [{ descriptor: { code: "price-info" }, list: tags }],
        });
      }
    }

    if (items.length === 0) {
      return {
        descriptor: { name: "Mandi Price Discovery" },
        providers: [],
      };
    }

    const provider = {
      id: "mandi-price-discovery",
      descriptor: {
        name: "Mandi Price Discovery",
        short_desc: "Agmarknet Vistaar mandi prices for location",
        images: [],
      },
      categories: [
        { id: "mandi-price", descriptor: { code: "mandi", name: "Mandi Price Discovery" } },
      ],
      fulfillments: [
        {
          id: "mandi-f1",
          stops: [{ location: { lat: String(lat), lon: String(lon) } }],
        },
      ],
      items,
    };

    return {
      descriptor: { name: "Mandi Price Discovery" },
      providers: [provider],
    };
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
    const fromDate = startStr ? this.parseDateForApi(startStr) : "";
    const toDate = endStr ? this.parseDateForApi(endStr) : "";

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

    try {
      const rows = await this.getMandiMasterData(lat, lon);
      this.logger.log(`Mandi DB: found ${rows.length} row(s) for lat=${lat}, lon=${lon}, commoditycode=${commoditycodeStr}`);

      const results: Array<{ mandi: MandiMasterRow; api: any }> = [];
      for (const row of rows) {
        const params: AgmarknetVistaarParams = {
          statecode: row.statecode,
          from_date: fromDate,
          to_date: toDate,
          commoditycode: commoditycodeStr,
          districtcode: row.districtcode ?? "",
          marketcode: row.marketcode,
        };
        try {
          const apiData = await this.fetchAgmarknetVistaar(params);
          results.push({ mandi: row, api: apiData });
        } catch (err) {
          this.logger.warn(`Mandi API failed for ${row.marketcode}: ${(err as Error).message}`);
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
