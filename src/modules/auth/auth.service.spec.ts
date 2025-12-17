import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
    };

    it('should register a new user successfully', async () => {
      const hashedPassword = 'hashedPassword';
      const mockUser = {
        id: '1',
        email: registerDto.email,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: 'user',
        createdAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('access-token');
      mockPrismaService.refreshToken.create.mockResolvedValue({
        id: '1',
        token: 'refresh-token',
      });

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(mockPrismaService.user.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if user already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: '1',
        email: registerDto.email,
      });

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login user successfully', async () => {
      const mockUser = {
        id: '1',
        email: loginDto.email,
        password: 'hashedPassword',
        firstName: 'Test',
        lastName: 'User',
        role: 'user',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('access-token');
      mockPrismaService.refreshToken.create.mockResolvedValue({
        id: '1',
        token: 'refresh-token',
      });

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      const mockUser = {
        id: '1',
        email: loginDto.email,
        password: 'hashedPassword',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshToken', () => {
    const refreshTokenDto: RefreshTokenDto = {
      refreshToken: 'valid-refresh-token',
    };

    it('should refresh token successfully', async () => {
      const mockTokenRecord = {
        id: '1',
        token: refreshTokenDto.refreshToken,
        userId: '1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        user: {
          id: '1',
          email: 'test@example.com',
          role: 'user',
        },
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(
        mockTokenRecord,
      );
      mockJwtService.sign.mockReturnValue('new-access-token');
      mockPrismaService.refreshToken.create.mockResolvedValue({
        id: '2',
        token: 'new-refresh-token',
      });
      mockPrismaService.refreshToken.update.mockResolvedValue({
        ...mockTokenRecord,
        revokedAt: new Date(),
      });

      const result = await service.refreshToken(refreshTokenDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockPrismaService.refreshToken.update).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if token not found', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token is expired', async () => {
      const mockTokenRecord = {
        id: '1',
        token: refreshTokenDto.refreshToken,
        userId: '1',
        expiresAt: new Date(Date.now() - 1000), // Expired
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(
        mockTokenRecord,
      );
      mockPrismaService.refreshToken.delete.mockResolvedValue(mockTokenRecord);

      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke specific refresh token', async () => {
      const userId = '1';
      const refreshToken = 'refresh-token';

      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout(userId, refreshToken);

      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          token: refreshToken,
          userId,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it('should revoke all refresh tokens for user', async () => {
      const userId = '1';

      mockPrismaService.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.logout(userId);

      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });
  });
});

