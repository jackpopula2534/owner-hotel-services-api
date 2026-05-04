import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MenuService } from './menu.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';

/**
 * Focused unit tests for the menu-category surface that was added in this
 * change set. The full POS flow already has integration coverage in
 * `src/integration/restaurant-pos.integration.spec.ts`; these tests target
 * the new auto-mockup endpoint and the icon/color fields on create/update.
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

const mockRestaurant = {
  id: RESTAURANT_ID,
  tenantId: TENANT_ID,
  name: 'Lobby Bar',
};

const makePrismaMock = () => ({
  restaurant: {
    findFirst: jest.fn(),
  },
  menuCategory: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
  menuItem: {
    count: jest.fn(),
  },
  $transaction: jest.fn((ops: any) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops;
  }),
});

const makeAuditMock = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

describe('MenuService — categories (icon/color + auto-mockup)', () => {
  let service: MenuService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let audit: ReturnType<typeof makeAuditMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = makeAuditMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();

    service = module.get(MenuService);
  });

  describe('createCategory with icon/color', () => {
    it('persists icon and color when supplied', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prisma.menuCategory.aggregate.mockResolvedValue({ _max: { displayOrder: 0 } });
      prisma.menuCategory.create.mockImplementation(({ data }: any) => ({
        id: 'cat-new',
        ...data,
      }));

      const result = await service.createCategory(
        RESTAURANT_ID,
        {
          name: 'Desserts',
          description: 'Sweet bites',
          icon: 'cake',
          color: '#EC4899',
        },
        TENANT_ID,
        USER_ID,
      );

      expect(prisma.menuCategory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Desserts',
          icon: 'cake',
          color: '#EC4899',
          restaurantId: RESTAURANT_ID,
          tenantId: TENANT_ID,
        }),
      });
      expect(result.icon).toBe('cake');
      expect(result.color).toBe('#EC4899');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'cat-new', userId: USER_ID }),
      );
    });

    it('rejects when the restaurant does not belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.createCategory(RESTAURANT_ID, { name: 'X' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('autoMockupCategories', () => {
    it('skips names that already exist (case-insensitive) and returns the rest', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prisma.menuCategory.findMany.mockResolvedValue([
        { name: 'Desserts', displayOrder: 0 },
        { name: 'beverages', displayOrder: 1 }, // lowercase to test case-insensitive matching
      ]);
      prisma.menuCategory.create.mockImplementation(({ data }: any) => ({
        id: `cat-${data.name}`,
        ...data,
      }));

      const result = await service.autoMockupCategories(
        RESTAURANT_ID,
        { count: 10 },
        TENANT_ID,
        USER_ID,
      );

      // Should never include "Desserts" or "Beverages"
      const createdNames = result.created.map((c: any) => c.name);
      expect(createdNames).not.toContain('Desserts');
      expect(createdNames).not.toContain('Beverages');

      // displayOrder must continue from the existing max (1) + 1
      result.created.forEach((c: any, idx: number) => {
        expect(c.displayOrder).toBe(2 + idx);
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: RESTAURANT_ID, userId: USER_ID }),
      );
    });

    it('returns an empty payload when every sampled name is already taken', async () => {
      // Pre-populate the restaurant with every possible mockup name so the
      // service returns an empty result without writing anything.
      prisma.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      const { MENU_CATEGORY_MOCKUPS } = await import('./menu-category-mockups');
      prisma.menuCategory.findMany.mockResolvedValue(
        MENU_CATEGORY_MOCKUPS.map((m, idx) => ({ name: m.name, displayOrder: idx })),
      );

      const result = await service.autoMockupCategories(
        RESTAURANT_ID,
        {},
        TENANT_ID,
      );

      expect(result.created).toEqual([]);
      expect(prisma.menuCategory.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.autoMockupCategories(RESTAURANT_ID, {}, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('respects an explicit count within the [5,10] window', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prisma.menuCategory.findMany.mockResolvedValue([]);
      prisma.menuCategory.create.mockImplementation(({ data }: any) => ({
        id: `cat-${data.name}`,
        ...data,
      }));

      const result = await service.autoMockupCategories(
        RESTAURANT_ID,
        { count: 6 },
        TENANT_ID,
      );

      expect(result.created).toHaveLength(6);
      expect(result.total).toBe(6);
      expect(prisma.menuCategory.create).toHaveBeenCalledTimes(6);
    });
  });
});
