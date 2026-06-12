import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    hrEmployeeDocumentRequirement: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

describe('HrLifecycleAssignmentService', () => {
  let service: HrLifecycleAssignmentService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        HrLifecycleAssignmentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(HrLifecycleAssignmentService);
  });

  describe('verifyRequirement', () => {
    it('marks an uploaded requirement as verified', async () => {
      prisma.hrEmployeeDocumentRequirement.findFirst.mockResolvedValue({ id: 'r1', uploadedDocumentId: 'doc1' });
      prisma.hrEmployeeDocumentRequirement.update.mockResolvedValue({ id: 'r1', status: 'verified' });
      const res = await service.verifyRequirement('r1', 't1', 'u1');
      expect(prisma.hrEmployeeDocumentRequirement.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'verified', verifiedBy: 'u1' }) }),
      );
      expect(res.status).toBe('verified');
    });

    it('throws when requirement is not found', async () => {
      prisma.hrEmployeeDocumentRequirement.findFirst.mockResolvedValue(null);
      await expect(service.verifyRequirement('rX', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when no document uploaded yet', async () => {
      prisma.hrEmployeeDocumentRequirement.findFirst.mockResolvedValue({ id: 'r1', uploadedDocumentId: null });
      await expect(service.verifyRequirement('r1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('waiveRequirement', () => {
    it('sets status to waived with reason', async () => {
      prisma.hrEmployeeDocumentRequirement.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.hrEmployeeDocumentRequirement.update.mockResolvedValue({ id: 'r1', status: 'waived' });
      await service.waiveRequirement('r1', 't1', 'ไม่จำเป็น');
      expect(prisma.hrEmployeeDocumentRequirement.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'waived', waivedReason: 'ไม่จำเป็น' }) }),
      );
    });
  });

  describe('bulkVerifyRequirements', () => {
    it('throws on empty id list', async () => {
      await expect(service.bulkVerifyRequirements([], 't1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('verifies only requirements that have an uploaded document', async () => {
      prisma.hrEmployeeDocumentRequirement.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
      prisma.hrEmployeeDocumentRequirement.updateMany.mockResolvedValue({ count: 2 });
      const res = await service.bulkVerifyRequirements(['r1', 'r2', 'r3'], 't1', 'u1');
      expect(res).toEqual({ requested: 3, verified: 2, skipped: 1 });
      expect(prisma.hrEmployeeDocumentRequirement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['r1', 'r2'] } }, data: expect.objectContaining({ status: 'verified' }) }),
      );
    });

    it('does not call updateMany when nothing is verifiable', async () => {
      prisma.hrEmployeeDocumentRequirement.findMany.mockResolvedValue([]);
      const res = await service.bulkVerifyRequirements(['r1'], 't1');
      expect(res).toEqual({ requested: 1, verified: 0, skipped: 1 });
      expect(prisma.hrEmployeeDocumentRequirement.updateMany).not.toHaveBeenCalled();
    });
  });
});
