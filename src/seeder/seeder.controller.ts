import { Controller, Post } from '@nestjs/common';
import { SeederService } from './seeder.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';

@Controller('seeder')
@SkipSubscriptionCheck()
export class SeederController {
  constructor(private readonly seederService: SeederService) {}

  /**
   * รัน seeder
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
}
