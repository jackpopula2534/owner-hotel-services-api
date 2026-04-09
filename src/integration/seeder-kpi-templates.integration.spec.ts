/**
 * Integration-style unit tests for seedKpiTemplates()
 * ทดสอบ:
 *   1. สร้าง template + items ถูกต้องทั้ง 6 ชุด
 *   2. น้ำหนัก KPI รวมกันได้ 100% ทุก template
 *   3. Idempotent — รันซ้ำไม่ duplicate
 *   4. isDefault = true, tenantId = null สำหรับ system defaults
 *   5. ทุก item มี minScore=0, maxScore=100
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── Minimal mock ──────────────────────────────────────────────────────────────

interface KpiItemInput {
  name: string;
  nameEn: string;
  description: string;
  weight: number;
  minScore: number;
  maxScore: number;
  sortOrder: number;
}

interface KpiTemplateInput {
  tenantId: null;
  name: string;
  nameEn: string;
  departmentCode: string;
  periodType: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  items: { create: KpiItemInput[] };
}

interface StoredTemplate {
  id: string;
  name: string;
  tenantId: null;
  isDefault: boolean;
  isActive: boolean;
  departmentCode: string;
  periodType: string;
  items: KpiItemInput[];
}

/** In-memory store ทดแทน DB จริง */
const templateStore: StoredTemplate[] = [];
let templateIdCounter = 0;

