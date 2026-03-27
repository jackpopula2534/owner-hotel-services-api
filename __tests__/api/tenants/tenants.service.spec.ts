import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { TenantsService } from '../../../src/tenants/tenants.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

describe('TenantsService - Multi-Tenant', () => {
  let service: TenantsService;
  let prisma: PrismaService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    tenantId: 'tenant-1',
  };

  const mockTenant = {
    id: 'tenant-1',
    name: 'Hotel A',
    status: 'active',
    room_count: 10,
    subscriptions: [],
  };

  const mockUserTenant = {
    id: 'ut-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'owner',
    isDefault: true,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            tenants: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            userTenant: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('createAdditionalTenant', () => {
    it('should create a new tenant and add user_tenants record', async () => {
      const createCompanyDto = {
        name: 'Hotel B',
        email: 'hotel-b@example.com',
      };

      const newTenant = {
        id: 'tenant-2',
        name: 'Hotel B',
        status: 'trial',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.tenants.create as jest.Mock).mockResolvedValue(newTenant);
      (prisma.userTenant.create as jest.Mock).mockResolvedValue({
        ...mockUserTenant,
        tenantId: 'tenant-2',
      });

      const result = await service.createAdditionalTenant('user-1', createCompanyDto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(prisma.tenants.create).toHaveBeenCalled();
      expect(prisma.userTenant.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tenantId: 'tenant-2',
          role: 'owner',
          isDefault: false,
        },
      });
      expect(result.id).toBe('tenant-2');
    });

    it('should throw NotFoundException if user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createAdditionalTenant('invalid-user', { name: 'Hotel C' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserTenants', () => {
    it('should return all tenants for a user with their roles', async () => {
      const mockTenantData = [
        {
          tenant: {
            id: 'tenant-1',
            name: 'Hotel A',
            subscriptions: [],
          },
          role: 'owner',
        },
        {
          tenant: {
            id: 'tenant-2',
            name: 'Hotel B',
            subscriptions: [],
          },
          role: 'admin',
        },
      ];

      (prisma.userTenant.findMany as jest.Mock).mockResolvedValue(mockTenantData);

      const result = await service.getUserTenants('user-1');

      expect(prisma.userTenant.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: {
          tenant: {
            include: {
              subscriptions: {
                include: {
                  plans_subscriptions_plan_idToplans: true,
                }
              }
            }
          }
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].userRole).toBe('owner');
      expect(result[1].userRole).toBe('admin');
    });
  });

  describe('switchTenant', () => {
    it('should switch user to a different tenant', async () => {
      const updatedUser = {
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'tenant_admin',
        tenantId: 'tenant-2',
      };

      (prisma.userTenant.findUnique as jest.Mock).mockResolvedValue(mockUserTenant);
      (prisma.user.update as jest.Mock).mockResolvedValue(updatedUser);

      const result = await service.switchTenant('user-1', 'tenant-2');

      expect(prisma.userTenant.findUnique).toHaveBeenCalledWith({
        where: {
          userId_tenantId: {
            userId: 'user-1',
            tenantId: 'tenant-2',
          }
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tenantId: 'tenant-2' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
        },
      });
      expect(result.user.tenantId).toBe('tenant-2');
    });

    it('should throw ForbiddenException if user has no access to tenant', async () => {
      (prisma.userTenant.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.switchTenant('user-1', 'tenant-3')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('inviteUserToTenant', () => {
    it('should invite an existing user to a tenant', async () => {
      const inviteDto = {
        email: 'newuser@example.com',
        tenantId: 'tenant-1',
        role: 'admin',
      };

      const invitedUser = {
        id: 'user-2',
        email: 'newuser@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      };

      const userTenantResult = {
        id: 'ut-2',
        userId: 'user-2',
        tenantId: 'tenant-1',
        role: 'admin',
        user: invitedUser,
        tenant: { id: 'tenant-1', name: 'Hotel A' },
      };

      (prisma.userTenant.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserTenant) // inviter's access check
        .mockResolvedValueOnce(null); // no existing access check
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(invitedUser);
      (prisma.userTenant.create as jest.Mock).mockResolvedValue(userTenantResult);

      const result = await service.inviteUserToTenant('user-1', inviteDto);

      expect(result.userId).toBe('user-2');
      expect(result.role).toBe('admin');
    });

    it('should throw ForbiddenException if inviter has no permission', async () => {
      const inviteDto = {
        email: 'newuser@example.com',
        tenantId: 'tenant-1',
        role: 'admin',
      };

      const memberTenant = {
        ...mockUserTenant,
        role: 'member',
      };

      (prisma.userTenant.findUnique as jest.Mock).mockResolvedValue(memberTenant);

      await expect(
        service.inviteUserToTenant('user-1', inviteDto)
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if invited user does not exist', async () => {
      const inviteDto = {
        email: 'nonexistent@example.com',
        tenantId: 'tenant-1',
        role: 'admin',
      };

      (prisma.userTenant.findUnique as jest.Mock).mockResolvedValue(mockUserTenant);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.inviteUserToTenant('user-1', inviteDto)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user already has access', async () => {
      const inviteDto = {
        email: 'existing@example.com',
        tenantId: 'tenant-1',
        role: 'admin',
      };

      const existingUser = {
        id: 'user-2',
        email: 'existing@example.com',
      };

      (prisma.userTenant.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserTenant) // inviter's access check
        .mockResolvedValueOnce(mockUserTenant); // existing access check
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      await expect(
        service.inviteUserToTenant('user-1', inviteDto)
      ).rejects.toThrow(BadRequestException);
    });
  });
});
