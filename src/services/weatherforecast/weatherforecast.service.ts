import { Injectable, Logger, InternalServerErrorException } from "@nestjs/common";
import { components } from "types/schema";
import axios from "axios";
import { DatabaseService } from "./database.service";
@Injectable()
export class WeatherForecastService {
    private readonly logger = new Logger(WeatherForecastService.name);

    constructor(private readonly databaseService: DatabaseService) { }

    public async weatherforecastSearch(body: {
        context: components["schemas"]["Context"];
        message: { intent: components["schemas"]["Intent"] };
    }) {

        
        try {
            this.logger.log("Weather forecast search initiated");
            const intent: any = body.message.intent;

            // destructuring the intent
            const query = intent?.category?.descriptor?.name;
            
            // Get coordinates from fulfillment (required for finding nearby station)
            const fulfillment: any = body.message.intent.fulfillment;
            let lat = 0;
            let long = 0;
            let stationId = null;
            let stationDetails: any = null; // Store station details from database
            const distanceInKm: any = process.env.DISTANCE_IN_KM;
            if (fulfillment?.stops && Array.isArray(fulfillment.stops) && fulfillment.stops.length > 0) {
                const location = fulfillment.stops[0]?.location ?? {};

                // New structure: separate lat / lon fields (strings)
                if (location.lat && location.lon) {
                    lat = parseFloat(location.lat);
                    long = parseFloat(location.lon);
                    this.logger.log(`Coordinates found (lat/lon): lat: ${lat}, long: ${long}`);
                }
                // Backward compatibility: old "gps" field with "lat, lon"
                else if (location.gps) {
                    const [latStr, longStr] = (location.gps as string)
                        .split(",")
                        .map((s: string) => s.trim());
                    lat = parseFloat(latStr) || 0;
                    long = parseFloat(longStr) || 0;
                    this.logger.log(`Coordinates found (gps): lat: ${lat}, long: ${long}`);
                }
            }

            // If coordinates are available, find nearby stations from database
            let nearbyStations: any[] = [];
            if (lat !== 0 && long !== 0) {
                try {
                    nearbyStations = await this.databaseService.findNearbyStations(lat, long, distanceInKm);
                    if (nearbyStations && nearbyStations.length > 0) {
                        this.logger.log(`Retrieved ${nearbyStations.length} nearby station(s) from database. Will try each until data is found.`);
                    } else {
                        this.logger.warn("No nearby stations found in database for the given coordinates");
                    }
                } catch (dbError) {
                    this.logger.error("Error querying database for nearby stations", dbError);
                    // Continue with fallback to manual stationId extraction
                }
            }

            // Fallback: Extract stationId from tags if GPS lookup didn't find stations
            if (nearbyStations.length === 0 && !stationId) {
                // New structure: intent.tags[0] where descriptor.code === "stationId" and list[0].value is the stationId
                if (intent?.tags && Array.isArray(intent.tags) && intent.tags.length > 0) {
                    const stationIdTag = intent.tags.find((tag: any) =>
                        tag?.descriptor?.code === "stationId" || tag?.descriptor?.code === "station_id"
                    );
                    if (stationIdTag?.list && Array.isArray(stationIdTag.list) && stationIdTag.list.length > 0) {
                        stationId = stationIdTag.list[0]?.value;
                    }
                }

                // Fallback to old structure: intent.item.tags
                if (!stationId) {
                    const tagGroup = intent?.item?.tags;
                    const flattenedTags: any = {};
                    if (tagGroup && Array.isArray(tagGroup) && tagGroup.length > 0) {
                        (tagGroup[0].list as any[])?.forEach((tag) => {
                            flattenedTags[tag.name] = tag.value;
                        });
                    }
                    stationId = flattenedTags?.stationId || flattenedTags?.station_id;
                }

                // Fallback to context.tags or item.descriptor.code
                if (!stationId) {
                    const contextAny: any = body.context;
                    stationId =
                        contextAny?.tags?.stationId ||
                        contextAny?.tags?.station_id ||
                        intent?.item?.descriptor?.code ||
                        null;
                }
            }

            if (nearbyStations.length === 0 && !stationId) {
                this.logger.warn("No nearby stations found and no Station ID provided. Please provide coordinates in fulfillment.stops[0].location.{lat,lon} or stationId in intent.tags");
                const onSearchContext = {
                    ...body.context,
                    action: "on_search",
                    timestamp: new Date().toISOString(),
                };
                return {
                    context: body.context, // Original search context
                    responses: [
                        {
                            context: onSearchContext, // on_search context
                            message: {
                                catalog: {
                                    descriptor: { name: `Weather Catalog for ${query}` },
                                    providers: [],
                                },
                            },
                        },
                    ],
                };
            }

            // Get date range from item.time.range (optional)
            let startDate;
            let endDate;

            if (body?.message?.intent?.item?.time?.range) {
                startDate = body?.message?.intent?.item?.time?.range?.start;
                endDate = body?.message?.intent?.item?.time?.range?.end;
            }

            // Fetch weather data from IMD API
            let weatherData = null;

            // If we have multiple nearby stations, try each until we get data
            if (nearbyStations && nearbyStations.length > 0) {
                this.logger.log(`Attempting to fetch weather data from ${nearbyStations.length} station(s) in order of proximity...`);

                for (let i = 0; i < nearbyStations.length; i++) {
                    const station = nearbyStations[i];
                    stationId = station.station_id;
                    stationDetails = station;

                    this.logger.log(
                        `[Station ${i + 1}/${nearbyStations.length}] Trying station ID: ${stationId}, Name: ${station.station_name}, Distance: ${station.distance_km}km`
                    );

                    weatherData = await this.findWeatherForecastContent(stationId);

                    if (weatherData && weatherData.length > 0) {
                        this.logger.log(
                            `✓ Successfully retrieved weather data from station: ${stationId} (${station.station_name}) at distance ${station.distance_km}km`
                        );
                        break; // Stop checking other stations
                    } else {
                        this.logger.warn(
                            `✗ No data available from station: ${stationId} (${station.station_name}). Trying next station...`
                        );
                    }
                }

                if (!weatherData || weatherData.length === 0) {
                    this.logger.error(`Failed to fetch weather data from all ${nearbyStations.length} nearby station(s)`);
                }
            } else if (stationId) {
                // Fallback: single station ID from tags or context
                this.logger.log(`Using Station ID from request: ${stationId}`);
                weatherData = await this.findWeatherForecastContent(stationId);
            }

            // Generate catalog
            const catalog = this.WeatherForecastCatalogGenerator(
                weatherData,
                lat,
                long,
                startDate,
                endDate,
                query,
                stationId,
                stationDetails // Pass station details to catalog generator
            );

            // Create on_search context
            const onSearchContext = {
                ...body.context,
                action: "on_search",
                timestamp: new Date().toISOString(),
            };

            // Return response in the expected structure with responses array
            return {
                context: onSearchContext, // on_search context
                message: {
                    catalog: catalog,
                },
            };

        } catch (error) {
            this.logger.error("Error in weather forecast search", error);
            throw new InternalServerErrorException(error.message, {
                cause: error,
            });
        }
    }

