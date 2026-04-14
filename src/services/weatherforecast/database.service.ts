import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolConfig, QueryResult } from "pg";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DatabaseService.name);
    private pool: Pool;

    constructor() {
        const sslMode = (process.env.IMD_DB_SSLMODE || process.env.WEATHER_DB_SSLMODE || "").toLowerCase();
        const sslEnabledFromMode = ["require", "verify-ca", "verify-full", "no-verify"].includes(sslMode);
        const sslEnabled = this.parseBoolean(process.env.IMD_DB_SSL || process.env.WEATHER_DB_SSL, sslEnabledFromMode);
        const rejectUnauthorized = this.parseBoolean(
            process.env.IMD_DB_SSL_REJECT_UNAUTHORIZED || process.env.WEATHER_DB_SSL_REJECT_UNAUTHORIZED,
            false
        );

        const poolConfig: PoolConfig = {
            host: process.env.IMD_DB_HOST || process.env.WEATHER_DB_HOST,
            port: parseInt(process.env.IMD_DB_PORT || process.env.WEATHER_DB_PORT || "5432"),
            database: process.env.IMD_DB_NAME || process.env.WEATHER_DB_NAME,
            user: process.env.IMD_DB_USER || process.env.WEATHER_DB_USER,
            password: process.env.IMD_DB_PASSWORD || process.env.WEATHER_DB_PASSWORD,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        };

        if (sslEnabled) {
            poolConfig.ssl = { rejectUnauthorized };
        }

        this.pool = new Pool(poolConfig);
    }

    private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
        if (value === undefined) {
            return defaultValue;
        }
        return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }

    async onModuleInit() {
        try {
            // Test the connection
            const client = await this.pool.connect();
            this.logger.log("Database connection established");
            client.release();
        } catch (error) {
            this.logger.error("Failed to connect to database", error);
        }
    }

    async onModuleDestroy() {
        await this.pool.end();
        this.logger.log("Database connection pool closed");
    }

    async findNearbyStations(
        latitude: number,
        longitude: number,
        limit: number = 1
    ): Promise<any[]> {
        try {
            this.logger.log(
                `Querying nearby stations for lat: ${latitude}, lon: ${longitude}, limit: ${limit}`
            );

            const query = "SELECT * FROM find_nearby_stations($1, $2, $3) ORDER BY distance_km ASC;";
            const result: QueryResult = await this.pool.query(query, [
                latitude,
                longitude,
                limit,
            ]);

            if (result.rows && result.rows.length > 0) {
                this.logger.log(`Found ${result.rows.length} nearby station(s) within ${limit}km radius`);
                result.rows.forEach((row, index) => {
                    this.logger.log(
                        `Station ${index + 1}: ID=${row.station_id}, Name=${row.station_name}, District=${row.district}, State=${row.state}, Distance=${row.distance_km}km`
                    );
                });
                return result.rows;
            } else {
                this.logger.warn(`No nearby stations found within ${limit}km radius`);
                return [];
            }
        } catch (error) {
            this.logger.error("Error querying nearby stations", error);
            throw error;
        }
    }

    /**
     * Find mandi markets at a point using get_markets_at_point(lat, lon).
     * Returns rows with statecode, state, district_name, districtcode, marketcode (commoditycode from request).
     */
    async findMandiMasterData(latitude: number, longitude: number): Promise<MandiMasterRow[]> {
        try {
            const query = `
                SELECT
                    state_code AS "stateCode",
                    state,
                    district_code AS "districtCode",
                    district_name AS "district",
                    market_code AS "marketCode",
                    market_name AS "marketName"
                FROM get_markets_at_point($1, $2)
            `;
            const result: QueryResult = await this.pool.query(query, [latitude, longitude]);
            const rows: MandiMasterRow[] = (result.rows || []).map((r: any) => ({
                statecode: r.stateCode ?? "",
                state: r.state ?? "",
                district_name: r.district ?? "",
                districtcode: r.districtCode ?? "",
                marketcode: r.marketCode ?? "",
                commoditycode: undefined,
            }));
            this.logger.log(`Mandi: get_markets_at_point found ${rows.length} row(s) for lat=${latitude}, lon=${longitude}`);
            return rows;
        } catch (error) {
            this.logger.error("Error querying get_markets_at_point", error);
            throw error;
        }
    }
}

export interface MandiMasterRow {
    statecode: string;
    state: string;
    district_name: string;
    districtcode?: string;
    marketcode: string;
    commoditycode?: string;
}
