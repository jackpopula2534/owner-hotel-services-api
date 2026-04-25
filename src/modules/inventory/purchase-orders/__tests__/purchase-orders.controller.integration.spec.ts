import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PurchaseOrdersController } from '../purchase-orders.controller';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';

/**
 * Integration test — boots the actual NestJS HTTP stack (router, pipes,
 * controller, service) for the procurement-side endpoints we shipped in
 * Sprint 1 + 2. The Prisma client is mocked, but everything else is real.
 *
 * This is the closest we can get to "calling it through the web" without
 * a running browser, and it's the test that catches:
 *   - route ordering bugs (e.g. /:id matching "tracking")
 *   - DTO validation errors
 *   - controller → service wiring
 *   - response envelope shape ({ success, data })
 */
describe('PurchaseOrders HTTP — Sprint 1+2 endpoints', () => {
  let app: INestApplication;

  const tenantId = 'tenant-test';

  // Sample data shared across tests
  const samplePos = [
    {
      id: 'po-A',
      poNumber: 'PO-202604-0001',
      status: 'APPROVED',
      expectedDate: new Date('2026-04-20'),
      approvedAt: new Date('2026-04-15'),
      createdAt: new Date('2026-04-10'),
      totalAmount: 100_000,
      currency: 'THB',
      supplierId: 'sup-1',
      warehouseId: 'wh-1',
      supplier: { name: 'Acme Supplier' },
      items: [
        { id: 'poi-1', itemId: 'item-A', quantity: 100, receivedQty: 0, unitPrice: 100, totalPrice: 10000, item: { name: 'Towel', sku: 'TWL-001', unit: 'pcs' } },
        { id: 'poi-2', itemId: 'item-B', quantity: 50, receivedQty: 0, unitPrice: 200, totalPrice: 10000, item: { name: 'Soap', sku: 'SOAP-001', unit: 'pcs' } },
      ],
      goodsReceives: [],
    },
    {
      id: 'po-B',
      poNumber: 'PO-202604-0002',
      status: 'PARTIALLY_RECEIVED',
      expectedDate: new Date('2027-01-01'),
      approvedAt: new Date('2026-04-15'),
      createdAt: new Date('2026-04-12'),
      totalAmount: 50_000,
      currency: 'THB',
      supplierId: 'sup-2',
      warehouseId: 'wh-1',
      supplier: { name: 'Beta Supplier' },
      items: [
        { id: 'poi-3', itemId: 'item-C', quantity: 100, receivedQty: 60, unitPrice: 500, totalPrice: 50000, item: { name: 'Bottle', sku: 'BT-001', unit: 'pcs' } },
      ],
      goodsReceives: [
        {
          id: 'gr-1',
          grNumber: 'GR-202604-0001',
          status: 'ACCEPTED',
          receiveDate: new Date('2026-04-22'),
          invoiceNumber: 'INV-9921',
          totalAmount: 30_000,
          items: [
            { id: 'gri-1', itemId: 'item-C', receivedQty: 60, rejectedQty: 0, lotId: null, expiryDate: null },
          ],
        },
      ],
    },
  ];

  const mockPrismaService = {
    purchaseOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    warehouse: {
      findMany: jest.fn().mockResolvedValue([{ id: 'wh-1', name: 'Main Warehouse' }]),
    },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    })
      // Bypass auth guards — they need full app context that isn't relevant
      // to verifying route+service+DTO behavior.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { id: 'user-test', tenantId };
          return true;
        },
      })
      .overrideGuard(AddonGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaService.warehouse.findMany.mockResolvedValue([
      { id: 'wh-1', name: 'Main Warehouse' },
    ]);
  });

  describe('GET /inventory/purchase-orders/tracking', () => {
    it('returns 200 with the expected envelope', async () => {
      mockPrismaService.purchaseOrder.findMany
        .mockResolvedValueOnce(samplePos) // paged list
        .mockResolvedValueOnce([]) // approvedRows for summary
        .mockResolvedValueOnce([]); // partialRows for summary
      mockPrismaService.purchaseOrder.count
        .mockResolvedValueOnce(2) // total
        .mockResolvedValueOnce(0) // full
        .mockResolvedValueOnce(0) // closed
        .mockResolvedValueOnce(0); // overdue

      const res = await request(app.getHttpServer()).get(
        '/api/v1/inventory/purchase-orders/tracking',
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('meta');
      expect(res.body.data.data).toHaveLength(2);

      const rowB = res.body.data.data.find((r: any) => r.poNumber === 'PO-202604-0002');
      expect(rowB.progress.percent).toBe(60);
      expect(rowB.progress.receivedQty).toBe(60);
      expect(rowB.latestGr.grNumber).toBe('GR-202604-0001');
    });

    it('rejects bogus status enum values with 400', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(0);

      const res = await request(app.getHttpServer())
        .get('/api/v1/inventory/purchase-orders/tracking')
        .query({ status: 'NOT_A_STATUS' });

      expect(res.status).toBe(400);
    });

    it('coerces overdue=true into a real boolean filter', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(0);

      const res = await request(app.getHttpServer())
        .get('/api/v1/inventory/purchase-orders/tracking')
        .query({ overdue: 'true' });

      expect(res.status).toBe(200);
      const where = mockPrismaService.purchaseOrder.findMany.mock.calls[0][0].where;
      // The overdue filter narrows status to APPROVED|PARTIAL only
      expect(where.status).toEqual({ in: ['APPROVED', 'PARTIALLY_RECEIVED'] });
      expect(where.expectedDate).toEqual({ lt: expect.any(Date) });
    });

    it('does NOT match `tracking` as a UUID for the /:id route', async () => {
      // This is the critical regression check — if controller route order is
      // ever reshuffled, /tracking would fall through to findOne(:id) and
      // hit Prisma with id="tracking", returning 404.
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(0);

      const res = await request(app.getHttpServer()).get(
        '/api/v1/inventory/purchase-orders/tracking',
      );

      expect(res.status).toBe(200);
      // The findUnique that findOne would have called must NOT have run
      expect(mockPrismaService.purchaseOrder.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET /inventory/purchase-orders/:id/receiving', () => {
    it('returns 200 with line-level breakdown + GR list', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        ...samplePos[1],
        tenantId,
      });

      const res = await request(app.getHttpServer()).get(
        '/api/v1/inventory/purchase-orders/po-B/receiving',
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.poNumber).toBe('PO-202604-0002');
      expect(res.body.data.totals.percent).toBe(60);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0]).toMatchObject({
        sku: 'BT-001',
        ordered: 100,
        received: 60,
        pending: 40,
        status: 'PARTIAL',
      });
      expect(res.body.data.grs).toHaveLength(1);
      expect(res.body.data.grs[0].grNumber).toBe('GR-202604-0001');
    });

    it('returns 404 when PO does not exist', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer()).get(
        '/api/v1/inventory/purchase-orders/missing-id/receiving',
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when PO belongs to a different tenant', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        ...samplePos[1],
        tenantId: 'other-tenant',
      });

      const res = await request(app.getHttpServer()).get(
        '/api/v1/inventory/purchase-orders/po-B/receiving',
      );

      expect(res.status).toBe(404);
    });
  });
});
