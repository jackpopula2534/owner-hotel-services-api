import { Controller, Post } from '@nestjs/common';
import { SeederService } from './seeder.service';

@Controller('seeder')
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


