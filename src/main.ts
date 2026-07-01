import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Enable rawBody so LINE Messaging webhook can verify HMAC-SHA256 signature
    rawBody: true,
  });

  // Serve local uploads only when using the local storage driver.
  // On production (STORAGE_DRIVER=s3) files live on object storage (R2/S3) and
  // are served from the bucket's public URL — no local disk serving needed.
  const storageDriver = process.env.STORAGE_DRIVER || 'local';
  if (storageDriver !== 's3') {
    const uploadsPath = join(process.cwd(), 'uploads');
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
    }
    app.useStaticAssets(uploadsPath, { prefix: '/uploads' });
    logger.log('Serving local uploads at /uploads (STORAGE_DRIVER=local)');
  } else {
    logger.log('STORAGE_DRIVER=s3 — uploads served from object storage');
  }

  // Increase body parser limit to 10 MB to support QC submissions that include
  // base64-encoded photos (up to 5 images) and inspector signature data URLs.
  // Default Express limit is 100 kb — far too small for image payloads.
  //
  // ใช้ app.useBodyParser (ไม่ใช่ app.use(json())) เพื่อให้ rawBody ยังถูกเก็บไว้ —
  // จำเป็นสำหรับ verify HMAC signature ของ webhook (LINE x-line-signature,
  // Facebook x-hub-signature-256). app.use(json()) จะแทน parser ของ Nest ทำให้
  // req.rawBody เป็น undefined และ signature check ถูกข้ามแบบเงียบ ๆ
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter is registered as a DI provider in AppModule
  // (APP_FILTER) so it can inject I18nService and localise per-request errors.

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // CORS configuration
  // Read allowed origins from .env or use defaults
  const allowedOriginsEnv =
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,http://localhost:2000,http://localhost:9010,http://localhost:9011';
  const allowedOrigins = allowedOriginsEnv.split(',').map((origin) => origin.trim());

  logger.log('CORS allowed origins: ' + allowedOrigins.join(', '));

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('CORS blocked origin: ' + origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
  });

  // API prefix + versioning
  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const port = process.env.PORT || 9011;

  // Swagger/OpenAPI documentation — disabled on production to avoid exposing API schema
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Hotel Services API')
      .setDescription('Hotel Management System API Documentation')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
