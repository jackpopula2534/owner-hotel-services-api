import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { Hotel3dDemoSeeder } from './hotel-3d-demo.seeder';

/**
 * รีเฟรชข้อมูลเดโม Monitor ห้องพัก 3D ให้เป็น "วันนี้" — รันซ้ำได้ทุกวัน
 *   npm run seed:hotel-3d
 */
async function bootstrap() {
  const logger = new Logger('Hotel3dDemo');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    await app.get(Hotel3dDemoSeeder).seed();
    logger.log('Done');
    await app.close();
    process.exit(0);
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }
}

bootstrap();
