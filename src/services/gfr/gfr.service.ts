import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";
import axios from "axios";
import { DatabaseService } from "../weatherforecast/database.service";

@Injectable()
export class GfrService {
  private readonly logger = new Logger(GfrService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private buildContext(body: any) {
    return {
      ...body.context,
      action: "on_search",
      timestamp: new Date().toISOString(),
    };
  }

  private buildError(body: any, code: string, message: string) {
    return {
      context: this.buildContext(body),
      message: {
        catalog: {
          descriptor: { name: "GFR Crop Registry" },
          providers: [
            {
              id: body?.message?.order?.provider?.id ?? "gfr-agri",
              descriptor: { name: "GFR Crop Registry" },
              items: [
                {
                  id: "error",
                  descriptor: { name: "Error", short_desc: message },
                  tags: [
                    {
                      descriptor: { code },
                      list: [
                        { descriptor: { code: "message" }, value: message },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
  }

  async fetchCropRegistry(body: any): Promise<any> {
    this.logger.log("INSIDE GFR fetchCropRegistry...");

    const baseUrl = process.env.SOIL_HEALTH_BASE_URL;

    // Extract lat/lon from fulfillments tags location
    const tags =
      body?.message?.order?.fulfillments?.[0]?.customer?.person?.tags ?? [];
    const locationTag = tags.find((t: any) => t?.location);
    const lat: number = locationTag?.location?.lat ?? null;
    const lon: number = locationTag?.location?.lon ?? null;

    this.logger.log(`Extracted lat: ${lat}, lon: ${lon}`);

    if (!lat || !lon) {
      this.logger.warn("No lat/lon in tags, falling back to stateId tag");
    }

    let stateId: string;

    if (lat && lon) {
      // Step 1: Query DB to get nearest state by lat/lon
      try {
        this.logger.log(`Querying nearest state for lat: ${lat}, lon: ${lon}`);
        const result = await this.databaseService.findNearestStateForGFR(
          lat,
          lon,
        );
        if (!result) {
          return this.buildError(
            body,
            "no_data",
            "No state found for the given location",
          );
        }
        stateId = result.state_object_id;
        this.logger.log(
          `Nearest state: ${result.state_name}, stateId: ${stateId}`,
        );
      } catch (error) {
        this.logger.error("DB query error:", error.message);
        return this.buildError(
          body,
          "db_error",
          `Failed to query nearest state: ${error.message}`,
        );
      }
    } else {
      // Fallback: use stateId from tags
      stateId = tags.find((t: any) => t?.descriptor?.code === "stateId")?.value;

      if (!stateId) {
        return this.buildError(
          body,
          "missing_input",
          "Missing location (lat/lon) in context or stateId tag in fulfillments",
        );
      }
    }

    // Step 2: Call getCropRegistries with the resolved stateId
    const gfrPayload = {
      query:
        "query GetCropRegistries($state: String) { getCropRegistries(state: $state) { id name variety irrigationType season splitdose GFRavailable combinedName state { _id name code } __typename } }",
      variables: { state: stateId },
    };

    this.logger.log(`GFR payload: ${JSON.stringify(gfrPayload, null, 2)}`);

    let gfrData: any;
    try {
      const response = await axios.post(baseUrl, gfrPayload, {
        headers: { "Content-Type": "application/json" },
      });
      gfrData = response.data;
      this.logger.log(
        `GFR crop registry response length: ${gfrData?.data?.getCropRegistries?.length ?? 0}`,
      );
    } catch (error) {
      this.logger.error("GFR API error:", error.message);
      this.logger.error(
        "GFR API error response:",
        JSON.stringify(error.response?.data, null, 2),
      );
      return this.buildError(
        body,
        "api_error",
        error.response?.data?.errors?.[0]?.message ||
          `Failed to fetch GFR details: ${error.message}`,
      );
    }

    const cropRegistries: any[] = gfrData?.data?.getCropRegistries ?? [];

    if (!cropRegistries.length) {
      return this.buildError(
        body,
        "no_data",
        "No crop registry data found for the given state",
      );
    }

    const items = cropRegistries.map((crop: any) => ({
      id: crop.id,
      descriptor: {
        name: crop.name,
        long_desc: crop.combinedName,
      },
      tags: [
        {
          descriptor: { code: "crop_details" },
          list: [
            { descriptor: { code: "variety" }, value: crop.variety ?? "" },
            {
              descriptor: { code: "irrigationType" },
              value: crop.irrigationType ?? "",
            },
            { descriptor: { code: "season" }, value: crop.season ?? "" },
            {
              descriptor: { code: "splitdose" },
              value: String(crop.splitdose),
            },
            {
              descriptor: { code: "GFRavailable" },
              value: crop.GFRavailable ?? "",
            },
            {
              descriptor: { code: "stateId" },
              value: crop.state?._id ?? stateId,
            },
            {
              descriptor: { code: "stateName" },
              value: crop.state?.name ?? "",
            },
            {
              descriptor: { code: "stateCode" },
              value: crop.state?.code ?? "",
            },
          ],
        },
      ],
    }));

    return {
      context: this.buildContext(body),
      message: {
        catalog: {
          descriptor: { name: "GFR Crop Registry" },
          providers: [
            {
              id: body?.message?.order?.provider?.id ?? "gfr-agri",
              descriptor: { name: "GFR Crop Registry" },
              items,
            },
          ],
        },
      },
    };
  }
}
