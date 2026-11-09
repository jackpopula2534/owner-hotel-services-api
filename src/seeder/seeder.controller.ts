import { Controller, Post, UseGuards } from '@nestjs/common';
import { SeederService } from './seeder.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('seeder')
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class SeederController {
  constructor(private readonly seederService: SeederService) {}

  /**
   * รัน seeder ทั้งหมด
   * POST /seeder/run
   */
  @Post('run')
  async runSeeder() {
    await this.seederService.seed();
    return {
      message: 'Seeder completed successfully',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * รัน seeder เฉพาะ HR Master Data (แผนก, ตำแหน่ง, ประเภทการลา, กะ, เบี้ยเลี้ยง, การหัก)
   * POST /seeder/run-hr-master
   */
  @Post('run-hr-master')
  async runHrMasterSeeder() {
    await this.seederService.seedHrMasterData();
    return {
      message: 'HR Master Data seeded successfully',
      timestamp: new Date().toISOString(),
    };
  }
}
