import { Injectable } from "@nestjs/common";
import { AgmarknetApiService } from "./agmarknet-api.service";

export interface MandiLocationIntent {
  commodityName: string;
  lat: number;
  lon: number;
  locationName: string;
  /** Single-date lookup. Unset when fromDate/toDate is present. */
  date?: string;
  /** Date-range lookup, from intent.tags codes "from_date"/"to_date". */
  fromDate?: string;
  toDate?: string;
}

@Injectable()
export class BecknContextService {
  constructor(private readonly agmarknetApi: AgmarknetApiService) {}

  parseMandiLocationIntent(body: any): MandiLocationIntent | null {
    const intent = body?.message?.intent;
    if (!intent) return null;

    const commodityName = intent?.item?.descriptor?.name?.trim();
    if (!commodityName) return null;

    let lat = 0;
    let lon = 0;
    let locationName = "";

    const endLoc = intent?.fulfillment?.end?.location;
    const stopLoc = intent?.fulfillment?.stops?.[0]?.location;

    const location = endLoc || stopLoc;
    if (location) {
      locationName = location?.descriptor?.name || "";
      if (location.lat != null && location.lon != null) {
        lat = parseFloat(String(location.lat));
        lon = parseFloat(String(location.lon));
      } else if (location.gps) {
        const [latStr, lonStr] = String(location.gps).split(",").map((s) => s.trim());
        lat = parseFloat(latStr) || 0;
        lon = parseFloat(lonStr) || 0;
      }
    }

    const tags: Array<{ code?: string; value?: string }> = intent?.tags || [];
    const dateTag = tags.find((t) => t.code === "date")?.value;
    const fromDateTag = tags.find((t) => t.code === "from_date")?.value;
    const toDateTag = tags.find((t) => t.code === "to_date")?.value;

    if (!lat || !lon) return null;

    // A real range (both from_date and to_date tags) takes precedence over the single "date" tag.
    if (fromDateTag && toDateTag) {
      const fromDate = this.agmarknetApi.parseDateTag(fromDateTag);
      const toDate = this.agmarknetApi.parseDateTag(toDateTag);
      return { commodityName, lat, lon, locationName, fromDate, toDate };
    }

    const date = this.agmarknetApi.parseDateTag(dateTag);
    return { commodityName, lat, lon, locationName, date };
  }

  isNewMandiPayload(body: any): boolean {
    const itemName = body?.message?.intent?.item?.descriptor?.name;
    const commodityCode = body?.message?.intent?.fulfillment?.stops?.[0]?.commoditycode;
    const categoryCode = body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
    return categoryCode === "price-discovery" && !!itemName && commodityCode == null;
  }
}