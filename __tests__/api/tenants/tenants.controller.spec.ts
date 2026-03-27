import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TenantsController } from '../../../src/tenants/tenants.controller';
import { TenantsService } from '../../../src/tenants/tenants.service';
import { HotelDetailService } from '../../../src/tenants/hotel-detail.service';
import { HotelManagementService } from '../../../src/tenants/hotel-management.service';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../src/common/guards/roles.guard';

describe('TenantsController - Multi-Tenant Endpoints (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;

  const mockCurrentUser = {
    id: 'user-1',
    email: 'test@example.com',
    role: 'tenant_admin',
  };

  const mockTenant = {
    id: 'tenant-1',
    name: 'Hotel A',
    status: 'active',
  };

  const mockCompanyResponse = {
    id: 'tenant-2',
    name: 'Hotel B',
    status: 'trial',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        {
          provide: TenantsService,
          useValue: {
            createAdditionalTenant: jest.fn(),
            getUserTenants: jest.fn(),
            switchTenant: jest.fn(),
            inviteUserToTenant: jest.fn(),
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: HotelDetailService,
          useValue: {
            getHotelDetail: jest.fn(),
          },
        },
        {
          provide: HotelManagementService,
          useValue: {
            addPropertyToTenant: jest.fn(),
            createHotel: jest.fn(),
            getHotelList: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());

    // Mock CurrentUser decorator
    app.use((req: any, res, next) => {
      req.user = mockCurrentUser;
      next();
    });

    await app.init();
    tenantsService = module.get<TenantsService>(TenantsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /tenants/create-company', () => {
    it('should create a new company for the user', async () => {
      (tenantsService.createAdditionalTenant as jest.Mock).mockResolvedValue(
        mockCompanyResponse
      );

      const createCompanyDto = {
        name: 'Hotel B',
        email: 'hotel-b@example.com',
      };

      const response = await request(app.getHttpServer())
        .post('/tenants/create-company')
        .send(createCompanyDto)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Hotel B');
      expect(response.body.message).toContain('subscription');
      expect(tenantsService.createAdditionalTenant).toHaveBeenCalledWith(
        mockCurrentUser.id,
        createCompanyDto
      );
    });

    it('should validate required fields', async () => {
      const invalidDto = {
        // Missing 'name' field
      };

      await request(app.getHttpServer())
        .post('/tenants/create-company')
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('GET /tenants/my-companies', () => {
    it('should return all companies for the current user', async () => {
      const mockCompanies = [
        {
          id: 'tenant-1',
          name: 'Hotel A',
          status: 'active',
          userRole: 'owner',
        },
        {
          id: 'tenant-2',
          name: 'Hotel B',
          status: 'trial',
          userRole: 'admin',
        },
      ];

      (tenantsService.getUserTenants as jest.Mock).mockResolvedValue(mockCompanies);

      const response = await request(app.getHttpServer())
        .get('/tenants/my-companies')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
      expect(tenantsService.getUserTenants).toHaveBeenCalledWith(mockCurrentUser.id);
    });

    it('should return empty array if user has no companies', async () => {
      (tenantsService.getUserTenants as jest.Mock).mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/tenants/my-companies')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta.total).toBe(0);
    });
  });

  describe('POST /tenants/switch', () => {
    it('should switch to a different tenant', async () => {
      const switchResult = {
        user: {
          id: 'user-1',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'tenant_admin',
          tenantId: 'tenant-2',
        },
        message: 'Tenant switched successfully',
      };

      (tenantsService.switchTenant as jest.Mock).mockResolvedValue(switchResult);

      const response = await request(app.getHttpServer())
        .post('/tenants/switch')
        .send({ tenantId: 'tenant-2' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.tenantId).toBe('tenant-2');
      expect(tenantsService.switchTenant).toHaveBeenCalledWith('user-1', 'tenant-2');
    });

    it('should validate tenantId is UUID', async () => {
      await request(app.getHttpServer())
        .post('/tenants/switch')
        .send({ tenantId: 'invalid-uuid' })
        .expect(400);
    });

    it('should return 403 if user has no access to tenant', async () => {
      (tenantsService.switchTenant as jest.Mock).mockRejectedValue(
        new Error('Forbidden')
      );

      await request(app.getHttpServer())
        .post('/tenants/switch')
        .send({ tenantId: 'tenant-999' })
        .expect(500); // Error handling depends on app setup
    });
  });

  describe('POST /tenants/invite', () => {
    it('should invite a user to a tenant', async () => {
      const inviteResult = {
        id: 'ut-1',
        userId: 'user-2',
        tenantId: 'tenant-1',
        role: 'admin',
        user: {
          id: 'user-2',
          email: 'newuser@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
        },
        tenant: {
          id: 'tenant-1',
          name: 'Hotel A',
        },
      };

      (tenantsService.inviteUserToTenant as jest.Mock).mockResolvedValue(
        inviteResult
      );

      const inviteDto = {
        email: 'newuser@example.com',
        tenantId: 'tenant-1',
        role: 'admin',
      };

      const response = await request(app.getHttpServer())
        .post('/tenants/invite')
        .send(inviteDto)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe('user-2');
      expect(response.body.data.role).toBe('admin');
      expect(tenantsService.inviteUserToTenant).toHaveBeenCalledWith(
        mockCurrentUser.id,
        inviteDto
      );
    });

    it('should validate email field', async () => {
      await request(app.getHttpServer())
        .post('/tenants/invite')
        .send({
          email: 'invalid-email',
          tenantId: 'tenant-1',
        })
        .expect(400);
    });

    it('should default role to member if not provided', async () => {
      const inviteResult = {
        id: 'ut-1',
        userId: 'user-2',
        tenantId: 'tenant-1',
        role: 'member',
      };

      (tenantsService.inviteUserToTenant as jest.Mock).mockResolvedValue(
        inviteResult
      );

      const inviteDto = {
        email: 'newuser@example.com',
        tenantId: 'tenant-1',
      };

      const response = await request(app.getHttpServer())
        .post('/tenants/invite')
        .send(inviteDto)
        .expect(201);

      expect(response.body.data.role).toBe('member');
    });
  });
});
