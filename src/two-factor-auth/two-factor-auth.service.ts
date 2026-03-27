import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Enable2FAResponseDto, TwoFactorStatusDto } from './dto/two-factor.dto';

@Injectable()
export class TwoFactorAuthService {
  private readonly logger = new Logger(TwoFactorAuthService.name);
  private readonly appName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.appName = this.configService.get('APP_NAME', 'Hotel Services');
  }

  /**
   * Generate 2FA secret and QR code for setup
   */
  async generateSecret(userId: string): Promise<Enable2FAResponseDto> {
    // Check if 2FA is already enabled
    const existing = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (existing?.isEnabled) {
      throw new BadRequestException('2FA is already enabled for this account');
    }

    // Get user email for OTP label
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${this.appName} (${user.email})`,
      length: 20,
    });

    // Generate backup codes
    const backupCodes = this.generateBackupCodes(8);
    const hashedBackupCodes = await Promise.all(backupCodes.map((code) => bcrypt.hash(code, 10)));

    // Save or update 2FA settings (not enabled yet until verified)
    await this.prisma.user2FASettings.upsert({
      where: { userId },
      create: {
        userId,
        secret: secret.base32,
        isEnabled: false,
        backupCodes: JSON.stringify(hashedBackupCodes),
      },
      update: {
        secret: secret.base32,
        isEnabled: false,
        backupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    // Generate QR code
    const qrCodeImage = await QRCode.toDataURL(secret.otpauth_url!, {
      width: 200,
      margin: 2,
    });

    this.logger.log(`2FA secret generated for user ${userId}`);

    return {
      secret: secret.base32,
      qrCodeImage,
      otpAuthUrl: secret.otpauth_url!,
      backupCodes,
    };
  }

  /**
   * Verify TOTP code and enable 2FA
   */
  async verifyAndEnable(
    userId: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      throw new BadRequestException('2FA setup not initiated. Please generate secret first.');
    }

    if (settings.isEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    // Verify the TOTP code
    const isValid = speakeasy.totp.verify({
      secret: settings.secret,
      encoding: 'base32',
      token: code,
      window: 1, // Allow 1 step tolerance (30 seconds)
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Enable 2FA
    await this.prisma.user2FASettings.update({
      where: { userId },
      data: {
        isEnabled: true,
        enabledAt: new Date(),
      },
    });

    this.logger.log(`2FA enabled for user ${userId}`);

    return {
      success: true,
      message: '2FA has been enabled successfully',
    };
  }

  /**
   * Verify TOTP code for login
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.isEnabled) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    const isValid = speakeasy.totp.verify({
      secret: settings.secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    return isValid;
  }

  /**
   * Verify backup code for login
   */
  async verifyBackupCode(userId: string, backupCode: string): Promise<boolean> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.isEnabled) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    const storedCodes: string[] = JSON.parse((settings.backupCodes as string) || '[]');

    // Check each backup code
    for (let i = 0; i < storedCodes.length; i++) {
      const isMatch = await bcrypt.compare(backupCode, storedCodes[i]);
      if (isMatch) {
        // Remove used backup code
        storedCodes.splice(i, 1);
        await this.prisma.user2FASettings.update({
          where: { userId },
          data: {
            backupCodes: JSON.stringify(storedCodes),
          },
        });

        this.logger.log(`Backup code used for user ${userId}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Disable 2FA
   */
  async disable(
    userId: string,
    password: string,
    code?: string,
  ): Promise<{ success: boolean; message: string }> {
    // Verify user password
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.isEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify TOTP code if provided
    if (code) {
      const isValid = speakeasy.totp.verify({
        secret: settings.secret,
        encoding: 'base32',
        token: code,
        window: 1,
      });

      if (!isValid) {
        throw new BadRequestException('Invalid verification code');
      }
    }

    // Disable 2FA
    await this.prisma.user2FASettings.delete({
      where: { userId },
    });

    this.logger.log(`2FA disabled for user ${userId}`);

    return {
      success: true,
      message: '2FA has been disabled successfully',
    };
  }

  /**
   * Get 2FA status for user
   */
  async getStatus(userId: string): Promise<TwoFactorStatusDto> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return {
        isEnabled: false,
      };
    }

    const backupCodes: string[] = JSON.parse((settings.backupCodes as string) || '[]');

    return {
      isEnabled: settings.isEnabled,
      enabledAt: settings.enabledAt || undefined,
      backupCodesRemaining: backupCodes.length,
    };
  }

  /**
   * Regenerate backup codes
   */
  async regenerateBackupCodes(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.isEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify TOTP code
    const isValid = speakeasy.totp.verify({
      secret: settings.secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Generate new backup codes
    const backupCodes = this.generateBackupCodes(8);
    const hashedBackupCodes = await Promise.all(backupCodes.map((code) => bcrypt.hash(code, 10)));

    await this.prisma.user2FASettings.update({
      where: { userId },
      data: {
        backupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    this.logger.log(`Backup codes regenerated for user ${userId}`);

    return { backupCodes };
  }

  /**
   * Check if 2FA is required for user
   */
  async is2FARequired(userId: string): Promise<boolean> {
    const settings = await this.prisma.user2FASettings.findUnique({
      where: { userId },
    });

    return settings?.isEnabled || false;
  }

  /**
   * Generate temporary token for 2FA login flow
   */
  generateTempToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { sub: userId, email, type: '2fa_pending' },
      { expiresIn: '5m' }, // 5 minutes to complete 2FA
    );
  }

  /**
   * Verify temporary token
   */
  verifyTempToken(token: string): { userId: string; email: string } | null {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== '2fa_pending') {
        return null;
      }
      return { userId: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  /**
   * Generate random backup codes
   */
  private generateBackupCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }
}
