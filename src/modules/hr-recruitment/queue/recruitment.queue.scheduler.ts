import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { RECRUITMENT_QUEUE, RECRUITMENT_JOBS } from './recruitment.queue.processor';

/**
 * Registers repeatable cron jobs for the recruitment → probation pipeline (design §4.2).
 *
 * Interview reminders run on a frequent scan that fires for both the 24h and the
 * 1h lead windows; the daily jobs run at fixed times each morning.
 */
@Injectable()
export class RecruitmentQueueScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecruitmentQueueScheduler.name);

  constructor(@InjectQueue(RECRUITMENT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      const repeatable = await this.queue.getRepeatableJobs();
      for (const job of repeatable) {
        await this.queue.removeRepeatableByKey(job.key);
      }

      // Every 15 min — interview reminders for the 24h lead window
      await this.queue.add(
        RECRUITMENT_JOBS.INTERVIEW_REMINDER,
        { windowMinutes: 24 * 60 },
        { repeat: { cron: '*/15 * * * *' }, removeOnComplete: 50, jobId: 'interview-reminder-24h' },
      );
      // Every 15 min — interview reminders for the 1h lead window
      await this.queue.add(
        RECRUITMENT_JOBS.INTERVIEW_REMINDER,
        { windowMinutes: 60 },
        { repeat: { cron: '*/15 * * * *' }, removeOnComplete: 50, jobId: 'interview-reminder-1h' },
      );

      // Daily 07:00 — start-date reminder (3 days ahead)
      await this.queue.add(
        RECRUITMENT_JOBS.START_DATE_REMINDER,
        { daysBefore: 3 },
        { repeat: { cron: '0 7 * * *' }, removeOnComplete: 50 },
      );

      // Daily 08:00 — probation checkpoints due within 7 days
      await this.queue.add(
        RECRUITMENT_JOBS.PROBATION_CHECKPOINT_DUE,
        { daysAhead: 7 },
        { repeat: { cron: '0 8 * * *' }, removeOnComplete: 50 },
      );

      // Daily 08:05 — probation rounds past due but not decided
      await this.queue.add(
        RECRUITMENT_JOBS.PROBATION_DUE,
        {},
        { repeat: { cron: '5 8 * * *' }, removeOnComplete: 50 },
      );

      // Daily 09:00 — nudge approvers idle > 2 days
      await this.queue.add(
        RECRUITMENT_JOBS.APPROVAL_PENDING_NUDGE,
        { staleDays: 2 },
        { repeat: { cron: '0 9 * * *' }, removeOnComplete: 50 },
      );

      this.logger.log('Recruitment scheduled jobs registered');
    } catch (e) {
      this.logger.warn(`Could not register recruitment jobs (Redis may be down): ${e instanceof Error ? e.message : e}`);
    }
  }
}
