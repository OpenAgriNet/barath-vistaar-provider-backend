import { Injectable } from "@nestjs/common";
import { CommodityRow } from "../weatherforecast/database.service";
import { MandiLocationIntent } from "./beckn-context.service";

/** Beckn on_search catalog — same shape as legacy mandi v1 (MANDI_PRICE_FLOW.md). */
export interface BecknMandiCatalog {
  descriptor: { name: string };
  providers: any[];
  tags?: any[];
}

@Injectable()
export class CatalogCompactService {
  private static readonly CATALOG_NAME = "Mandi Price Discovery";

  /**
   * Build price-info tag list from Agmarknet vistaar-location row.
   * Includes all fields returned by the price API (same codes as legacy mandi).
   */
  buildPriceInfoTags(rec: Record<string, unknown>): Array<{
    descriptor: { code: string };
    value: string;
  }> {
    const val = (key: string) => {
      const v = rec?.[key];
      return v !== undefined && v !== null && String(v).trim() !== ""
        ? String(v)
        : "N/A";
    };

    return [
      { descriptor: { code: "Grade" }, value: val("Grade") },
      { descriptor: { code: "Group" }, value: val("Group") },
      { descriptor: { code: "State" }, value: val("State") },
      { descriptor: { code: "Market" }, value: val("Market") },
      { descriptor: { code: "Variety" }, value: val("Variety") },
      { descriptor: { code: "District" }, value: val("District") },
      { descriptor: { code: "Commodity" }, value: val("Commodity") },
      { descriptor: { code: "Max Price" }, value: val("Max Price") },
      { descriptor: { code: "Min Price" }, value: val("Min Price") },
      { descriptor: { code: "Price Unit" }, value: val("Price Unit") },
      { descriptor: { code: "Modal Price" }, value: val("Modal Price") },
      { descriptor: { code: "Arrival Date" }, value: val("Arrival Date") },
    ];
  }

  buildItemFromRecord(
    rec: Record<string, unknown>,
    itemId: number,
    defaults?: { state?: string; district?: string; market?: string; commodity?: string },
  ): any {
    const commodity = String(rec?.Commodity ?? defaults?.commodity ?? "N/A");
    const market = String(rec?.Market ?? defaults?.market ?? "N/A");
    const district = String(rec?.District ?? defaults?.district ?? "N/A");
    const state = String(rec?.State ?? defaults?.state ?? "N/A");
    const merged: Record<string, unknown> = {
      ...rec,
      Commodity: commodity,
      Market: market,
      District: district,
      State: state,
    };

    return {
      id: `mandi-${itemId}`,
      descriptor: {
        name: `${commodity} - ${market}`,
        short_desc: `${commodity} at ${market}, ${district}, ${state}`,
        images: [],
      },
      matched: true,
      category_ids: ["mandi-price"],
      fulfillment_ids: ["mandi-f1"],
      tags: [
        {
          descriptor: { code: "price-info" },
          list: this.buildPriceInfoTags(merged),
        },
      ],
    };
  }

  /**
   * Sort key for "Arrival Date". Agmarknet returns "dd-MM-yyyy" strings, which
   * cannot be compared lexicographically, so parse before sorting.
   * Rows with a missing/unparseable date sort last.
   */
  private arrivalTime(rec: any): number {
    const parts = String(rec?.["Arrival Date"] ?? "").split("-");
    if (parts.length !== 3) return -1;
    const [day, month, year] = parts.map(Number);
    const d = new Date(year, month - 1, day);
    // new Date rolls impossible dates over — 31-02-2025 becomes 03-03-2025 —
    // which would sort a malformed row ahead of real prices. Round-trip the
    // components to reject those, same check as parseDdMmYyyyToDate.
    if (
      Number.isNaN(d.getTime()) ||
      d.getDate() !== day ||
      d.getMonth() !== month - 1 ||
      d.getFullYear() !== year
    ) {
      return -1;
    }
    return d.getTime();
  }