    public async mausamgramWeatherforecastSearch(body: {
        context: components["schemas"]["Context"];
        message: { intent: components["schemas"]["Intent"] };
    }) {
        try {
            this.logger.log("Mausamgram weather forecast search initiated");
            const intent: any = body.message.intent;
            const query = intent?.category?.descriptor?.name;
            const fulfillment: any = body.message.intent.fulfillment;

            let lat = 0;
            let long = 0;

            if (fulfillment?.stops && Array.isArray(fulfillment.stops) && fulfillment.stops.length > 0) {
                const location = fulfillment.stops[0]?.location ?? {};
                if (location.lat && location.lon) {
                    lat = parseFloat(location.lat);
                    long = parseFloat(location.lon);
                } else if (location.gps) {
                    const [latStr, longStr] = (location.gps as string).split(",").map((s: string) => s.trim());
                    lat = parseFloat(latStr) || 0;
                    long = parseFloat(longStr) || 0;
                }
            }

            if (lat === 0 || long === 0) {
                this.logger.warn("No coordinates found for Mausamgram search");
                return {
                    context: { ...body.context, action: "on_search", timestamp: new Date().toISOString() },
                    message: {
                        catalog: {
                            descriptor: { name: `Weather Catalog for ${query}` },
                            providers: [],
                        },
                    },
                };
            }

            this.logger.log(`Fetching Mausamgram weather data for lat: ${lat}, long: ${long}`);
            const weatherData = await this.findMausamgramWeatherContent(lat, long);

            const catalog = this.MausamgramCatalogGenerator(
                weatherData,
                lat,
                long,
                query
            );

            return {
                context: { ...body.context, action: "on_search", timestamp: new Date().toISOString() },
                message: {
                    catalog: catalog,
                },
            };
        } catch (error) {
            this.logger.error("Error in Mausamgram weather forecast search", error);
            throw new InternalServerErrorException(error.message, { cause: error });
        }
    }

