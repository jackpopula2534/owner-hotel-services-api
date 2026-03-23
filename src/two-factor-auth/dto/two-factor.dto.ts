import { IsString, IsNotEmpty, Length, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Enable2FAResponseDto {
  @ApiProperty({ description: 'Secret key for authenticator app' })
  secret: string;

  @ApiProperty({ description: 'QR code as base64 image for scanning' })
  qrCodeImage: string;

  @ApiProperty({ description: 'OTP auth URL for manual entry' })
  otpAuthUrl: string;

  @ApiProperty({ description: 'Backup codes for recovery' })
  backupCodes: string[];
}

export class Verify2FADto {
  @ApiProperty({ description: '6-digit TOTP code from authenticator app' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class VerifyBackupCodeDto {
  @ApiProperty({ description: 'Backup code for recovery' })
  @IsString()
  @IsNotEmpty()
  @Length(8, 8)
  backupCode: string;
}

export class Disable2FADto {
  @ApiProperty({ description: 'Current password for confirmation' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ description: '6-digit TOTP code (optional if using backup code)' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;
}

export class Login2FADto {
  @ApiProperty({ description: 'Temporary session token from initial login' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  @ApiProperty({ description: '6-digit TOTP code from authenticator app' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class TwoFactorStatusDto {
  @ApiProperty({ description: 'Whether 2FA is enabled' })
  isEnabled: boolean;

  @ApiProperty({ description: 'When 2FA was enabled' })
  enabledAt?: Date;

  @ApiProperty({ description: 'Number of remaining backup codes' })
  backupCodesRemaining?: number;
}
