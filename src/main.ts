import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from 'dotenv';
import * as Sentry from '@sentry/node';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';


config(); 


async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  
  Sentry.init({
    dsn: 'YOUR_SENTRY_DSN_HERE', // Replace with your actual Sentry DSN
  });
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.errorHandler());
  app.setViewEngine('ejs');
  app.setBaseViewsDir(join('src','.', 'views'));


  app.enableCors();
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  // Log after server starts
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📡 Server started successfully on port ${port}`);
  console.log(`\n========================================`);
  console.log(`🚀 Server is running on port: ${port}`);
  console.log(`🌐 Access the API at: http://localhost:${port}`);
  console.log(`========================================\n`);
}
bootstrap();
