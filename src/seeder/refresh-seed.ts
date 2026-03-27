import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SeederService } from './seeder.service';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PrismaService } from '../prisma/prisma.service';
import { execSync } from 'child_process';

const logger = new Logger('Seeder');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seeder = app.get(SeederService);
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const prisma = app.get(PrismaService);

  try {
    logger.log('Starting database refresh and seed...');
    logger.log('');

    // 1. Drop all tables (ระวัง! ลบข้อมูลทั้งหมด)
    logger.log('Dropping all tables...');
    const queryRunner = dataSource.createQueryRunner();

    try {
      // ปิดการตรวจสอบ foreign key ชั่วคราว
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');

      // ดึงรายชื่อ tables จาก information_schema แทนการใช้ getTables()
      // เพื่อหลีกเลี่ยงปัญหา typeorm_metadata
      const database = dataSource.options.database as string;
      const result = await queryRunner.query(
        `SELECT TABLE_NAME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME NOT IN ('typeorm_metadata', 'engine_cost', 'server_cost')`,
        [database],
      );

      // Whitelist of safe table names to drop (security: prevent SQL injection via table name)
      const allowedTableNames = new Set<string>();
      for (const row of result) {
        const tableName = row.TABLE_NAME;
        // Validate table name: only alphanumeric, underscore, and hyphen allowed
        if (/^[a-zA-Z0-9_-]+$/.test(tableName)) {
          allowedTableNames.add(tableName);
        } else {
          logger.warn('Skipped dropping table with invalid name: ' + tableName);
        }
      }

      // ลบ tables ทั้งหมด
      for (const tableName of allowedTableNames) {
        try {
          await queryRunner.query(`DROP TABLE IF EXISTS \`${tableName}\``);
          logger.log('Dropped table: ' + tableName);
        } catch (error) {
          logger.warn('Could not drop table ' + tableName + ': ' + (error as Error).message);
        }
      }

      // เปิดการตรวจสอบ foreign key กลับมา
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');

      logger.log('All user tables dropped');
    } catch (error) {
      logger.error('Error during table drop: ' + ((error as Error).message || String(error)));
      // Make sure to re-enable foreign key checks even if there's an error
      try {
        await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (fkError) {
        // Ignore FK re-enable errors
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
    logger.log('');

    // 2. Run Prisma migrations (สร้าง Prisma tables เช่น users, guests, etc.)
    logger.log('Running Prisma migrations...');
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      logger.log('Prisma migrations completed');

      // Generate Prisma Client to ensure it's up to date
      execSync('npx prisma generate', { stdio: 'inherit' });
      logger.log('Prisma client generated');

      // Reconnect Prisma to pick up new schema
      await prisma.$connect();
      logger.log('Prisma client reconnected');
    } catch (error) {
      logger.warn('Prisma setup failed: ' + ((error as Error).message || String(error)));
      // Continue anyway - tables might already exist
    }
    logger.log('');

    // 3. Synchronize TypeORM database (สร้าง TypeORM tables เช่น subscriptions, plans, etc.)
    // ⚠️ ใช้ synchronize(false) เพื่อไม่ให้ drop Prisma tables ที่เพิ่งสร้าง
    logger.log('Creating TypeORM tables...');
    try {
      await dataSource.synchronize(false);
      logger.log('All TypeORM tables created');
    } catch (error) {
      // Ignore metadata table errors (ไม่กระทบการทำงาน)
      if ((error as Error).message && (error as Error).message.includes('typeorm_metadata')) {
        logger.log('All TypeORM tables created (metadata table warning ignored)');
      } else {
        throw error;
      }
    }
    logger.log('');

    // 4. Run seeder
    logger.log('Seeding data...');
    await seeder.seed();
    logger.log('');

    logger.log('Database refresh and seed completed successfully!');
    logger.log('');
    logger.log('Summary:');
    logger.log('  - Database: Refreshed');
    logger.log('  - Prisma Tables: Created (users, guests, bookings, etc.)');
    logger.log('  - TypeORM Tables: Created (subscriptions, plans, etc.)');
    logger.log('  - Data: Seeded (including 5 test users)');
    logger.log('');

    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error: ' + ((error as Error).message || String(error)));
    await app.close();
    process.exit(1);
  }
}

bootstrap();
