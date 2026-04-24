import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { LoggerService } from './services/logger/logger.service';
import { ProviderModule } from './provider/provider.module';
import { SeekerModule } from './seeker/seeker.module';
import { HasuraService } from './services/hasura/hasura.service';
import { S3Service } from './services/s3/s3.service';
import { SeekerService } from './seeker/seeker.service';
import { PmfbyService } from './services/pmfby/pmfby.service';
import { WeatherForecastService } from './services/weatherforecast/weatherforecast.service';
import { DatabaseService } from './services/weatherforecast/database.service';
import { MandiService } from './services/mandi/mandi.service';
import { SathiService } from './services/sathi/sathi.service';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    {
      ...HttpModule.register({}),
      global: true,
    }, 
    AuthModule, 
    AdminModule, ProviderModule, SeekerModule,
  ],
  controllers: [AppController],
  providers: [AppService, LoggerService, HasuraService, S3Service, SeekerService, PmfbyService, WeatherForecastService, DatabaseService, MandiService, SathiService],
})
export class AppModule {}
