import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
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
      ],
    }).compile();

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

      const result = await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('login', () => {
    it('should login user', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: '1',
          email: loginDto.email,
          firstName: 'Test',
          lastName: 'User',
          role: 'user',
        },
      };

      mockAuthService.login.mockResolvedValue(mockResult);

      const result = await controller.login(loginDto);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
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

      const result = await controller.refresh(refreshTokenDto);

      expect(authService.refreshToken).toHaveBeenCalledWith(refreshTokenDto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('logout', () => {
    it('should logout user', async () => {
      const mockUser = { userId: '1', email: 'test@example.com' };
      const body = { refreshToken: 'refresh-token' };

      mockAuthService.logout.mockResolvedValue(undefined);

      const result = await controller.logout(mockUser, body);

      expect(authService.logout).toHaveBeenCalledWith(
        mockUser.userId,
        body.refreshToken,
      );
      expect(result).toBeUndefined();
    });
  });
});



