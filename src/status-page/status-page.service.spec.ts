import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StatusPageService } from './status-page.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StatusPageService', () => {
  let service: StatusPageService;
  let mockComponentsFindMany: jest.Mock;
  let mockComponentsFindUnique: jest.Mock;
  let mockComponentsUpdate: jest.Mock;
  let mockComponentsUpsert: jest.Mock;
  let mockIncidentsFindMany: jest.Mock;
  let mockIncidentsFindUnique: jest.Mock;
  let mockTransaction: jest.Mock;

  beforeEach(async () => {
    mockComponentsFindMany = jest.fn();
    mockComponentsFindUnique = jest.fn();
    mockComponentsUpdate = jest.fn().mockResolvedValue({});
    mockComponentsUpsert = jest.fn().mockResolvedValue({});
    mockIncidentsFindMany = jest.fn().mockResolvedValue([]);
    mockIncidentsFindUnique = jest.fn();
    mockTransaction = jest.fn().mockImplementation(async (fn: any) => {
      const tx = {
        incidents: {
          create: jest.fn().mockResolvedValue({ id: 'inc-1' }),
          update: jest.fn().mockResolvedValue({}),
        },
        incident_updates: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusPageService,
        {
          provide: PrismaService,
          useValue: {
            service_components: {
              findMany: mockComponentsFindMany,
              findUnique: mockComponentsFindUnique,
              update: mockComponentsUpdate,
              upsert: mockComponentsUpsert,
            },
            incidents: {
              findMany: mockIncidentsFindMany,
              findUnique: mockIncidentsFindUnique,
            },
            $transaction: mockTransaction,
          },
        },
      ],
    }).compile();

    service = module.get(StatusPageService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getPublicStatus', () => {
    it('returns operational when all components are operational', async () => {
      mockComponentsFindMany.mockResolvedValue([
        { code: 'api', name: 'API', status: 'operational' },
        { code: 'web', name: 'Web', status: 'operational' },
      ]);
      mockIncidentsFindMany.mockResolvedValue([]); // active first call
      mockIncidentsFindMany.mockResolvedValue([]); // recent second call

      const r = await service.getPublicStatus();
      expect(r.overallStatus).toBe('operational');
      expect(r.components).toHaveLength(2);
      expect(r.activeIncidents).toEqual([]);
    });

    it('elevates overall to major_outage when any component is down', async () => {
      mockComponentsFindMany.mockResolvedValue([
        { code: 'api', name: 'API', status: 'operational' },
        { code: 'db', name: 'DB', status: 'major_outage' },
      ]);
      const r = await service.getPublicStatus();
      expect(r.overallStatus).toBe('major_outage');
    });

    it('elevates overall to degraded when one component is degraded', async () => {
      mockComponentsFindMany.mockResolvedValue([
        { code: 'api', name: 'API', status: 'operational' },
        { code: 'web', name: 'Web', status: 'degraded' },
      ]);
      const r = await service.getPublicStatus();
      expect(r.overallStatus).toBe('degraded');
    });

    it('renders active incidents with their updates', async () => {
      mockComponentsFindMany.mockResolvedValue([]);
      mockIncidentsFindMany
        .mockResolvedValueOnce([
          {
            id: 'inc-1',
            title: 'Login slow',
            severity: 'minor',
            status: 'investigating',
            started_at: new Date('2026-05-01T10:00:00Z'),
            updates: [
              {
                status: 'investigating',
                message: 'looking into it',
                created_at: new Date('2026-05-01T10:05:00Z'),
              },
            ],
          },
        ])
        .mockResolvedValueOnce([]);

      const r = await service.getPublicStatus();
      expect(r.activeIncidents).toHaveLength(1);
      expect(r.activeIncidents[0].title).toBe('Login slow');
      expect(r.activeIncidents[0].updates).toHaveLength(1);
    });
  });

  describe('updateComponentStatus', () => {
    it('updates the component', async () => {
      mockComponentsFindUnique.mockResolvedValue({ code: 'api' });
      await service.updateComponentStatus('api', 'degraded');
      expect(mockComponentsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: 'api' },
          data: expect.objectContaining({ status: 'degraded' }),
        }),
      );
    });

    it('throws NotFound for unknown component', async () => {
      mockComponentsFindUnique.mockResolvedValue(null);
      await expect(
        service.updateComponentStatus('nope', 'degraded'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createIncident', () => {
    it('creates incident + initial update in a transaction', async () => {
      const r = await service.createIncident({
        title: 'API down',
        severity: 'major',
        affectedComponents: ['api'],
        initialUpdate: 'Investigating',
        createdBy: 'admin-1',
      });
      expect(r.id).toBe('inc-1');
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('addIncidentUpdate', () => {
    it('updates incident status and appends update', async () => {
      mockIncidentsFindUnique.mockResolvedValue({ id: 'inc-1' });
      await service.addIncidentUpdate({
        incidentId: 'inc-1',
        status: 'monitoring',
        message: 'Recovered',
      });
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('throws NotFound for unknown incident', async () => {
      mockIncidentsFindUnique.mockResolvedValue(null);
      await expect(
        service.addIncidentUpdate({
          incidentId: 'missing',
          status: 'monitoring',
          message: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
