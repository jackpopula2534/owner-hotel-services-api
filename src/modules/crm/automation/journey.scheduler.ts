import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JourneyService } from './journey.service';

/**
 * Polls JourneyService.processDueEnrollments() every minute.
 * Lightweight — most ticks find nothing to do.
 */
@Injectable()
export class JourneyScheduler {
  private readonly logger = new Logger(JourneyScheduler.name);

  constructor(private readonly journeys: JourneyService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    const processed = await this.journeys.processDueEnrollments();
    if (processed > 0) {
      this.logger.log(`Advanced ${processed} journey enrollment(s)`);
    }
  }
}