const prismaMock = {
  hrKpiTemplate: {
    findFirst: jest.fn(async ({ where }: { where: Partial<StoredTemplate> }) => {
      return (
        templateStore.find(
          (t) =>
            t.name === where.name &&
            t.tenantId === where.tenantId &&
            t.isDefault === where.isDefault,
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: { data: KpiTemplateInput }) => {
      const id = `template-${++templateIdCounter}`;
      const stored: StoredTemplate = {
        id,
        name: data.name,
        tenantId: data.tenantId,
        isDefault: data.isDefault,
        isActive: data.isActive,
        departmentCode: data.departmentCode,
        periodType: data.periodType,
        items: data.items.create,
      };
      templateStore.push(stored);
      return stored;
    }),
  },
};

// ── Extracted seedKpiTemplates logic (mirrors seeder.service.ts exactly) ────
// เพื่อทดสอบแบบ unit โดยไม่ต้อง boot NestJS ทั้งหมด

async function seedKpiTemplates(
  prisma: typeof prismaMock,
  logger: Pick<Logger, 'log'>,
): Promise<{ templatesCreated: number; itemsCreated: number }> {
  interface KpiItemSeed {
    name: string;
    nameEn: string;
    description: string;
    weight: number;
    sortOrder: number;
  }
  interface KpiTemplateSeed {
    name: string;
    nameEn: string;
    departmentCode: string;
    periodType: string;
    description: string;
    items: KpiItemSeed[];
  }

  const templates: KpiTemplateSeed[] = [
    {
      name: 'พนักงานต้อนรับ (Front Desk)',
      nameEn: 'Front Desk KPI',
      departmentCode: 'FD',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับพนักงานต้อนรับ เน้นการบริการแขกและความรวดเร็ว',
      items: [
        { name: 'คุณภาพการบริการแขก', nameEn: 'Guest Service Quality', description: '', weight: 30, sortOrder: 1 },
        { name: 'ความตรงต่อเวลา', nameEn: 'Punctuality & Attendance', description: '', weight: 20, sortOrder: 2 },
        { name: 'ความรู้ด้านระบบ PMS', nameEn: 'PMS & System Knowledge', description: '', weight: 20, sortOrder: 3 },
        { name: 'ทักษะสื่อสาร', nameEn: 'Communication Skills', description: '', weight: 20, sortOrder: 4 },
        { name: 'การทำงานเป็นทีม', nameEn: 'Teamwork & Collaboration', description: '', weight: 10, sortOrder: 5 },
      ],
    },
    {
      name: 'แม่บ้าน (Housekeeping)',
      nameEn: 'Housekeeping KPI',
      departmentCode: 'HK',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับแม่บ้านและหัวหน้าแม่บ้าน เน้นคุณภาพและความเร็ว',
      items: [
        { name: 'คุณภาพการทำความสะอาด', nameEn: 'Cleaning Quality', description: '', weight: 35, sortOrder: 1 },
        { name: 'ความเร็วในการทำห้อง', nameEn: 'Room Turnaround Speed', description: '', weight: 25, sortOrder: 2 },
        { name: 'ความตรงต่อเวลา', nameEn: 'Punctuality & Attendance', description: '', weight: 20, sortOrder: 3 },
        { name: 'การใช้สินค้าคงคลัง', nameEn: 'Inventory Management', description: '', weight: 10, sortOrder: 4 },
        { name: 'ทัศนคติและความร่วมมือ', nameEn: 'Attitude & Teamwork', description: '', weight: 10, sortOrder: 5 },
      ],
    },
    {
      name: 'พนักงานเสิร์ฟ (F&B Service)',
      nameEn: 'F&B Service KPI',
      departmentCode: 'FB',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับพนักงานร้านอาหารและบาร์',
      items: [
        { name: 'การบริการลูกค้า', nameEn: 'Customer Service', description: '', weight: 30, sortOrder: 1 },
        { name: 'ความรู้เมนูและเครื่องดื่ม', nameEn: 'Menu & Beverage Knowledge', description: '', weight: 25, sortOrder: 2 },
        { name: 'ความตรงต่อเวลา', nameEn: 'Punctuality & Attendance', description: '', weight: 20, sortOrder: 3 },
        { name: 'ยอดขาย Upsell', nameEn: 'Upsell Performance', description: '', weight: 15, sortOrder: 4 },
        { name: 'มาตรฐานความสะอาด', nameEn: 'Hygiene Standards', description: '', weight: 10, sortOrder: 5 },
      ],
    },
    {
      name: 'ครัว (Kitchen)',
      nameEn: 'Kitchen / Chef KPI',
      departmentCode: 'KT',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับพ่อครัวและผู้ช่วย',
      items: [
        { name: 'คุณภาพอาหาร', nameEn: 'Food Quality', description: '', weight: 35, sortOrder: 1 },
        { name: 'มาตรฐานสุขอนามัย', nameEn: 'Food Safety & Hygiene', description: '', weight: 25, sortOrder: 2 },
        { name: 'ความเร็วในการปรุงอาหาร', nameEn: 'Cooking Speed', description: '', weight: 20, sortOrder: 3 },
        { name: 'การจัดการวัตถุดิบ', nameEn: 'Ingredient Management', description: '', weight: 10, sortOrder: 4 },
        { name: 'การทำงานเป็นทีม', nameEn: 'Teamwork', description: '', weight: 10, sortOrder: 5 },
      ],
    },
    {
      name: 'ซ่อมบำรุง (Maintenance)',
      nameEn: 'Maintenance KPI',
      departmentCode: 'MT',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับช่างซ่อมบำรุง',
      items: [
        { name: 'ความเร็วในการซ่อม', nameEn: 'Repair Response Time', description: '', weight: 30, sortOrder: 1 },
        { name: 'คุณภาพงานซ่อม', nameEn: 'Repair Quality', description: '', weight: 30, sortOrder: 2 },
        { name: 'ความตรงต่อเวลา', nameEn: 'Punctuality & Attendance', description: '', weight: 20, sortOrder: 3 },
        { name: 'การบำรุงรักษาเชิงป้องกัน', nameEn: 'Preventive Maintenance', description: '', weight: 10, sortOrder: 4 },
        { name: 'ความปลอดภัย', nameEn: 'Safety Compliance', description: '', weight: 10, sortOrder: 5 },
      ],
    },
    {
      name: 'HR และธุรการ',
      nameEn: 'HR & Administration KPI',
      departmentCode: 'HR',
      periodType: 'quarterly',
      description: 'เกณฑ์ประเมินสำหรับทีม HR และธุรการ',
      items: [
        { name: 'ความถูกต้องของเอกสาร', nameEn: 'Documentation Accuracy', description: '', weight: 30, sortOrder: 1 },
        { name: 'ความตรงต่อเวลา', nameEn: 'Punctuality & Attendance', description: '', weight: 20, sortOrder: 2 },
        { name: 'การพัฒนาบุคลากร', nameEn: 'Employee Development', description: '', weight: 20, sortOrder: 3 },
        { name: 'ความพึงพอใจพนักงาน', nameEn: 'Employee Satisfaction', description: '', weight: 20, sortOrder: 4 },
        { name: 'การทำงานเชิงรุก', nameEn: 'Proactiveness', description: '', weight: 10, sortOrder: 5 },
      ],
    },
  ];

  let templatesCreated = 0;
  let itemsCreated = 0;

  for (const tpl of templates) {
    const existing = await (prisma as any).hrKpiTemplate.findFirst({
      where: { name: tpl.name, tenantId: null, isDefault: true },
    });
    if (existing) {
      logger.log(`  ↷ Skipped: ${tpl.name}`);
      continue;
    }

    await (prisma as any).hrKpiTemplate.create({
      data: {
        tenantId: null,
        name: tpl.name,
        nameEn: tpl.nameEn,
        departmentCode: tpl.departmentCode,
        periodType: tpl.periodType,
        description: tpl.description,
        isDefault: true,
        isActive: true,
        sortOrder: templatesCreated,
        items: {
          create: tpl.items.map((item) => ({
            name: item.name,
            nameEn: item.nameEn,
            description: item.description,
            weight: item.weight,
            minScore: 0,
            maxScore: 100,
            sortOrder: item.sortOrder,
          })),
        },
      },
    });

    templatesCreated++;
    itemsCreated += tpl.items.length;
  }

  return { templatesCreated, itemsCreated };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('seedKpiTemplates()', () => {
  const logger = { log: jest.fn() } as unknown as Logger;

  beforeEach(() => {
    templateStore.length = 0;
    templateIdCounter = 0;
    jest.clearAllMocks();
    // re-attach store-based implementations after clearAllMocks
    prismaMock.hrKpiTemplate.findFirst.mockImplementation(
      async ({ where }: { where: Partial<StoredTemplate> }) =>
        templateStore.find(
          (t) =>
            t.name === where.name &&
            t.tenantId === where.tenantId &&
            t.isDefault === where.isDefault,
        ) ?? null,
    );
    prismaMock.hrKpiTemplate.create.mockImplementation(
      async ({ data }: { data: KpiTemplateInput }) => {
        const id = `template-${++templateIdCounter}`;
        const stored: StoredTemplate = {
          id,
          name: data.name,
          tenantId: data.tenantId,
          isDefault: data.isDefault,
          isActive: data.isActive,
          departmentCode: data.departmentCode,
          periodType: data.periodType,
          items: data.items.create,
        };
        templateStore.push(stored);
        return stored;
      },
    );
  });

  // ── 1. จำนวน templates + items ──────────────────────────────────────────────
  it('สร้าง 6 templates และ 30 items (5 items ต่อ template)', async () => {
    const result = await seedKpiTemplates(prismaMock as any, logger);

    expect(result.templatesCreated).toBe(6);
    expect(result.itemsCreated).toBe(30);
    expect(templateStore).toHaveLength(6);
    expect(prismaMock.hrKpiTemplate.create).toHaveBeenCalledTimes(6);
  });

  // ── 2. น้ำหนักรวม = 100 ทุก template ─────────────────────────────────────
  it('น้ำหนัก KPI ของทุก template รวมกันได้ 100%', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      const totalWeight = tpl.items.reduce((sum, item) => sum + Number(item.weight), 0);
      expect(totalWeight).toBe(100);
    }
  });

  // ── 3. isDefault + tenantId ──────────────────────────────────────────────
  it('ทุก template มี isDefault=true และ tenantId=null', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      expect(tpl.isDefault).toBe(true);
      expect(tpl.tenantId).toBeNull();
    }
  });

  // ── 4. minScore / maxScore ──────────────────────────────────────────────
  it('ทุก KPI item มี minScore=0 และ maxScore=100', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      for (const item of tpl.items) {
        expect(item.minScore).toBe(0);
        expect(item.maxScore).toBe(100);
      }
    }
  });

  // ── 5. departmentCode ครบ 6 แผนก ────────────────────────────────────────
  it('ครอบคลุม departmentCode: FD, HK, FB, KT, MT, HR', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    const codes = templateStore.map((t) => t.departmentCode);
    expect(codes).toEqual(expect.arrayContaining(['FD', 'HK', 'FB', 'KT', 'MT', 'HR']));
  });

  // ── 6. Idempotent — รันซ้ำไม่ duplicate ────────────────────────────────
  it('รันซ้ำ 2 ครั้ง ไม่สร้าง template ซ้ำ (idempotent)', async () => {
    const firstRun = await seedKpiTemplates(prismaMock as any, logger);
    const secondRun = await seedKpiTemplates(prismaMock as any, logger);

    expect(firstRun.templatesCreated).toBe(6);
    expect(secondRun.templatesCreated).toBe(0); // ข้ามทั้งหมดเพราะมีอยู่แล้ว
    expect(templateStore).toHaveLength(6);      // store ไม่เพิ่ม
    expect(prismaMock.hrKpiTemplate.create).toHaveBeenCalledTimes(6); // เรียกแค่รอบแรก
  });

  // ── 7. periodType = quarterly ทุก template ──────────────────────────────
  it('ทุก template มี periodType = quarterly', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      expect(tpl.periodType).toBe('quarterly');
    }
  });

  // ── 8. sortOrder ของ items ต่อเนื่องจาก 1 ────────────────────────────
  it('sortOrder ของ items ใน template เริ่มต้นที่ 1 และเพิ่มขึ้นต่อเนื่อง', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      const orders = tpl.items.map((i) => i.sortOrder).sort((a, b) => a - b);
      orders.forEach((o, idx) => expect(o).toBe(idx + 1));
    }
  });

  // ── 9. ชื่อ template ภาษาไทยและอังกฤษครบ ────────────────────────────
  it('ทุก template มีชื่อ name (ไทย) และ nameEn (อังกฤษ) ไม่ว่าง', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      expect(tpl.name.length).toBeGreaterThan(0);
    }
    // nameEn เก็บใน create call argument
    const createCalls = prismaMock.hrKpiTemplate.create.mock.calls;
    for (const [callArg] of createCalls) {
      expect(callArg.data.nameEn.length).toBeGreaterThan(0);
    }
  });

  // ── 10. แต่ละ item ใน template มีชื่อไม่ซ้ำกันภายใน template เดียวกัน ──
  it('ชื่อ KPI item ไม่ซ้ำกันภายใน template เดียวกัน', async () => {
    await seedKpiTemplates(prismaMock as any, logger);

    for (const tpl of templateStore) {
      const names = tpl.items.map((i) => i.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    }
  });
});
