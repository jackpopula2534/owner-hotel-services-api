import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SeederService } from './seeder.service';

const logger = new Logger('Seeder');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seeder = app.get(SeederService);

  try {
    await seeder.seed();
    logger.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed: ' + ((error as Error).message || String(error)));
    process.exit(1);
  }
}

bootstrap();
