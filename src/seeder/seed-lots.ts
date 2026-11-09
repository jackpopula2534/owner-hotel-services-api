import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SeedLotsSeeder } from './seed-lots.seeder';

/**
 * เติม lot ให้ของในคลังที่ยังไม่มี lot (ยอด lot รวม = ยอดคงเหลือ) — รันซ้ำได้
 *   npm run seed:lots              ทุก tenant
 *   npm run seed:lots -- <tenantId> เฉพาะ tenant เดียว
 */
async function bootstrap() {
  const logger = new Logger('SeedLots');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const tenantId = process.argv[2];
    const result = await app.get(SeedLotsSeeder).seed(tenantId || undefined);
    logger.log(
      `Done — created ${result.created}, trimmed ${result.reduced}, lot-tracked ${result.tracked}`,
    );
    await app.close();
    process.exit(0);
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }
}

bootstrap();
