import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JourneyService } from './journey.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../../email/email.service';

describe('JourneyService', () => {
  let service: JourneyService;

  const mockPrisma = {
    crmJourney: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    crmJourneyEnrollment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmContact: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    guest: {
      findFirst: jest.fn(),
    },
  };

  const mockEmail = { sendEmail: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();
    service = module.get(JourneyService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects journey with zero steps', async () => {
      await expect(
        service.create({ name: 'x', triggerEvent: 'booking.created', steps: [] }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects send step without channel', async () => {
      await expect(
        service.create(
          {
            name: 'x',
            triggerEvent: 'booking.created',
            steps: [{ type: 'send' }],
          },
          't1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects wait step with non-positive delayHours', async () => {
      await expect(
        service.create(
          {
            name: 'x',
            triggerEvent: 'booking.created',
            steps: [{ type: 'wait', delayHours: 0 }],
          },
          't1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores steps as JSON string', async () => {
      mockPrisma.crmJourney.create.mockImplementation(async ({ data }) => ({ id: 'j1', ...data }));
      const r = await service.create(
        {
          name: 'pre-stay',
          triggerEvent: 'booking.created',
          steps: [
            { type: 'wait', delayHours: 24 },
            { type: 'send', channel: 'email', templateKey: 'welcome' },
          ],
        },
        't1',
      );
      expect(typeof r.stepsConfig).toBe('string');
      expect(JSON.parse(r.stepsConfig as string)).toHaveLength(2);
    });
  });

  describe('enrollByTrigger', () => {
    it('returns 0 when no active matching journeys', async () => {
      mockPrisma.crmJourney.findMany.mockResolvedValue([]);
      const n = await service.enrollByTrigger('booking.created', 't1', 'g1');
      expect(n).toBe(0);
    });

    it('enrolls in matching journeys (idempotent on duplicate)', async () => {
      mockPrisma.crmJourney.findMany.mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
      mockPrisma.crmJourneyEnrollment.findFirst
        .mockResolvedValueOnce(null) // j1 not enrolled
        .mockResolvedValueOnce({ id: 'existing' }); // j2 already enrolled
      mockPrisma.crmJourneyEnrollment.create.mockResolvedValue({ id: 'e1' });

      const n = await service.enrollByTrigger('booking.created', 't1', 'g1', {
        bookingId: 'b1',
      });
      expect(n).toBe(1);
      expect(mockPrisma.crmJourneyEnrollment.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('processDueEnrollments', () => {
    it('advances a single step then sets next run', async () => {
      mockPrisma.crmJourneyEnrollment.findMany.mockResolvedValue([
        { id: 'e1', tenantId: 't1', guestId: 'g1', currentStepIdx: 0, status: 'active' },
      ]);
      mockPrisma.crmJourneyEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        tenantId: 't1',
        guestId: 'g1',
        journeyId: 'j1',
        currentStepIdx: 0,
        status: 'active',
      });
      mockPrisma.crmJourney.findUnique.mockResolvedValue({
        id: 'j1',
        stepsConfig: JSON.stringify([
          { type: 'tag', segment: 'engaged' },
          { type: 'wait', delayHours: 24 },
        ]),
      });
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'c1' });

      const n = await service.processDueEnrollments();
      expect(n).toBe(1);
      // Tag step executed
      expect(mockPrisma.crmContact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { segment: 'engaged' },
      });
      // Enrollment moved to step 1 with future nextRunAt
      const updateCall = mockPrisma.crmJourneyEnrollment.update.mock.calls[0][0];
      expect(updateCall.data.currentStepIdx).toBe(1);
      expect(updateCall.data.status).toBe('active');
    });

    it('marks enrollment completed when all steps done', async () => {
      mockPrisma.crmJourneyEnrollment.findMany.mockResolvedValue([
        { id: 'e1', tenantId: 't1', guestId: 'g1', currentStepIdx: 0, status: 'active' },
      ]);
      mockPrisma.crmJourneyEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        tenantId: 't1',
        guestId: 'g1',
        journeyId: 'j1',
        currentStepIdx: 0,
        status: 'active',
      });
      mockPrisma.crmJourney.findUnique.mockResolvedValue({
        id: 'j1',
        stepsConfig: JSON.stringify([{ type: 'tag', segment: 'done' }]),
      });
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'c1' });

      await service.processDueEnrollments();
      const updateCall = mockPrisma.crmJourneyEnrollment.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('completed');
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    });

    it('marks enrollment failed when advancement throws', async () => {
      mockPrisma.crmJourneyEnrollment.findMany.mockResolvedValue([
        { id: 'e1', tenantId: 't1', guestId: 'g1' },
      ]);
      mockPrisma.crmJourneyEnrollment.findUnique.mockRejectedValue(new Error('db'));
      await service.processDueEnrollments();
      expect(mockPrisma.crmJourneyEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.crmJourney.findFirst.mockResolvedValue(null);
      await expect(service.findOne('j1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
