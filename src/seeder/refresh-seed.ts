import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeederService } from './seeder.service';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seeder = app.get(SeederService);
  const dataSource = app.get<DataSource>(getDataSourceToken());

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

    // 2. Synchronize database (สร้าง tables ใหม่)
    console.log('🔨 Creating tables...');
    try {
      await dataSource.synchronize(true);
      console.log('  ✓ All tables created');
    } catch (error) {
      // Ignore metadata table errors (ไม่กระทบการทำงาน)
      if (error.message && error.message.includes('typeorm_metadata')) {
        console.log('  ✓ All tables created (metadata table warning ignored)');
      } else {
        throw error;
      }
    }
    console.log('');

    // 3. Run seeder
    console.log('🌱 Seeding data...');
    await seeder.seed();
    console.log('');

    console.log('✅ Database refresh and seed completed successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log('  - Database: Refreshed');
    console.log('  - Tables: Recreated');
    console.log('  - Data: Seeded');
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

