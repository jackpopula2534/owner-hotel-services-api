import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeederService } from './seeder.service';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PrismaService } from '../prisma/prisma.service';
import { execSync } from 'child_process';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seeder = app.get(SeederService);
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const prisma = app.get(PrismaService);

  try {
    console.log('🔄 Starting database refresh and seed...');
    console.log('');

    // 1. Drop all tables (ระวัง! ลบข้อมูลทั้งหมด)
    console.log('🗑️  Dropping all tables...');
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
        [database]
      );

      // ลบ tables ทั้งหมด
      for (const row of result) {
        const tableName = row.TABLE_NAME;
        try {
          await queryRunner.query(`DROP TABLE IF EXISTS \`${tableName}\``);
          console.log(`  ✓ Dropped table: ${tableName}`);
        } catch (error) {
          console.warn(`  ⚠️  Could not drop table ${tableName}:`, error.message);
        }
      }

      // เปิดการตรวจสอบ foreign key กลับมา
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');

      console.log('  ✓ All user tables dropped');
    } catch (error) {
      console.error('Error during table drop:', error.message);
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
    console.log('');

    // 2. Run Prisma migrations (สร้าง Prisma tables เช่น users, guests, etc.)
    console.log('🔨 Running Prisma migrations...');
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      console.log('  ✓ Prisma migrations completed');

      // Generate Prisma Client to ensure it's up to date
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('  ✓ Prisma client generated');

      // Reconnect Prisma to pick up new schema
      await prisma.$connect();
      console.log('  ✓ Prisma client reconnected');
    } catch (error) {
      console.error('  ⚠️  Prisma setup failed:', error.message);
      // Continue anyway - tables might already exist
    }
    console.log('');

    // 3. Synchronize TypeORM database (สร้าง TypeORM tables เช่น subscriptions, plans, etc.)
    // ⚠️ ใช้ synchronize(false) เพื่อไม่ให้ drop Prisma tables ที่เพิ่งสร้าง
    console.log('🔨 Creating TypeORM tables...');
    try {
      await dataSource.synchronize(false);
      console.log('  ✓ All TypeORM tables created');
    } catch (error) {
      // Ignore metadata table errors (ไม่กระทบการทำงาน)
      if (error.message && error.message.includes('typeorm_metadata')) {
        console.log('  ✓ All TypeORM tables created (metadata table warning ignored)');
      } else {
        throw error;
      }
    }
    console.log('');

    // 4. Run seeder
    console.log('🌱 Seeding data...');
    await seeder.seed();
    console.log('');

    console.log('✅ Database refresh and seed completed successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log('  - Database: Refreshed');
    console.log('  - Prisma Tables: Created (users, guests, bookings, etc.)');
    console.log('  - TypeORM Tables: Created (subscriptions, plans, etc.)');
    console.log('  - Data: Seeded (including 5 test users)');
    console.log('');

    await app.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();

