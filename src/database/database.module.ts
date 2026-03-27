import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    /**
     * TypeOrmModule.forRootAsync registers the global DataSource and is required
     * for ALL @InjectRepository() and @InjectDataSource() injections.
     *
     * autoLoadEntities: true — automatically includes every entity registered
     *   via TypeOrmModule.forFeature() in any module; no manual entity list needed.
     *
     * synchronize: false — NEVER auto-migrate; always use explicit migrations.
     *
     * retryAttempts / retryDelay — gracefully handles slow DB startup in Docker
     *   Compose environments where MySQL may not be ready when NestJS boots.
     *
     * extra.connectionLimit — limits the MySQL2 connection pool.  Default is 10;
     *   20 is a reasonable starting point for a mid-traffic hotel SaaS API.
     */
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DB_HOST', 'localhost'),
        // parseInt is mandatory — env vars are always strings; ConfigService
        // generic <number> is a TypeScript hint only, NOT a runtime coercion.
        port: parseInt(config.get<string>('DB_PORT', '3306'), 10),
        username: config.get<string>('DB_USERNAME', 'root'),
        password: config.get<string>('DB_PASSWORD', 'root'),
        database: config.get<string>('DB_DATABASE', 'hotel_services_db'),

        autoLoadEntities: true,
        synchronize: false,
        charset: 'utf8mb4',
        timezone: '+07:00',

        // Retry logic — essential in Docker Compose where MySQL starts slowly
        retryAttempts: 10,
        retryDelay: 3_000, // ms between retries

        // SQL query logging — verbose in dev, errors-only in production
        logging: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],

        // MySQL2 connection pool settings
        extra: {
          connectionLimit: 20, // max simultaneous connections
          waitForConnections: true, // queue requests when pool is full
          queueLimit: 0, // 0 = unlimited queue depth
          connectTimeout: 10_000, // ms before connection attempt times out
        },
      }),
    }),
    PrismaModule,
  ],
  exports: [TypeOrmModule, PrismaModule],
})
export class DatabaseModule {}
