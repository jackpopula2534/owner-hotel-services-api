import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

export interface QueueStats {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  workers: number;
}

export interface FailedJobView {
  id: string;
  name: string;
  failedReason?: string;
  attemptsMade: number;
  data?: unknown;
  timestamp: number;
}

/**
 * Lightweight Bull queue dashboard. We expose:
 *   - GET counts per queue (waiting / active / failed / etc.)
 *   - GET failed-job list for a queue (paginated)
 *   - POST retry / remove for a single failed job
 *
 * Avoids the @bull-board dependency so we don't need to mount a separate
 * Express router. Frontend renders the data with our own table.
 */
@Injectable()
export class QueueMonitorService {
  private readonly logger = new Logger(QueueMonitorService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('inventory') private readonly inventoryQueue: Queue,
  ) {
    this.queues.set('email', this.emailQueue);
    this.queues.set('inventory', this.inventoryQueue);
  }

  listQueues(): string[] {
    return Array.from(this.queues.keys());
  }

  async getStats(): Promise<QueueStats[]> {
    const out: QueueStats[] = [];
    for (const [name, queue] of this.queues) {
      try {
        const counts = (await queue.getJobCounts()) as unknown as Record<string, number>;
        const workers = await queue.getWorkers();
        out.push({
          name,
          counts: {
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            delayed: counts.delayed || 0,
            paused: counts.paused || 0,
          },
          workers: workers.length,
        });
      } catch (err) {
        this.logger.warn(`Queue ${name} unavailable: ${err instanceof Error ? err.message : err}`);
        out.push({
          name,
          counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
          workers: 0,
        });
      }
    }
    return out;
  }

  async listFailed(name: string, limit = 50): Promise<FailedJobView[]> {
    const queue = this.requireQueue(name);
    const jobs = await queue.getFailed(0, limit - 1);
    return jobs.map((j) => ({
      id: String(j.id),
      name: j.name,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      data: j.data,
      timestamp: j.timestamp,
    }));
  }

  async retryFailed(name: string, jobId: string): Promise<void> {
    const queue = this.requireQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');
    await job.retry();
  }

  async removeFailed(name: string, jobId: string): Promise<void> {
    const queue = this.requireQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');
    await job.remove();
  }

  private requireQueue(name: string): Queue {
    const q = this.queues.get(name);
    if (!q) throw new NotFoundException(`Unknown queue ${name}`);
    return q;
  }
}
