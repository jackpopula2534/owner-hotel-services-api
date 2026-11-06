// Mock bcrypt to avoid native binary issues on linux/arm64
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AddonGuard } from '../../common/guards/addon.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    loginAdmin: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        { provide: PrismaService, useValue: { refreshToken: { findUnique: jest.fn() } } },
      ],
    })
      // pos-launch ติด AddonGuard (ต้องใช้ AddonService) — เทสต์นี้ทดสอบ handler ไม่ใช่ guard
      .overrideGuard(AddonGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      };

      const mockResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: '1',
          email: registerDto.email,
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          role: 'user',
        },
      };

      mockAuthService.register.mockResolvedValue(mockResult);

      const mockReq = { ip: '127.0.0.1', socket: {}, headers: { 'user-agent': 'jest' } } as any;
      const result = await controller.register(registerDto, mockReq);

      expect(authService.register).toHaveBeenCalledWith(
        registerDto,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('admin/login', () => {
    it('should login admin via Admin table', async () => {
      const loginDto: LoginDto = {
        email: 'admin@hotelservices.com',
        password: 'Admin@123',
      };

      const mockResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: '1',
          email: loginDto.email,
          firstName: 'Super',
          lastName: 'Admin',
          role: 'platform_admin',
          isPlatformAdmin: true,
        },
      };

      mockAuthService.loginAdmin.mockResolvedValue(mockResult);

      const mockReq = { ip: '127.0.0.1', socket: {}, headers: { 'user-agent': 'jest' } } as any;
      const result = await controller.loginAdmin(loginDto, mockReq);

      expect(authService.loginAdmin).toHaveBeenCalledWith(
        loginDto,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('login', () => {
    it('should login user via User table', async () => {
      const loginDto: LoginDto = {
        email: 'somchai@email.com',
        password: 'password123',
      };

      const mockResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: '2',
          email: loginDto.email,
          firstName: 'สมชาย',
          lastName: 'ใจดี',
          role: 'tenant_admin',
          isPlatformAdmin: false,
        },
      };

      mockAuthService.login.mockResolvedValue(mockResult);

      const mockReq = { ip: '127.0.0.1', socket: {}, headers: { 'user-agent': 'jest' } } as any;
      const result = await controller.login(loginDto, mockReq);

      expect(authService.login).toHaveBeenCalledWith(
        loginDto,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
        'main',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('refresh', () => {
    it('should refresh access token', async () => {
      const refreshTokenDto: RefreshTokenDto = {
        refreshToken: 'refresh-token',
      };

      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAuthService.refreshToken.mockResolvedValue(mockResult);

      const result = await controller.refresh(refreshTokenDto, {} as any, {} as any);

      expect(authService.refreshToken).toHaveBeenCalledWith(refreshTokenDto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('refresh from a terminal httpOnly cookie (BUG-01)', () => {
    const resStub = () => ({ clearCookie: jest.fn() }) as any;

    it('uses the ss_rt_<context> cookie and pins the token to that context', async () => {
      mockAuthService.refreshToken.mockResolvedValue({ accessToken: 'a', refreshToken: 'r2' });
      const req = { headers: { cookie: 'other=1; ss_rt_pos=cookie-token' } } as any;
      const result = await controller.refresh({ context: 'pos' }, req, resStub());
      expect(authService.refreshToken).toHaveBeenCalledWith({ refreshToken: 'cookie-token' }, 'pos');
      expect(result).toEqual({ accessToken: 'a', refreshToken: 'r2' });
    });

    it('never reads another terminal\'s cookie', async () => {
      const req = { headers: { cookie: 'ss_rt_warehouse=wh-token' } } as any;
      await expect(controller.refresh({ context: 'pos' }, req, resStub())).rejects.toBeDefined();
      expect(authService.refreshToken).not.toHaveBeenCalled();
    });

    it('keeps the cookie when the refresh fails (a parallel tab may have just rotated it)', async () => {
      mockAuthService.refreshToken.mockRejectedValue(new Error('revoked'));
      const res = resStub();
      const req = { headers: { cookie: 'ss_rt_hr=dead' } } as any;
      await expect(controller.refresh({ context: 'hr' }, req, res)).rejects.toThrow('revoked');
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('falls back to the cookie when the in-memory body token was rotated by another tab', async () => {
      mockAuthService.refreshToken
        .mockRejectedValueOnce(new Error('revoked'))
        .mockResolvedValueOnce({ accessToken: 'a', refreshToken: 'r3' });
      const req = { headers: { cookie: 'ss_rt_main=newest' } } as any;
      const result = await controller.refresh({ refreshToken: 'stale', context: 'main' }, req, resStub());
      expect(authService.refreshToken).toHaveBeenLastCalledWith({ refreshToken: 'newest' }, 'main');
      expect(result).toEqual({ accessToken: 'a', refreshToken: 'r3' });
    });

    it('main dashboard logout revokes the ss_rt_main cookie token and clears it', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);
      const res = resStub();
      const req = { headers: { cookie: 'ss_rt_main=main-token' } } as any;
      await controller.logout({ userId: 'u1' }, undefined, req, res);
      expect(authService.logout).toHaveBeenCalledWith('u1', 'main-token', 'main');
      expect(res.clearCookie).toHaveBeenCalledWith('ss_rt_main', expect.anything());
    });

    it('terminal logout revokes the cookie token and clears the cookie', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);
      const res = resStub();
      const req = { headers: { cookie: 'ss_rt_pos=pos-token' } } as any;
      await controller.posLogout({ userId: 'u1' }, req, res, undefined);
      expect(authService.logout).toHaveBeenCalledWith('u1', 'pos-token', 'pos');
      expect(res.clearCookie).toHaveBeenCalledWith('ss_rt_pos', expect.anything());
    });
  });

  describe('logout', () => {
    it('should logout user', async () => {
      const mockUser = { userId: '1', email: 'test@example.com' };
      const body = { refreshToken: 'refresh-token' };

      mockAuthService.logout.mockResolvedValue(undefined);

      const result = await controller.logout(mockUser, body);

      expect(authService.logout).toHaveBeenCalledWith(mockUser.userId, body.refreshToken, 'main');
      expect(result).toEqual({
        success: true,
        message: 'Logged out from hotel management dashboard',
      });
    });
  });
});
