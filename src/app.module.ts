import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import {
  BecknTelemetryInterceptor,
  isTelemetryEnabled,
} from "./telemetry";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { HttpModule } from "@nestjs/axios";
import { LoggerService } from "./services/logger/logger.service";
import { ProviderModule } from "./provider/provider.module";
import { SeekerModule } from "./seeker/seeker.module";
import { HasuraService } from "./services/hasura/hasura.service";
import { S3Service } from "./services/s3/s3.service";
import { SeekerService } from "./seeker/seeker.service";
import { PmfbyService } from "./services/pmfby/pmfby.service";
import { PmfbyGrievanceService } from "./services/pmfby/pmfby-greviance.service";
import { WeatherForecastService } from "./services/weatherforecast/weatherforecast.service";
import { DatabaseService } from "./services/weatherforecast/database.service";
import { MandiService } from "./services/mandi/mandi.service";
import { AgmarknetApiService } from "./services/mandi/agmarknet-api.service";
import { BecknContextService } from "./services/mandi/beckn-context.service";
import { CatalogCompactService } from "./services/mandi/catalog-compact.service";
import { CommodityResolverService } from "./services/mandi/commodity-resolver.service";
import { CommoditySyncService } from "./services/mandi/commodity-sync.service";
import { GfrService } from "./services/gfr/gfr.service";
import { PmkisanGrievanceService } from "./services/pmkisan-grievance/pmkisan-grievance.service";
import { SathiService } from "./services/sathi/sathi.service";
import { SmamService } from "./services/smam/smam.service";
import { SchemeQdrantService } from "./services/scheme-qdrant/scheme-qdrant.service";
import { EmbeddingService } from "./services/scheme-qdrant/embedding.service";
import { QdrantClientService } from "./services/scheme-qdrant/qdrant.client";
import { SchemeCatalogService } from "./services/scheme-qdrant/scheme-catalog.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    {
      ...HttpModule.register({}),
      global: true,
    },
    AuthModule,
    AdminModule,
    ProviderModule,
    SeekerModule,
  ],
  controllers: [AppController],
  providers: [
    ...(isTelemetryEnabled()
      ? [
          {
            provide: APP_INTERCEPTOR,
            useClass: BecknTelemetryInterceptor,
          },
        ]
      : []),
    AppService,
    LoggerService,
    HasuraService,
    S3Service,
    SeekerService,
    PmfbyService,
    WeatherForecastService,
    DatabaseService,
    MandiService,
    AgmarknetApiService,
    BecknContextService,
    CatalogCompactService,
    CommodityResolverService,
    CommoditySyncService,
    GfrService,
    PmkisanGrievanceService,
    PmfbyGrievanceService,
    SathiService,
    SmamService,
    EmbeddingService,
    QdrantClientService,
    SchemeCatalogService,
    SchemeQdrantService,
  ],
})
export class AppModule {}
