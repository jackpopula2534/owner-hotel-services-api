import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { CreatePosUserDto } from './dto/create-pos-user.dto';
import { PosLaunchDto } from './dto/pos-launch.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailEventsService: EmailEventsService,
    private onboardingService: OnboardingService,
  ) {}

  async register(registerDto: RegisterDto, deviceInfo?: { ipAddress?: string; userAgent?: string }) {
    const { email, password, firstName, lastName, hotelName, hotelAddress, hotelPhone } =
      registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with tenant_admin role (they're registering as hotel owner)
    let user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role: 'tenant_admin', // New users are tenant admins (hotel owners)
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    // Auto-create Tenant + Trial Subscription (Step 2 & 3 of registration flow)
    let onboardingResult = null;
    const tenantName = hotelName || `${firstName}'s Hotel`;

    try {
      onboardingResult = await this.onboardingService.registerHotel(
        {
          name: tenantName,
          address: hotelAddress,
          phone: hotelPhone,
          email: email,
        },
        14, // 14-day trial
      );

      // Link user to the newly created tenant
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { tenantId: onboardingResult.tenant.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
          createdAt: true,
        },
      });

      // Create UserTenant junction record with owner role and isDefault=true
      await this.prisma.userTenant.create({
        data: {
          userId: user.id,
          tenantId: onboardingResult.tenant.id,
          role: 'owner',
          isDefault: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Onboarding failed for user ${user.id}: ${err.message}. User created without tenant.`,
      );
    }

    // Generate tokens (include tenantId for multi-tenant PMS)
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tenantId ?? undefined,
      'user',
      deviceInfo,
    );

    // Send welcome email (async, non-blocking)
    this.emailEventsService
      .onUserRegistered({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .catch((err) => {
        this.logger.error(`Failed to send welcome email: ${err.message}`);
      });

    return {
      ...tokens,
      user: {
        ...user,
        tenantId: user.tenantId ?? undefined,
      },
      onboarding: onboardingResult
        ? {
            tenantId: onboardingResult.tenant.id,
            subscriptionId: onboardingResult.subscription.id,
            trialEndsAt: onboardingResult.trialEndsAt,
            message: onboardingResult.message,
            property: onboardingResult.property
              ? {
                  id: onboardingResult.property.id,
                  name: onboardingResult.property.name,
                  code: onboardingResult.property.code,
                }
              : undefined,
          }
        : undefined,
    };
  }

  async loginAdmin(loginDto: LoginDto, deviceInfo?: { ipAddress?: string; userAgent?: string }) {
    const { email, password } = loginDto;

    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.status !== 'active') {
      throw new UnauthorizedException('Admin account is suspended or inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(admin.id, admin.email, admin.role, undefined, 'admin', deviceInfo);

    return {
      ...tokens,
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        isPlatformAdmin: true,
      },
    };
  }

  // Roles ที่ห้ามเข้าผ่าน /auth/login (ต้องใช้ /auth/admin/login เท่านั้น)
  private readonly ADMIN_ONLY_ROLES = ['platform_admin', 'super_admin', 'admin'];

  async login(
    loginDto: LoginDto,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    systemContext: 'main' | 'pos' = 'main',
  ) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is suspended or inactive');
    }

    // บล็อก admin-level roles จากการ login ผ่าน /auth/login
    if (this.ADMIN_ONLY_ROLES.includes(user.role)) {
      throw new UnauthorizedException(
        'Admin accounts cannot login through this endpoint. Use /api/v1/auth/admin/login instead.',
      );
    }

    // ── System Access Control ────────────────────────────────────────────────
    // Validate that this user is allowed to log into the requested system
    const allowedSystemsRaw = (user as any).allowedSystems as string | undefined;
    if (allowedSystemsRaw) {
      try {
        const allowed: string[] = JSON.parse(allowedSystemsRaw);
        if (!allowed.includes(systemContext)) {
          throw new UnauthorizedException(
            systemContext === 'pos'
              ? 'This account is not authorized to access the POS system. Please use a POS staff account.'
              : 'This account is not authorized to access the management dashboard.',
          );
        }
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        // JSON parse error — allow through (DB migration may not have run yet)
        this.logger.warn(`Could not parse allowedSystems for user ${user.id}: ${allowedSystemsRaw}`);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Determine tenantId: prefer user.tenantId, fallback to default from UserTenant table
    let tenantId = user.tenantId ?? undefined;
    if (!tenantId) {
      // If user doesn't have active tenantId, try to load from UserTenant table
      const userTenant = await (this.prisma as any).userTenant
        .findFirst({
          where: {
            userId: user.id,
            isDefault: true,
          },
        })
        .catch(() => null);

      if (userTenant) {
        tenantId = userTenant.tenantId;
      }
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role, tenantId, 'user', deviceInfo, systemContext);

    // Resolve default property for this tenant so frontend has the correct propertyId
    let defaultProperty: { id: string; name: string; code: string } | undefined;
    if (tenantId) {
      const property = await this.prisma.property.findFirst({
        where: { tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, code: true },
      });
      if (property) {
        defaultProperty = property;
      }
    }

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: tenantId,
        defaultPropertyId: defaultProperty?.id ?? null,
        isPlatformAdmin: false,
      },
      property: defaultProperty ?? null,
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    // Find refresh token in database
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: true,
        admin: true,
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if token is expired
    if (new Date() > tokenRecord.expiresAt) {
      // Delete expired token
      await this.prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Check if token is revoked
    if (tokenRecord.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const account = tokenRecord.admin || tokenRecord.user;
    if (!account) {
      throw new UnauthorizedException('Account not found');
    }

    const userType = tokenRecord.adminId ? 'admin' : 'user';
    let tenantId: string | undefined;

    if (userType === 'user' && tokenRecord.user) {
      // Determine tenantId for user: prefer user.tenantId, fallback to default from UserTenant table
      tenantId = tokenRecord.user.tenantId ?? undefined;
      if (!tenantId) {
        // If user doesn't have active tenantId, try to load from UserTenant table
        const userTenant = await (this.prisma as any).userTenant
          .findFirst({
            where: {
              userId: tokenRecord.user.id,
              isDefault: true,
            },
          })
          .catch(() => null);

        if (userTenant) {
          tenantId = userTenant.tenantId;
        }
      }
    }

    // Carry forward the systemContext from the original token
    const systemContext = ((tokenRecord as any).systemContext as 'main' | 'pos') ?? 'main';

    // Generate new tokens
    const tokens = await this.generateTokens(
      account.id,
      account.email,
      account.role,
      tenantId,
      userType,
      undefined,
      systemContext,
    );

    // Revoke old refresh token + stamp lastUsedAt
    // NOTE: lastUsedAt is a new column — will resolve after `npm run db:refresh` (prisma generate)
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() } as any,
    });

    // Resolve default property for this tenant
    let defaultProperty: { id: string; name: string; code: string } | undefined;
    if (tenantId) {
      const property = await this.prisma.property.findFirst({
        where: { tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, code: true },
      });
      if (property) {
        defaultProperty = property;
      }
    }

    return {
      ...tokens,
      defaultPropertyId: defaultProperty?.id ?? null,
      property: defaultProperty ?? null,
    };
  }

  async logout(
    userIdOrAdminId: string,
    refreshToken?: string,
    systemContext?: 'main' | 'pos',
  ) {
    if (refreshToken) {
      // Revoke the specific refresh token
      // If systemContext provided, also filter by it (prevents cross-system token revocation)
      await this.prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          OR: [{ userId: userIdOrAdminId }, { adminId: userIdOrAdminId }],
          ...(systemContext ? { systemContext } as any : {}),
        },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke ALL active tokens for this user, scoped to a system if specified
      // This ensures POS logout does NOT revoke main-dashboard tokens
      await this.prisma.refreshToken.updateMany({
        where: {
          OR: [{ userId: userIdOrAdminId }, { adminId: userIdOrAdminId }],
          revokedAt: null,
          ...(systemContext ? { systemContext } as any : {}),
        },
        data: { revokedAt: new Date() },
      });
    }
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if user exists for security
      return { message: 'If an account with that email exists, a reset link has been sent.' };
    }

    // Generate token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

    // Save to database
    await this.prisma.password_resets.create({
      data: {
        email,
        token,
        expiresAt,
      },
    });

    // Send password reset email
    this.emailEventsService
      .onPasswordResetRequested(email, token, user.firstName || 'User')
      .catch((err) => {
        this.logger.error(`Failed to send password reset email: ${err.message}`);
      });

    return {
      message: 'If an account with that email exists, a reset link has been sent.',
      token: process.env.NODE_ENV === 'development' ? token : undefined, // Only return token in dev
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const resetRecord = await this.prisma.password_resets.findUnique({
      where: { token },
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await this.prisma.user.update({
      where: { email: resetRecord.email },
      data: { password: hashedPassword },
    });

    // Delete the used token
    await this.prisma.password_resets.delete({
      where: { id: resetRecord.id },
    });

    return { message: 'Password has been reset successfully' };
  }

  // ─── POS Integration ────────────────────────────────────────────────────────

  /**
   * Create a POS user account for an employee.
   * Only tenant_admin / manager / platform_admin can call this.
   * The new User is scoped to the same tenantId as the caller.
   */
  async createPosUser(dto: CreatePosUserDto, callerTenantId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(`A user with email "${dto.email}" already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Determine allowedSystems based on role:
    // - Managers can access both main dashboard and POS
    // - Operational POS staff (waiter, chef, cashier, kitchen_staff) → POS only
    const POS_ONLY_ROLES = ['waiter', 'chef', 'cashier', 'kitchen_staff'];
    const allowedSystems = POS_ONLY_ROLES.includes(dto.role)
      ? '["pos"]'
      : '["main","pos"]';

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        role: dto.role,
        tenantId: callerTenantId,
        employeeId: dto.employeeId ?? null,
        status: 'active',
        allowedSystems,
      } as any,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        employeeId: true,
        status: true,
        createdAt: true,
      },
    });

    this.logger.log(
      `POS user created: ${user.email} (role: ${user.role}, systems: ${allowedSystems}) in tenant ${callerTenantId}`,
    );
    return { success: true, data: user };
  }

  /**
   * List all POS users for a tenant (excludes tenant_admin / platform_admin).
   */
  async listPosUsers(callerTenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: callerTenantId,
        role: { notIn: ['tenant_admin', 'platform_admin', 'admin'] },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        employeeId: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: users };
  }

  /**
   * Update a POS user (role, status, password reset).
   */
  async updatePosUser(
    userId: string,
    callerTenantId: string,
    dto: { role?: string; status?: string; password?: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: callerTenantId },
    });
    if (!user) {
      throw new BadRequestException('User not found or does not belong to your tenant');
    }

    const updateData: Record<string, unknown> = {};
    if (dto.role) updateData.role = dto.role;
    if (dto.status) updateData.status = dto.status;
    if (dto.password) updateData.password = await bcrypt.hash(dto.password, 10);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });
    return { success: true, data: updated };
  }

  /**
   * Generate a short-lived launch token so a manager can open the POS
   * pre-authenticated via deep-link: /pos?token=<jwt>&restaurantId=<id>
   *
   * The token expires in 5 minutes and carries a `posLaunch: true` flag
   * so the POS page can detect and auto-login without showing the login form.
   */
  async generatePosLaunchToken(
    dto: PosLaunchDto,
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    // Verify the restaurant belongs to caller's tenant
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: dto.restaurantId, tenantId: caller.tenantId },
      select: { id: true, name: true },
    });
    if (!restaurant) {
      throw new BadRequestException('Restaurant not found or does not belong to your account');
    }

    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: caller.role,
      tenantId: caller.tenantId,
      isPlatformAdmin: false,
      posLaunch: true,
      restaurantId: dto.restaurantId,
      tableId: dto.tableId ?? null,
      // IP binding — verified on POS page before auto-login
      originIp: originIp ?? null,
    };

    // Short-lived token — 5 minutes only
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });

    const posUrl = `/pos?token=${token}&restaurantId=${dto.restaurantId}${dto.tableId ? `&tableId=${dto.tableId}` : ''}`;

    this.logger.log(
      `POS launch token generated for restaurant "${restaurant.name}" by user ${caller.userId}`,
    );

    return {
      success: true,
      data: { token, posUrl, restaurantId: dto.restaurantId, expiresIn: 300 },
    };
  }

  // ────────────────────────────────────────────────────────────────────────────

  // ── Device fingerprint interface ─────────────────────────────────────────
  private parseDeviceType(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (/mobile|android|iphone|ipad/.test(ua)) {
      return /ipad|tablet/.test(ua) ? 'tablet' : 'mobile';
    }
    return 'desktop';
  }

  private buildDeviceName(userAgent: string): string {
    // Extract a human-readable name from User-Agent (best-effort)
    if (/iphone/i.test(userAgent)) return `iPhone — ${/safari/i.test(userAgent) ? 'Safari' : 'Browser'}`;
    if (/ipad/i.test(userAgent)) return `iPad — ${/safari/i.test(userAgent) ? 'Safari' : 'Browser'}`;
    if (/android/i.test(userAgent)) return `Android — ${/chrome/i.test(userAgent) ? 'Chrome' : 'Browser'}`;
    if (/windows/i.test(userAgent)) return `Windows — ${/chrome/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : /edge/i.test(userAgent) ? 'Edge' : 'Browser'}`;
    if (/macintosh|mac os/i.test(userAgent)) return `Mac — ${/chrome/i.test(userAgent) ? 'Chrome' : /safari/i.test(userAgent) ? 'Safari' : /firefox/i.test(userAgent) ? 'Firefox' : 'Browser'}`;
    if (/linux/i.test(userAgent)) return `Linux — ${/chrome/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : 'Browser'}`;
    return 'Unknown Device';
  }

  private async generateTokens(
    id: string,
    email: string,
    role: string,
    tenantId?: string,
    userType: 'admin' | 'user' = 'user',
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    systemContext: 'main' | 'pos' = 'main',
  ) {
    const payload = {
      sub: id,
      email,
      role,
      tenantId: tenantId ?? null,
      isPlatformAdmin: userType === 'admin',
      // Embed systemContext in the access token so guards can check it without a DB round-trip
      systemContext,
    };

    // Generate access token (short-lived)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '15m',
    });

    // Generate refresh token (long-lived)
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Build device fingerprint
    const ua = deviceInfo?.userAgent ?? '';
    const deviceName = ua ? this.buildDeviceName(ua) : null;
    const deviceType = ua ? this.parseDeviceType(ua) : null;

    // Store refresh token in database
    // NOTE: device fingerprint fields resolve after `npm run db:refresh` (prisma generate)
    try {
      await this.prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: userType === 'user' ? id : null,
          adminId: userType === 'admin' ? id : null,
          expiresAt,
          ipAddress: deviceInfo?.ipAddress ?? null,
          userAgent: ua || null,
          deviceName,
          deviceType,
          lastUsedAt: new Date(),
          lastUsedIp: deviceInfo?.ipAddress ?? null,
          systemContext,
        } as any,
      });
    } catch (error) {
      this.logger.error(
        `Error creating refresh token: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (
        error instanceof Error &&
        error.message?.includes('column') &&
        error.message?.includes('does not exist')
      ) {
        throw new Error(
          'Database schema mismatch: Please run "npm run db:refresh" to synchronize the database.',
        );
      }

      throw new BadRequestException('Could not create session. Please try again later.');
    }

    // Decode the access token to extract the exact expiration timestamp
    // so the frontend can schedule a proactive refresh before it expires.
    const decoded = this.jwtService.decode(accessToken) as { exp?: number } | null;
    const expiresAt_epoch = decoded?.exp ?? null;

    return {
      accessToken,
      expiresAt: expiresAt_epoch,
      refreshToken,
    };
  }
}
