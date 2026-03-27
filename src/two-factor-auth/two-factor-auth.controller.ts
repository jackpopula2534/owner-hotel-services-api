import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TwoFactorAuthService } from './two-factor-auth.service';
import {
  Verify2FADto,
  VerifyBackupCodeDto,
  Disable2FADto,
  Login2FADto,
} from './dto/two-factor.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Two-Factor Authentication')
@Controller('api/v1/auth/2fa')
export class TwoFactorAuthController {
  constructor(private readonly twoFactorAuthService: TwoFactorAuthService) {}

  @Post('enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret and QR code' })
  @ApiResponse({ status: 200, description: 'Secret and QR code generated' })
  async enable(@Request() req: any) {
    return this.twoFactorAuthService.generateSecret(req.user.sub);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code and activate 2FA' })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  async verify(@Body() dto: Verify2FADto, @Request() req: any) {
    return this.twoFactorAuthService.verifyAndEnable(req.user.sub, dto.code);
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA' })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  async disable(@Body() dto: Disable2FADto, @Request() req: any) {
    return this.twoFactorAuthService.disable(req.user.sub, dto.password, dto.code);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get 2FA status' })
  @ApiResponse({ status: 200, description: '2FA status retrieved' })
  async getStatus(@Request() req: any) {
    return this.twoFactorAuthService.getStatus(req.user.sub);
  }

  @Get('backup-codes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate backup codes (requires TOTP verification)' })
  @ApiResponse({ status: 200, description: 'Backup codes regenerated' })
  async getBackupCodes(@Body() dto: Verify2FADto, @Request() req: any) {
    return this.twoFactorAuthService.regenerateBackupCodes(req.user.sub, dto.code);
  }

  @Post('verify-backup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify backup code for login' })
  @ApiResponse({ status: 200, description: 'Backup code verified' })
  async verifyBackup(@Body() dto: VerifyBackupCodeDto & { tempToken: string }) {
    const tokenData = this.twoFactorAuthService.verifyTempToken(dto.tempToken);
    if (!tokenData) {
      return { success: false, message: 'Invalid or expired session' };
    }

    const isValid = await this.twoFactorAuthService.verifyBackupCode(
      tokenData.userId,
      dto.backupCode,
    );

    return {
      success: isValid,
      message: isValid ? 'Backup code verified' : 'Invalid backup code',
    };
  }

  @Post('validate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate 2FA code during login' })
  @ApiResponse({ status: 200, description: '2FA code validated' })
  async validate(@Body() dto: Login2FADto) {
    const tokenData = this.twoFactorAuthService.verifyTempToken(dto.tempToken);
    if (!tokenData) {
      return { success: false, message: 'Invalid or expired session' };
    }

    const isValid = await this.twoFactorAuthService.verifyCode(tokenData.userId, dto.code);

    return {
      success: isValid,
      userId: isValid ? tokenData.userId : undefined,
      email: isValid ? tokenData.email : undefined,
      message: isValid ? '2FA verified' : 'Invalid code',
    };
  }
}
