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

    // 2. Prepare _prisma_migrations table
    // ไม่สร้าง dummy tables (tenants, plans, features) เพราะ collation จะ mismatch กับ TypeORM
    // Prisma migration ที่มี FK → tenants ถูก defer ไว้ใน migration SQL แล้ว (IF EXISTS check)
    logger.log('Preparing database for Prisma migrations...');
    const setupQueryRunner = dataSource.createQueryRunner();
    try {
      await setupQueryRunner.query(`
        CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
          \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
          \`checksum\` VARCHAR(64) NOT NULL,
          \`finished_at\` DATETIME(3),
          \`migration_name\` VARCHAR(255) NOT NULL,
          \`logs\` TEXT,
          \`rolled_back_at\` DATETIME(3),
          \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          \`applied_steps_count\` INTEGER UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);
      logger.log('Prisma migrations table created');
    } catch (error) {
      logger.warn('Prisma preparation failed: ' + (error as Error).message);
    } finally {
      await setupQueryRunner.release();
    }
    logger.log('');

    // 3. Run Prisma migrations (สร้าง Prisma tables เช่น users, admins, guests, etc.)
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
      logger.error('Prisma setup failed: ' + ((error as Error).message || String(error)));
      throw error;
    }
    logger.log('');

    // 4. Synchronize TypeORM database (สร้าง/อัปเดต TypeORM tables เช่น subscriptions, plans และทับตาราง dummy)
    logger.log('Synchronizing TypeORM entities...');
    try {
      await dataSource.synchronize(false);
      logger.log('TypeORM synchronization completed');
    } catch (error) {
      if ((error as Error).message && (error as Error).message.includes('typeorm_metadata')) {
        logger.log('TypeORM synchronization completed (metadata warning ignored)');
      } else {
        throw error;
      }
    }
    logger.log('');

    // 4b. Re-add deferred cross-ORM FK constraints
    logger.log('Re-adding deferred FK constraints...');
    const fkRunner = dataSource.createQueryRunner();
    try {
      // Check if user_tenants_tenantId_fkey is missing
      const fkResult = await fkRunner.query(`
        SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'user_tenants'
        AND CONSTRAINT_NAME = 'user_tenants_tenantId_fkey'
      `);
      if (!fkResult || fkResult.length === 0) {
        await fkRunner.query(`
          ALTER TABLE \`user_tenants\` ADD CONSTRAINT \`user_tenants_tenantId_fkey\`
          FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
        `);
        logger.log('Re-added user_tenants → tenants FK constraint');
      } else {
        logger.log('user_tenants → tenants FK already exists');
      }
    } catch (fkError) {
      logger.warn('Could not re-add user_tenants FK: ' + (fkError as Error).message);
    } finally {
      await fkRunner.release();
    }
    logger.log('');

    // 5. Run seeder
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