  /**
   * Keep only the first row for each distinct "Arrival Date". Caller must sort
   * first; because Array#sort is stable, the row kept for a date is the one
   * Agmarknet returned earliest for it (its nearest-market ordering).
   */
  private oneRowPerDate(records: any[]): any[] {
    const seen = new Set<string>();
    return records.filter((rec) => {
      const key = String(rec?.["Arrival Date"] ?? "").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  buildCatalogFromRecords(
    records: any[],
    lat: number,
    lon: number,
    limit = 5,
    /**
     * Date-range queries only. Collapses the list to one row per date so the
     * catalog reads 28-07, 22-07, 21-07... Must stay off for single-date
     * queries, where every row shares a date and deduping would leave one item.
     */
    oneItemPerDate = false,
  ): BecknMandiCatalog {
    const items: any[] = [];
    let itemId = 0;

    // Date-range queries return rows across many dates in Agmarknet's own
    // (market-grouped) order, so the newest price is not necessarily first.
    // Sort newest-first before truncating, otherwise `limit` can drop exactly
    // the rows a "latest price" lookup is asking for.
    const ordered = [...records].sort(
      (a, b) => this.arrivalTime(b) - this.arrivalTime(a),
    );
    const selected = oneItemPerDate ? this.oneRowPerDate(ordered) : ordered;

    for (const rec of selected.slice(0, limit)) {
      if (!rec || typeof rec !== "object") continue;
      itemId += 1;
      items.push(this.buildItemFromRecord(rec, itemId));
    }

    if (items.length === 0) {
      return this.emptyCatalog();
    }

    return {
      descriptor: { name: CatalogCompactService.CATALOG_NAME },
      providers: [
        {
          id: "mandi-price-discovery",
          descriptor: {
            name: CatalogCompactService.CATALOG_NAME,
            short_desc: "Agmarknet Vistaar mandi prices for location",
            images: [],
          },
          categories: [
            {
              id: "mandi-price",
              descriptor: { code: "mandi", name: CatalogCompactService.CATALOG_NAME },
            },
          ],
          fulfillments: [
            {
              id: "mandi-f1",
              stops: [{ location: { lat: String(lat), lon: String(lon) } }],
            },
          ],
          items,
        },
      ],
    };
  }

  /** Mandi v2: vistaar-location raw rows → standard Beckn catalog. */
  buildFromVistaarLocation(
    raw: any[],
    intent: MandiLocationIntent,
    _commodity: CommodityRow,
    limit = 30,
  ): BecknMandiCatalog {
    // A range asks "how did the price move", so give one row per date. A single
    // date asks "what is the price near me", so keep every market for that date.
    const isRange = !!(intent.fromDate && intent.toDate);
    return this.buildCatalogFromRecords(
      raw,
      intent.lat,
      intent.lon,
      limit,
      isRange,
    );
  }

  emptyCatalog(): BecknMandiCatalog {
    return {
      descriptor: { name: CatalogCompactService.CATALOG_NAME },
      providers: [],
    };
  }

  errorCatalog(
    status: string,
    message: string,
    extra: Record<string, string> = {},
  ): BecknMandiCatalog {
    const list = [
      { descriptor: { code: "status" }, value: status },
      { descriptor: { code: "message" }, value: message },
      ...Object.entries(extra).map(([code, value]) => ({
        descriptor: { code },
        value,
      })),
    ];

    return {
      descriptor: { name: CatalogCompactService.CATALOG_NAME },
      providers: [],
      tags: [
        {
          descriptor: { code: "search-context", name: "Search Context" },
          list,
        },
      ],
    };
  }

  ambiguous(query: string, options: CommodityRow[]): BecknMandiCatalog {
    return this.errorCatalog(
      "ambiguous",
      `Multiple commodities match '${query}'`,
      {
        query,
        options: JSON.stringify(
          options.map((o) => ({
            name: o.commodity_name,
            commodity_id: o.commodity_id,
          })),
        ),
      },
    );
  }

  notFound(query: string): BecknMandiCatalog {
    return this.errorCatalog(
      "not_found",
      `No commodity matching '${query}' in master data`,
      { query },
    );
  }
}