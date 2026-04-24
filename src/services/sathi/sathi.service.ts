import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { ConfigService } from "@nestjs/config";
import { districtMap } from "./district-map";

@Injectable()
export class SathiService {
    private readonly baseUrl: string;
    private readonly apiKey: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService
    ) {
        this.baseUrl = (this.configService.get<string>("SATHI_BASE_URL") || process.env.SATHI_BASE_URL || "").replace(/\/$/, "");
        this.apiKey = this.configService.get<string>("SATHI_API_KEY") || process.env.SATHI_API_KEY || "";
    }

    private normalizeString(value: string): string {
        return (value || "").trim().toLowerCase();
    }

    async getDistrictCode(stateCode: string, districtName: string): Promise<string> {
        const normalizedDistrict = this.normalizeString(districtName);
        const districts = districtMap[stateCode];
        if (!districts || !Array.isArray(districts)) {
            throw new HttpException(
                `District not found for state code ${stateCode}`,
                HttpStatus.BAD_REQUEST
            );
        }

        const found = districts.find(
            (item) => this.normalizeString(item.district_name) === normalizedDistrict
        );

        if (!found) {
            throw new HttpException(
                `District not found for state code ${stateCode} and district ${districtName}`,
                HttpStatus.BAD_REQUEST
            );
        }

        return found.district_code;
    }

    async getCropCode(cropName: string): Promise<string> {
        if (!this.baseUrl) {
            throw new HttpException("Sathi base URL not configured", HttpStatus.INTERNAL_SERVER_ERROR);
        }
        const normalizedCrop = this.normalizeString(cropName);
        const url = `${this.baseUrl}/ms-nb-001-master/api/get-crops-list?crop_name=${encodeURIComponent(
            cropName
        )}`;

        try {
            const response = await firstValueFrom(
                this.httpService.get(url, { timeout: 15000 })
            );
            const cropCode = response.data?.EncryptedResponse?.data?.[0]?.crop_code;
            if (cropCode) {
                return cropCode;
            }
        } catch (error) {
            // Continue to fallback when first endpoint fails or returns empty
        }

        try {
            const fallbackUrl = `${this.baseUrl}/api/getCropForCentral`;
            const fallbackResponse = await firstValueFrom(
                this.httpService.get(fallbackUrl, { timeout: 15000 })
            );
            const fallbackData = fallbackResponse.data;
            const candidates = Array.isArray(fallbackData)
                ? fallbackData
                : Array.isArray(fallbackData?.data)
                    ? fallbackData.data
                    : Array.isArray(fallbackData?.payload)
                        ? fallbackData.payload
                        : [];

            const matched = candidates.find((item: any) =>
                this.normalizeString(item.cropName || item.crop_name || item.crop) ===
                normalizedCrop
            );

            if (!matched) {
                throw new HttpException(
                    `Crop not found: ${cropName}`,
                    HttpStatus.BAD_REQUEST
                );
            }

            return (
                matched.cropCode ||
                matched.crop_code ||
                matched.code ||
                String(matched?.cropCode || matched?.crop_code || matched?.code || "")
            );
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                `Crop not found: ${cropName}`,
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async getProducerCodes(stateCode: string, districtCode: string): Promise<string[]> {
        if (!this.baseUrl) {
            throw new HttpException("Sathi base URL not configured", HttpStatus.INTERNAL_SERVER_ERROR);
        }
        const url = `${this.baseUrl}/api/getSpaDetailStateWise?stateCode=${encodeURIComponent(
            stateCode
        )}&districtCode=${encodeURIComponent(districtCode)}`;

        try {
            const response = await firstValueFrom(
                this.httpService.get(url, { timeout: 15000 })
            );
            const data = response.data;
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.data)
                    ? data.data
                    : [];

            return items
                .map((item: any) => item?.spaCode || item?.producerCode || item?.spa_code)
                .filter(Boolean);
        } catch (error: any) {
            if (error?.response?.status === 400) {
                throw new HttpException(
                    "Producer lookup failed due to invalid state or district",
                    HttpStatus.BAD_REQUEST
                );
            }
            return [];
        }
    }

    private buildAvailabilityRequest(
        producerCode: string,
        cropCode: string,
        stateCode: string,
        districtCode: string
    ) {
        return {
            producerCode,
            cropCode,
            seedClass: "CERTIFIED I",
            stateCode,
            districtCode,
            apiKey: this.apiKey,
        };
    }

    async getSeedAvailabilityForProducers(
        producerCodes: string[],
        cropCode: string,
        stateCode: string,
        districtCode: string
    ): Promise<any[]> {
        if (!this.baseUrl) {
            throw new HttpException("Sathi base URL not configured", HttpStatus.INTERNAL_SERVER_ERROR);
        }
        if (!producerCodes?.length) {
            return [];
        }

        const url = `${this.baseUrl}/inv-apis2/stock/getSeedAvailability`;
        const promises = producerCodes.map((producerCode) =>
            firstValueFrom(
                this.httpService.post(url, this.buildAvailabilityRequest(producerCode, cropCode, stateCode, districtCode), {
                    timeout: 15000,
                    headers: { "Content-Type": "application/json" },
                })
            ).then((response) => response.data)
                .catch((error: any) => {
                    if (error?.response?.status === 409) {
                        return null;
                    }
                    return null;
                })
        );

        const settled = await Promise.all(promises);
        const allResponses = settled.filter((item) => item && item.data);
        const availabilityItems: any[] = [];

        for (const resp of allResponses) {
            const dataArray = Array.isArray(resp.data)
                ? resp.data
                : Array.isArray(resp.data?.data)
                    ? resp.data.data
                    : [];

            for (const dataEntry of dataArray) {
                if (Array.isArray(dataEntry.available_at) && dataEntry.available_at.length > 0) {
                    availabilityItems.push(dataEntry);
                }
            }
        }

        return availabilityItems;
    }

    aggregateSeedAvailability(rawData: any[], variety?: string) {
        if (!Array.isArray(rawData) || rawData.length === 0) {
            return [];
        }

        const normalizedVariety = this.normalizeString(variety || "");
        const grouped: Record<string, {
            dealer: string;
            variety: string;
            total_bags: number;
            contact: string;
        }> = {};

        for (const item of rawData) {
            const availableAt = Array.isArray(item?.available_at) ? item.available_at : [];
            for (const entry of availableAt) {
                const dealer = entry?.dealer_name?.trim() || "Unknown Dealer";
                const varietyName = entry?.variety_name?.trim() || "Unknown Variety";
                const contact = entry?.contact_number?.trim() || "N/A";
                const bags = Number(entry?.bags ?? 0) || 0;

                if (variety && this.normalizeString(varietyName) !== normalizedVariety) {
                    continue;
                }

                const key = `${dealer}||${varietyName}`;
                if (!grouped[key]) {
                    grouped[key] = {
                        dealer,
                        variety: varietyName,
                        total_bags: 0,
                        contact,
                    };
                }

                grouped[key].total_bags += bags;
                if (grouped[key].contact === "N/A" && contact !== "N/A") {
                    grouped[key].contact = contact;
                }
            }
        }

        return Object.values(grouped).map((item) => ({
            dealer: item.dealer,
            variety: item.variety,
            total_bags: item.total_bags,
            contact: item.contact || "N/A",
        }));
    }
}