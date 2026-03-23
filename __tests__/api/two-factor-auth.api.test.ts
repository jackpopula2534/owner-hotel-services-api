import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorAuthController } from '../../src/two-factor-auth/two-factor-auth.controller';
import { TwoFactorAuthService } from '../../src/two-factor-auth/two-factor-auth.service';

describe('Two-Factor Authentication API', () => {
  let controller: TwoFactorAuthController;
  let twoFactorService: TwoFactorAuthService;

  const mockTwoFactorService = {
    generateSecret: jest.fn(),
    verifyAndEnable: jest.fn(),
    disable: jest.fn(),
    getStatus: jest.fn(),
    regenerateBackupCodes: jest.fn(),
    verifyTempToken: jest.fn(),
    verifyBackupCode: jest.fn(),
    verifyCode: jest.fn(),
  };

  const mockUser = {
    sub: 'user-123',
    email: 'test@example.com',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorAuthController],
      providers: [
        {
          provide: TwoFactorAuthService,
          useValue: mockTwoFactorService,
        },
      ],
    }).compile();

    controller = module.get<TwoFactorAuthController>(TwoFactorAuthController);
    twoFactorService = module.get<TwoFactorAuthService>(TwoFactorAuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/v1/auth/2fa/enable', () => {
    it('should generate 2FA secret and QR code', async () => {
      const mockResult = {
        secret: 'JBSWY3DPEHPK3PXP',
        qrCodeImage: 'data:image/png;base64,...',
        otpAuthUrl: 'otpauth://totp/HotelServices:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HotelServices',
      };

      mockTwoFactorService.generateSecret.mockResolvedValue(mockResult);

      const result = await controller.enable({ user: mockUser });

      expect(twoFactorService.generateSecret).toHaveBeenCalledWith('user-123');
      expect(result.secret).toBeDefined();
      expect(result.qrCodeImage).toBeDefined();
    });

    it('should handle already enabled 2FA', async () => {
      mockTwoFactorService.generateSecret.mockRejectedValue(
        new Error('2FA is already enabled'),
      );

      await expect(controller.enable({ user: mockUser })).rejects.toThrow(
        '2FA is already enabled',
      );
    });
  });

  describe('POST /api/v1/auth/2fa/verify', () => {
    it('should verify TOTP code and enable 2FA', async () => {
      const dto = { code: '123456' };

      const mockResult = {
        success: true,
        message: '2FA enabled successfully',
      };

      mockTwoFactorService.verifyAndEnable.mockResolvedValue(mockResult);

      const result = await controller.verify(dto, { user: mockUser });

      expect(twoFactorService.verifyAndEnable).toHaveBeenCalledWith('user-123', '123456');
      expect(result.success).toBe(true);
    });

    it('should reject invalid TOTP code', async () => {
      const dto = { code: '000000' };

      mockTwoFactorService.verifyAndEnable.mockRejectedValue(
        new Error('Invalid verification code'),
      );

      await expect(controller.verify(dto, { user: mockUser })).rejects.toThrow(
        'Invalid verification code',
      );
    });

    it('should handle expired TOTP code', async () => {
      const dto = { code: '123456' };

      mockTwoFactorService.verifyAndEnable.mockRejectedValue(
        new Error('Code has expired'),
      );

      await expect(controller.verify(dto, { user: mockUser })).rejects.toThrow(
        'Code has expired',
      );
    });
  });

  describe('POST /api/v1/auth/2fa/disable', () => {
    it('should disable 2FA with password and code', async () => {
      const dto = {
        password: 'currentPassword123',
        code: '123456',
      };

      const mockResult = {
        success: true,
        message: '2FA disabled successfully',
      };

      mockTwoFactorService.disable.mockResolvedValue(mockResult);

      const result = await controller.disable(dto, { user: mockUser });

      expect(twoFactorService.disable).toHaveBeenCalledWith(
        'user-123',
        'currentPassword123',
        '123456',
      );
      expect(result.success).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const dto = {
        password: 'wrongPassword',
        code: '123456',
      };

      mockTwoFactorService.disable.mockRejectedValue(
        new Error('Incorrect password'),
      );

      await expect(controller.disable(dto, { user: mockUser })).rejects.toThrow(
        'Incorrect password',
      );
    });

    it('should reject invalid 2FA code when disabling', async () => {
      const dto = {
        password: 'correctPassword',
        code: '000000',
      };

      mockTwoFactorService.disable.mockRejectedValue(
        new Error('Invalid 2FA code'),
      );

      await expect(controller.disable(dto, { user: mockUser })).rejects.toThrow(
        'Invalid 2FA code',
      );
    });
  });

  describe('GET /api/v1/auth/2fa/status', () => {
    it('should get 2FA status - enabled', async () => {
      const mockStatus = {
        isEnabled: true,
        enabledAt: '2024-01-15T10:00:00Z',
        backupCodesRemaining: 5,
      };

      mockTwoFactorService.getStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus({ user: mockUser });

      expect(twoFactorService.getStatus).toHaveBeenCalledWith('user-123');
      expect(result.isEnabled).toBe(true);
    });

    it('should get 2FA status - disabled', async () => {
      const mockStatus = {
        isEnabled: false,
        enabledAt: null,
        backupCodesRemaining: 0,
      };

      mockTwoFactorService.getStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus({ user: mockUser });

      expect(result.isEnabled).toBe(false);
    });
  });

  describe('GET /api/v1/auth/2fa/backup-codes', () => {
    it('should regenerate backup codes', async () => {
      const dto = { code: '123456' };

      const mockResult = {
        success: true,
        backupCodes: ['NEW123', 'NEW456', 'NEW789', 'NEW012', 'NEW345'],
      };

      mockTwoFactorService.regenerateBackupCodes.mockResolvedValue(mockResult);

      const result = await controller.getBackupCodes(dto, { user: mockUser });

      expect(twoFactorService.regenerateBackupCodes).toHaveBeenCalledWith('user-123', '123456');
      expect(result.backupCodes).toHaveLength(5);
    });

    it('should require valid TOTP to regenerate', async () => {
      const dto = { code: 'invalid' };

      mockTwoFactorService.regenerateBackupCodes.mockRejectedValue(
        new Error('Invalid verification code'),
      );

      await expect(controller.getBackupCodes(dto, { user: mockUser })).rejects.toThrow(
        'Invalid verification code',
      );
    });
  });

  describe('POST /api/v1/auth/2fa/verify-backup', () => {
    it('should verify backup code for login', async () => {
      const dto = {
        backupCode: 'ABC123',
        tempToken: 'temp-token-xyz',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
      });
      mockTwoFactorService.verifyBackupCode.mockResolvedValue(true);

      const result = await controller.verifyBackup(dto);

      expect(result.success).toBe(true);
    });

    it('should reject invalid backup code', async () => {
      const dto = {
        backupCode: 'INVALID',
        tempToken: 'temp-token-xyz',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
      });
      mockTwoFactorService.verifyBackupCode.mockResolvedValue(false);

      const result = await controller.verifyBackup(dto);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid backup code');
    });

    it('should reject expired temp token', async () => {
      const dto = {
        backupCode: 'ABC123',
        tempToken: 'expired-token',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue(null);

      const result = await controller.verifyBackup(dto);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid or expired session');
    });
  });

  describe('POST /api/v1/auth/2fa/validate', () => {
    it('should validate 2FA code during login', async () => {
      const dto = {
        code: '123456',
        tempToken: 'temp-token-xyz',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
      });
      mockTwoFactorService.verifyCode.mockResolvedValue(true);

      const result = await controller.validate(dto);

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-123');
      expect(result.email).toBe('test@example.com');
    });

    it('should reject invalid 2FA code during login', async () => {
      const dto = {
        code: '000000',
        tempToken: 'temp-token-xyz',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
      });
      mockTwoFactorService.verifyCode.mockResolvedValue(false);

      const result = await controller.validate(dto);

      expect(result.success).toBe(false);
      expect(result.userId).toBeUndefined();
    });

    it('should handle expired session during login', async () => {
      const dto = {
        code: '123456',
        tempToken: 'expired-token',
      };

      mockTwoFactorService.verifyTempToken.mockReturnValue(null);

      const result = await controller.validate(dto);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid or expired session');
    });
  });
});
