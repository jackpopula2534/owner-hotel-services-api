import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CampSuppliersSeeder } from './camp-suppliers.seeder';

/**
 * เติมซัพพลายเออร์ให้ลาน premium.camp@email.com (รันซ้ำได้)
 *   npm run seed:camp-suppliers
 *   npm run seed:camp-suppliers -- other@email.com
 */
async function bootstrap() {
  const logger = new Logger('CampSuppliers');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const email = process.argv[2];
    const result = await app.get(CampSuppliersSeeder).seed(email || undefined);
    logger.log(result ? 'Done' : 'Nothing seeded');
    await app.close();
    process.exit(result ? 0 : 1);
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }
}

bootstrap();
