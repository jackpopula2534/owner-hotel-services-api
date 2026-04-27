import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { CreatePosUserDto } from './dto/create-pos-user.dto';
import { PosLaunchDto } from './dto/pos-launch.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { Throttle } from '@nestjs/throttler';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
@SkipSubscriptionCheck()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @ApiOperation({ summary: 'Register a new user (hotel owner/staff)' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async register(@Body() registerDto: RegisterDto, @Req() req: Request) {
    return this.authService.register(registerDto, {
      ipAddress: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('admin/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({ summary: 'Login as platform admin (Admin table only)' })
  @ApiResponse({ status: 200, description: 'Admin successfully logged in' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async loginAdmin(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.loginAdmin(loginDto, {
      ipAddress: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({
    summary:
      'Login to hotel management dashboard (User table — tenant_admin, manager, receptionist, etc.)',
    description:
      'Creates a session tagged systemContext="main". POS-only staff (waiter, chef, cashier) ' +
      'cannot log in through this endpoint — use POST /auth/pos/login instead.',
  })
  @ApiResponse({ status: 200, description: 'User successfully logged in' })
  @ApiResponse({ status: 401, description: 'Unauthorized or wrong system' })
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      loginDto,
      {
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      'main',
    );
  }

  @Post('pos/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({
    summary: 'Login to POS system',
    description:
      'Creates a session tagged systemContext="pos". Validates that the user has "pos" in their ' +
      'allowedSystems. Tokens issued here can ONLY be used on POS endpoints. ' +
      'Logging out from POS will not affect the main dashboard session.',
  })
  @ApiResponse({ status: 200, description: 'POS login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized or account not allowed to access POS' })
  async posLogin(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      loginDto,
      {
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      'pos',
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 50, ttl: 60 } })
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout from main hotel management dashboard',
    description: 'Revokes only the main-dashboard session tokens. POS sessions remain active.',
  })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  async logout(@CurrentUser() user: any, @Body() body?: { refreshToken?: string }) {
    await this.authService.logout(user.userId, body?.refreshToken, 'main');
    return { success: true, message: 'Logged out from hotel management dashboard' };
  }

  @Post('pos/logout')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 50, ttl: 60 } })
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout from POS system only',
    description:
      'Revokes only POS session tokens. The main hotel management dashboard session stays active. ' +
      'This is the correct logout for POS terminals.',
  })
  @ApiResponse({ status: 200, description: 'POS session ended' })
  async posLogout(@CurrentUser() user: any, @Body() body?: { refreshToken?: string }) {
    await this.authService.logout(user.userId, body?.refreshToken, 'pos');
    return { success: true, message: 'Logged out from POS system' };
  }

  // ─── Purchasing / Procurement Sub-System ────────────────────────────────────

  @Post('purchasing/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({
    summary: 'Login to Procurement Terminal',
    description:
      'Creates a session tagged systemContext="procurement". ' +
      'Validates that the user has "procurement" in their allowedSystems. ' +
      'Tokens issued here are scoped to the procurement sub-system only. ' +
      'Logging out from this terminal will NOT affect the main dashboard session.',
  })
  @ApiResponse({ status: 200, description: 'Procurement login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized or account not allowed to access Procurement system' })
  async purchasingLogin(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      loginDto,
      {
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      'procurement',
    );
  }

  @Post('purchasing/logout')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 50, ttl: 60 } })
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout from Procurement Terminal only',
    description:
      'Revokes only procurement session tokens. ' +
      'The main hotel management dashboard session stays active.',
  })
  @ApiResponse({ status: 200, description: 'Procurement session ended' })
  async purchasingLogout(@CurrentUser() user: any, @Body() body?: { refreshToken?: string }) {
    await this.authService.logout(user.userId, body?.refreshToken, 'procurement');
    return { success: true, message: 'Logged out from Procurement system' };
  }

  // ─── Warehouse / Inventory Operations Sub-System ───────────────────────────

  @Post('warehouse/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({
    summary: 'Login to Warehouse Terminal',
    description:
      'Creates a session tagged systemContext="warehouse". ' +
      'Validates that the user has "warehouse" in their allowedSystems. ' +
      'Tokens issued here are scoped to the warehouse sub-system only. ' +
      'Logging out from this terminal will NOT affect the main dashboard or procurement sessions.',
  })
  @ApiResponse({ status: 200, description: 'Warehouse login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized or account not allowed to access Warehouse system' })
  async warehouseLogin(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      loginDto,
      {
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      'warehouse',
    );
  }

  @Post('warehouse/logout')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 50, ttl: 60 } })
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout from Warehouse Terminal only',
    description:
      'Revokes only warehouse session tokens. ' +
      'The main hotel management dashboard and procurement sessions stay active.',
  })
  @ApiResponse({ status: 200, description: 'Warehouse session ended' })
  async warehouseLogout(@CurrentUser() user: any, @Body() body?: { refreshToken?: string }) {
    await this.authService.logout(user.userId, body?.refreshToken, 'warehouse');
    return { success: true, message: 'Logged out from Warehouse system' };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600 } }) // Limit to 3 requests per hour per IP
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiResponse({ status: 200, description: 'Reset link sent message' })
  async forgotPassword(@Body() body: any) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @ApiOperation({ summary: 'Reset password using token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() body: any) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  // ─── POS User Management ────────────────────────────────────────────────────

  @Post('pos-users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({
    summary: 'Create a POS login account for an employee',
    description:
      'Creates a User record with a restaurant-staff role (waiter, chef, cashier, etc.) ' +
      "scoped to the caller's tenant. Only tenant_admin or manager can call this.",
  })
  @ApiResponse({ status: 201, description: 'POS user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createPosUser(@Body() dto: CreatePosUserDto, @CurrentUser() caller: any) {
    this.assertPosManager(caller);
    return this.authService.createPosUser(dto, caller.tenantId);
  }

  @Get('pos-users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'List all POS staff accounts for this tenant' })
  @ApiResponse({ status: 200, description: 'List of POS users' })
  async listPosUsers(@CurrentUser() caller: any) {
    this.assertPosManager(caller);
    return this.authService.listPosUsers(caller.tenantId);
  }

  @Patch('pos-users/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Update a POS user (role, status, or reset password)' })
  @ApiResponse({ status: 200, description: 'POS user updated' })
  async updatePosUser(
    @Param('userId') userId: string,
    @Body() body: { role?: string; status?: string; password?: string },
    @CurrentUser() caller: any,
  ) {
    this.assertPosManager(caller);
    return this.authService.updatePosUser(userId, caller.tenantId, body);
  }

  // ─── POS Deep-link Launch ───────────────────────────────────────────────────

  @Post('pos-launch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary: 'Generate a short-lived deep-link token to open the POS pre-authenticated',
    description:
      'Returns a 5-minute JWT and a ready-to-use /pos?token=...&restaurantId=... URL. ' +
      'The frontend should open this URL in a new tab or window.',
  })
  @ApiResponse({ status: 200, description: 'POS launch token generated' })
  @ApiResponse({ status: 400, description: 'Restaurant not found in your account' })
  async posLaunch(@Body() dto: PosLaunchDto, @CurrentUser() caller: any, @Req() req: Request) {
    return this.authService.generatePosLaunchToken(
      dto,
      {
        userId: caller.userId,
        email: caller.email,
        role: caller.role,
        tenantId: caller.tenantId,
      },
      req.ip ?? req.socket?.remoteAddress,
    );
  }

  // ─── Purchasing Sub-System Deep-link Launch ──────────────────────────────────

  @Post('purchasing-launch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary: 'Generate a short-lived deep-link token to open Purchasing terminal pre-authenticated',
    description: 'Returns a 5-minute JWT. User is logged in as procurement_manager (highest level).',
  })
  @ApiResponse({ status: 200, description: 'Purchasing launch token generated' })
  async purchasingLaunch(@CurrentUser() caller: any, @Req() req: Request) {
    return this.authService.generatePurchasingLaunchToken(
      { userId: caller.userId, email: caller.email, role: caller.role, tenantId: caller.tenantId },
      req.ip ?? req.socket?.remoteAddress,
    );
  }

  // ─── Warehouse Sub-System Deep-link Launch ───────────────────────────────────

  @Post('warehouse-launch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary: 'Generate a short-lived deep-link token to open Warehouse terminal pre-authenticated',
    description: 'Returns a 5-minute JWT. User is logged in as warehouse_manager (highest level).',
  })
  @ApiResponse({ status: 200, description: 'Warehouse launch token generated' })
  async warehouseLaunch(@CurrentUser() caller: any, @Req() req: Request) {
    return this.authService.generateWarehouseLaunchToken(
      { userId: caller.userId, email: caller.email, role: caller.role, tenantId: caller.tenantId },
      req.ip ?? req.socket?.remoteAddress,
    );
  }

  // ────────────────────────────────────────────────────────────────────────────

  /** Only tenant_admin, manager, or platform_admin can manage POS users */
  private assertPosManager(caller: any): void {
    const allowed = ['tenant_admin', 'manager', 'platform_admin', 'admin'];
    if (!allowed.includes(caller.role)) {
      throw new ForbiddenException('Only tenant admins and managers can manage POS users');
    }
  }
}
