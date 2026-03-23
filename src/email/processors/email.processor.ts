import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { EmailService, EmailJobData } from '../email.service';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {}

  @Process('send')
  async handleSend(job: Job<EmailJobData>) {
    this.logger.debug(`Processing email job ${job.id} to ${job.data.to}`);
    await this.emailService.processEmail(job.data);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Email job ${job.id} completed successfully`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Email job ${job.id} failed: ${error.message}`);
  }
}
