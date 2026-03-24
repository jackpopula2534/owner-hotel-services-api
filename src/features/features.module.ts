import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesService } from './features.service';
import { FeaturesController } from './features.controller';
import { Feature } from './entities/feature.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Feature]),
    PrismaModule,
  ],
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [
    TypeOrmModule, // exports Repository<Feature>
    FeaturesService,
  ],
})
export class FeaturesModule {}
