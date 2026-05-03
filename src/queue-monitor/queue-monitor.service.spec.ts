import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { QueueMonitorService } from './queue-monitor.service';

describe('QueueMonitorService', () => {
  let service: QueueMonitorService;
  let mockEmailQueue: any;
  let mockInventoryQueue: any;

  beforeEach(async () => {
    mockEmailQueue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 100,
        failed: 2,
        delayed: 0,
        paused: 0,
      }),
      getWorkers: jest.fn().mockResolvedValue([{ id: 'w1' }]),
      getFailed: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          name: 'send',
          failedReason: 'SMTP timeout',
          attemptsMade: 3,
          data: { to: 'a@b.com' },
          timestamp: 1714000000000,
        },
      ]),
      getJob: jest.fn(),
    };
    mockInventoryQueue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 50,
        failed: 0,
        delayed: 0,
        paused: 0,
      }),
      getWorkers: jest.fn().mockResolvedValue([]),
      getFailed: jest.fn().mockResolvedValue([]),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueMonitorService,
        { provide: getQueueToken('email'), useValue: mockEmailQueue },
        { provide: getQueueToken('inventory'), useValue: mockInventoryQueue },
      ],
    }).compile();

    service = module.get(QueueMonitorService);
  });

  afterEach(() => jest.clearAllMocks());

  it('listQueues returns registered queue names', () => {
    expect(service.listQueues()).toEqual(['email', 'inventory']);
  });

  it('getStats aggregates counts and worker count for each queue', async () => {
    const stats = await service.getStats();
    expect(stats).toHaveLength(2);
    const email = stats.find((s) => s.name === 'email');
    expect(email?.counts.waiting).toBe(1);
    expect(email?.counts.failed).toBe(2);
    expect(email?.workers).toBe(1);
  });

  it('listFailed maps job objects', async () => {
    const failed = await service.listFailed('email');
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('job-1');
    expect(failed[0].failedReason).toBe('SMTP timeout');
  });

  it('listFailed throws NotFound for unknown queue', async () => {
    await expect(service.listFailed('nope')).rejects.toThrow(NotFoundException);
  });

  it('retryFailed calls Job.retry()', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    mockEmailQueue.getJob.mockResolvedValue({ retry });
    await service.retryFailed('email', 'job-1');
    expect(retry).toHaveBeenCalled();
  });

  it('retryFailed throws NotFound when job missing', async () => {
    mockEmailQueue.getJob.mockResolvedValue(null);
    await expect(service.retryFailed('email', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('removeFailed calls Job.remove()', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    mockEmailQueue.getJob.mockResolvedValue({ remove });
    await service.removeFailed('email', 'job-1');
    expect(remove).toHaveBeenCalled();
  });

  it('handles queue errors gracefully in stats', async () => {
    mockEmailQueue.getJobCounts.mockRejectedValue(new Error('Redis down'));
    const stats = await service.getStats();
    const email = stats.find((s) => s.name === 'email');
    expect(email?.counts).toEqual({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    });
    expect(email?.workers).toBe(0);
  });
});
