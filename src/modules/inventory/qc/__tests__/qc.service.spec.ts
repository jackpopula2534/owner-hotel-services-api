import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QCService } from '../qc.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateQCTemplateDto } from '../dto/qc.dto';

describe('QCService.createTemplate', () => {
  let service: QCService;
  let prisma: jest.Mocked<any>;

  beforeEach(async () => {
    prisma = {
      itemCategory: { findFirst: jest.fn() },
      inventoryItem: { findFirst: jest.fn() },
      qCTemplate: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [QCService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<QCService>(QCService);
  });

  const baseDto: CreateQCTemplateDto = {
    name: 'QC วัตถุดิบเนื้อสัตว์',
    appliesTo: 'CATEGORY',
    categoryId: '11111111-1111-1111-1111-111111111111',
    checklistItems: [
      { label: 'สี/กลิ่นปกติ', type: 'BOOLEAN', required: true, orderIndex: 0 },
      {
        label: 'อุณหภูมิ',
        type: 'NUMERIC',
        required: true,
        orderIndex: 1,
        passCondition: { op: 'lte', value: 4 },
      },
    ],
  };

  it('throws BadRequest when CATEGORY scope is missing categoryId', async () => {
    await expect(
      service.createTemplate('tenant-1', { ...baseDto, categoryId: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when ITEM scope is missing itemId', async () => {
    await expect(
      service.createTemplate('tenant-1', {
        name: 'x',
        appliesTo: 'ITEM',
      } as CreateQCTemplateDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when categoryId does not belong to tenant', async () => {
    prisma.itemCategory.findFirst.mockResolvedValue(null);
    await expect(service.createTemplate('tenant-1', baseDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates template with normalized checklist payload', async () => {
    prisma.itemCategory.findFirst.mockResolvedValue({ id: baseDto.categoryId });
    prisma.qCTemplate.create.mockResolvedValue({
      id: 'tmpl-1',
      name: baseDto.name,
      checklistItems: [],
    });

    await service.createTemplate('tenant-1', baseDto);

    expect(prisma.qCTemplate.create).toHaveBeenCalledTimes(1);
    const callArg = prisma.qCTemplate.create.mock.calls[0][0];

    expect(callArg.data.tenantId).toBe('tenant-1');
    expect(callArg.data.appliesTo).toBe('CATEGORY');
    expect(callArg.data.categoryId).toBe(baseDto.categoryId);
    expect(callArg.data.itemId).toBeNull();
    expect(callArg.data.checklistItems.create).toHaveLength(2);

    const numericItem = callArg.data.checklistItems.create[1];
    expect(numericItem.label).toBe('อุณหภูมิ');
    expect(numericItem.type).toBe('NUMERIC');
    expect(numericItem.passCondition).toEqual({ op: 'lte', value: 4 });
    expect(numericItem.orderIndex).toBe(1);
  });

  it('falls back to sequential orderIndex when client omits it', async () => {
    prisma.itemCategory.findFirst.mockResolvedValue({ id: baseDto.categoryId });
    prisma.qCTemplate.create.mockResolvedValue({ id: 'tmpl-2', checklistItems: [] });

    await service.createTemplate('tenant-1', {
      ...baseDto,
      checklistItems: [
        { label: 'a', type: 'BOOLEAN', required: true } as never,
        { label: 'b', type: 'TEXT', required: false } as never,
      ],
    });

    const callArg = prisma.qCTemplate.create.mock.calls[0][0];
    const items = callArg.data.checklistItems.create;
    expect(items[0].orderIndex).toBe(0);
    expect(items[1].orderIndex).toBe(1);
    // required=false from the client must be preserved.
    expect(items[1].required).toBe(false);
  });
});