    async findMausamgramWeatherContent(lat: number, long: number, maxRetries: number = 3): Promise<any> {
        let lastError: any = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const auth = Buffer.from(`${process.env.MAUSAMGRAM_USER}:${process.env.MAUSAMGRAM_X_API_KEY}`).toString('base64');
                const config = {
                    method: 'get',
                    url: `${process.env.MAUSAMGRAM_ENDPOINT}/get-daily?lat=${lat}&lon=${long}`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${auth}`
                    },
                    timeout: 30000,
                };
                this.logger.log(`Mausamgram API Attempt ${attempt}/${maxRetries}`);
                const response = await axios.request(config);
                return response.data;
            } catch (error: any) {
                lastError = error;
                this.logger.error(`Mausamgram API error: ${error.message}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        return null;
    }

    async findWeatherForecastContent(stationId: string, maxRetries: number = 3): Promise<any> {
        let lastError: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`Fetching weather data for station ID: ${stationId} (Attempt ${attempt}/${maxRetries})`);

                // Use the exact same pattern as testWeatherAPI from pmfby.service.ts
                const config = {
                    method: 'get',
                    url: `${process.env.IMD_WEATHER_API_URL}?id=${stationId}`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': '*/*',
                    },
                    timeout: 30000, // 30 seconds timeout
                };

                this.logger.log('Weather API config:', JSON.stringify(config, null, 2));

                const response = await axios.request(config);

                this.logger.log(`Weather API response status: ${response.status}`);
                this.logger.log('Weather API response data:', JSON.stringify(response.data, null, 2));

                return response.data;
            } catch (error: any) {
                lastError = error;

                // Use the exact same error handling pattern as testWeatherAPI
                this.logger.error(`Error fetching weather data: ${error.message}`);
                if (error.response) {
                    this.logger.error('Error response:', {
                        status: error.response.status,
                        data: error.response.data
                    });
                }
                if (error.request) {
                    this.logger.error('Request made but no response received');
                }
                if (error.code) {
                    this.logger.error(`Error code: ${error.code}`);
                }

                // Check for timeout errors
                if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
                    this.logger.warn(
                        `Weather API request timed out for station ID: ${stationId} (Attempt ${attempt}/${maxRetries})`
                    );
                } else if (error.response && error.response.status >= 400 && error.response.status < 500) {
                    // Client errors - don't retry
                    this.logger.error(`Client error (${error.response.status}), not retrying`);
                    break;
                }

                // If this is not the last attempt, wait before retrying (exponential backoff)
                if (attempt < maxRetries) {
                    const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
                    this.logger.log(`Waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        // All retries failed, log final error and return null
        this.logger.error(
            `Failed to fetch weather data after ${maxRetries} attempts for station ID: ${stationId}`,
            lastError?.message || lastError?.code || 'Unknown error'
        );
        return null;
    }


    WeatherForecastCatalogGenerator = (
        apiData: any,
        lat: any,
        long: any,
        startDate: any,
        endDate: any,
        query: string,
        stationId: string,
        stationDetails: any = null
    ) => {
        // Handle API response - IMD API returns an array
        let weatherData = null;

        if (apiData && Array.isArray(apiData) && apiData.length > 0) {
            weatherData = apiData[0];
        } else if (apiData?.data && Array.isArray(apiData.data) && apiData.data.length > 0) {
            weatherData = apiData.data[0];
        }

        if (!weatherData) {
            return {
                descriptor: { name: `Weather Catalog for ${query}` },
                providers: [],
            };
        }

        const {
            Date: forecastDate,
            Station_Code,
            Station_Name,
            Today_Max_temp,
            Today_Min_temp,
            Past_24_hrs_Rainfall,
            Relative_Humidity_at_0830,
            Relative_Humidity_at_1730,
            Todays_Forecast_Max_Temp,
            Todays_Forecast_Min_temp,
            Todays_Forecast,
            Day_2_Max_Temp,
            Day_2_Min_temp,
            Day_2_Forecast,
            Day_3_Max_Temp,
            Day_3_Min_temp,
            Day_3_Forecast,
            Day_4_Max_Temp,
            Day_4_Min_temp,
            Day_4_Forecast,
            Day_5_Max_Temp,
            Day_5_Min_temp,
            Day_5_Forecast,
            Day_6_Max_Temp,
            Day_6_Min_temp,
            Day_6_Forecast,
            Day_7_Max_Temp,
            Day_7_Min_temp,
            Day_7_Forecast,
            Latitude,
            Longitude
        } = weatherData;

        // Create consolidated tags - one entry for today and one for each forecast day
        const consolidatedTags = [];

        // Today's data entry
        const todayTags: any[] = [
            { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
            { descriptor: { code: "Station Name" }, value: Station_Name || stationDetails?.station_name || "N/A" },
            { descriptor: { code: "Date" }, value: forecastDate || "N/A" },
            { descriptor: { code: "Hour" }, value: "00:00" },
            { descriptor: { code: "Rainfall" }, value: `${Past_24_hrs_Rainfall ?? "N/A"}` },
            { descriptor: { code: "Min Temp" }, value: `${Today_Min_temp ?? Todays_Forecast_Min_temp ?? "N/A"} °C` },
            { descriptor: { code: "Max Temp" }, value: `${Today_Max_temp ?? Todays_Forecast_Max_Temp ?? "N/A"} °C` },
            { descriptor: { code: "Avg Temp" }, value: "N/A" },
            { descriptor: { code: "Min Humidity" }, value: `${Relative_Humidity_at_0830 ?? "N/A"} %` },
            { descriptor: { code: "Max Humidity" }, value: `${Relative_Humidity_at_1730 ?? "N/A"} %` },
            { descriptor: { code: "Weather Condition" }, value: Todays_Forecast || "N/A" },
        ];

        // Add station details from database if available
        if (stationDetails) {
            todayTags.push(
                { descriptor: { code: "Station ID" }, value: stationDetails.station_id || stationId || "N/A" },
                { descriptor: { code: "Station Name (DB)" }, value: stationDetails.station_name || "N/A" },
                { descriptor: { code: "District" }, value: stationDetails.district || "N/A" },
                { descriptor: { code: "State" }, value: stationDetails.state || "N/A" },
                { descriptor: { code: "Distance" }, value: `${stationDetails.distance_km || "N/A"} km` }
            );
        }

        consolidatedTags.push({
            descriptor: {
                code: forecastDate || "N/A",
            },
            list: todayTags,
        });

        // Day 2 forecast entry
        if (Day_2_Max_Temp || Day_2_Min_temp || Day_2_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_2",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 2" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_2_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_2_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_2_Forecast || "N/A" },
                ],
            });
        }

        // Day 3 forecast entry
        if (Day_3_Max_Temp || Day_3_Min_temp || Day_3_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_3",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 3" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_3_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_3_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_3_Forecast || "N/A" },
                ],
            });
        }

        // Day 4 forecast entry
        if (Day_4_Max_Temp || Day_4_Min_temp || Day_4_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_4",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 4" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_4_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_4_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_4_Forecast || "N/A" },
                ],
            });
        }

        // Day 5 forecast entry
        if (Day_5_Max_Temp || Day_5_Min_temp || Day_5_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_5",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 5" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_5_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_5_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_5_Forecast || "N/A" },
                ],
            });
        }

        // Day 6 forecast entry
        if (Day_6_Max_Temp || Day_6_Min_temp || Day_6_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_6",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 6" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_6_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_6_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_6_Forecast || "N/A" },
                ],
            });
        }

        // Day 7 forecast entry
        if (Day_7_Max_Temp || Day_7_Min_temp || Day_7_Forecast) {
            consolidatedTags.push({
                descriptor: {
                    code: "Day_7",
                },
                list: [
                    { descriptor: { code: "Location" }, value: `Station ID: ${Station_Code || stationId || "N/A"}` },
                    { descriptor: { code: "Date" }, value: "Day 7" },
                    { descriptor: { code: "Min Temp" }, value: `${Day_7_Min_temp ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${Day_7_Max_Temp ?? "N/A"} °C` },
                    { descriptor: { code: "Weather Condition" }, value: Day_7_Forecast || "N/A" },
                ],
            });
        }

        // Use coordinates from API if available, otherwise use provided lat/long
        const finalLat = Latitude || lat;
        const finalLong = Longitude || long;

        // Build stop object conditionally
        const stop: any = {
            location: {
                // New structure expected by BAP: separate lat / lon fields
                lat: `${finalLat}`,
                lon: `${finalLong}`,
            },
        };

        if (startDate && endDate) {
            stop.time = {
                range: {
                    start: startDate,
                    end: endDate,
                },
            };
        }

        const provider = {
            id: "1",
            descriptor: {
                name: "Weather Forecast",
                short_desc: "IMD Weather Services",
                images: [],
            },
            categories: [
                {
                    id: "c1",
                    descriptor: {
                        code: "Weather-forecast",
                        name: "Weather Forecast",
                    },
                },
            ],
            fulfillments: [
                {
                    id: "f1",
                    stops: [stop],
                },
            ],
            items: [
                {
                    id: "1",
                    descriptor: {
                        images: [],
                        name: `Weather Report for ${Station_Name || Station_Code || stationId}`,
                        short_desc: `Forecast from ${forecastDate || "N/A"}`,
                    },
                    matched: true,
                    recommended: true,
                    category_ids: ["c1"],
                    fulfillment_ids: ["f1"],
                    tags: consolidatedTags,
                },
            ],
        };

        return {
            descriptor: { name: `Weather Catalog for ${query}` },
            providers: [provider],
        };
    }

    MausamgramCatalogGenerator = (
        apiData: any,
        lat: any,
        long: any,
        query: string
    ) => {
        if (!apiData || (!apiData.fcstday1 && !apiData.fcstday2)) {
            return {
                descriptor: { name: `Weather Catalog for ${query}` },
                providers: [],
            };
        }

        const consolidatedTags = [];
        const forecastDays = ['fcstday1', 'fcstday2', 'fcstday3', 'fcstday4', 'fcstday5'];

        forecastDays.forEach((dayKey, index) => {
            const dayData = apiData[dayKey];
            if (dayData) {
                const dayTags: any[] = [
                    { descriptor: { code: "Location" }, value: `Lat: ${lat}, Lon: ${long}` },
                    { descriptor: { code: "Date" }, value: dayData.date || "N/A" },
                    { descriptor: { code: "Rainfall" }, value: `${dayData.rain ?? "N/A"} mm` },
                    { descriptor: { code: "Min Temp" }, value: `${dayData.tmin ?? "N/A"} °C` },
                    { descriptor: { code: "Max Temp" }, value: `${dayData.tmax ?? "N/A"} °C` },
                    { descriptor: { code: "Min Humidity" }, value: `${dayData.rhmin ?? "N/A"} %` },
                    { descriptor: { code: "Max Humidity" }, value: `${dayData.rhmax ?? "N/A"} %` },
                    { descriptor: { code: "Wind Speed" }, value: `${dayData.wspd ?? "N/A"} m/s` },
                    { descriptor: { code: "Wind Direction" }, value: dayData.wind?.[1] || "N/A" },
                    { descriptor: { code: "Weather Condition" }, value: dayData.weather_warning || dayData.cloud_message || "N/A" },
                ];

                consolidatedTags.push({
                    descriptor: {
                        code: index === 0 ? "Today" : `Day_${index + 1}`,
                    },
                    list: dayTags,
                });
            }
        });

        const finalLat = apiData.location?.lat || lat;
        const finalLong = apiData.location?.lon || long;

        return {
            descriptor: { name: `Weather Catalog for ${query}` },
            providers: [{
                id: "mausamgram-provider",
                descriptor: {
                    name: "Mausamgram Weather Forecast",
                    short_desc: "Gram Panchayat-Level Weather Forecasts",
                    images: [],
                },
                categories: [{
                    id: "c1",
                    descriptor: {
                        code: "Weather-forecast",
                        name: "Weather Forecast",
                    },
                }],
                fulfillments: [{
                    id: "f1",
                    stops: [{
                        location: {
                            lat: `${finalLat}`,
                            lon: `${finalLong}`,
                        },
                    }],
                }],
                items: [{
                    id: "mausamgram-item-1",
                    descriptor: {
                        images: [],
                        name: `Weather Report for Lat: ${finalLat}, Lon: ${finalLong}`,
                        short_desc: `Mausamgram Forecast`,
                    },
                    matched: true,
                    recommended: true,
                    category_ids: ["c1"],
                    fulfillment_ids: ["f1"],
                    tags: consolidatedTags,
                }],
            }],
        };
    }
}