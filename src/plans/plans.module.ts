import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { Plan } from './entities/plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Plan]), PrismaModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [
    TypeOrmModule, // exports Repository<Plan>
    PlansService,
  ],
})
export class PlansModule {}
