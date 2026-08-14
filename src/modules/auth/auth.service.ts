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
import { AuthErrors } from './auth-errors';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

// Default permissions granted to a hotel_manager when launching the Hotel
// Management Terminal via SSO. Front-desk / housekeeper / maintenance staff
// receive a narrower set stored on the user record (hotelTerminalPermissions).
const HOTEL_MANAGER_PERMISSIONS = [
  'property.view',
  'property.manage',
  'rooms.view',
  'rooms.manage',
  'frontdesk.view',
  'frontdesk.manage',
  'bookings.view',
  'bookings.manage',
  'guests.view',
  'guests.manage',
  'housekeeping.view',
  'housekeeping.manage',
  'maintenance.view',
  'maintenance.manage',
];

const ACCOUNTING_MANAGER_PERMISSIONS = [
  'coa.view',
  'coa.manage',
  'journal.view',
  'journal.manage',
  'journal.post',
  'ar.view',
  'ar.manage',
  'ap.view',
  'ap.manage',
  'ap.approve',
  'ledger.view',
  'audit.run',
  'audit.view',
  'cash.view',
  'cash.manage',
  'asset.view',
  'asset.manage',
  'report.accounting',
];

const HR_MANAGER_PERMISSIONS = [
  'employee.view',
  'employee.manage',
  'attendance.view',
  'attendance.manage',
  'leave.view',
  'leave.approve',
  'payroll.view',
  'payroll.run',
  'payroll.approve',
  'kpi.view',
  'kpi.manage',
  'evaluation.view',
  'evaluation.manage',
  'report.view',
  'report.export',
  'user.manage',
];

/**
 * Claims carried by the short-lived deep-link launch tokens minted by the
 * `/auth/<system>-launch` endpoints. Only `sub` is common to all of them —
 * everything else is whatever that particular terminal needs on open.
 */
interface LaunchTokenClaims {
  sub?: string;
  email?: string;
  role?: string;
  tenantId?: string;
  permissions?: string[];
  posLaunch?: boolean;
  purchasingLaunch?: boolean;
  hotelTerminalLaunch?: boolean;
  restaurantId?: string | null;
  tableId?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
}

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

  async register(
    registerDto: RegisterDto,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
    const { email, password, firstName, lastName, hotelName, hotelAddress, hotelPhone } =
      registerDto;
    const system = registerDto.system ?? 'HOTEL';

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      this.logger.warn(`Register failed: email ${email} already exists`);
      throw AuthErrors.emailAlreadyExists(email);
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
    const tenantName =
      hotelName || `${firstName}'s ${system === 'CAMP' ? 'Campground' : 'Hotel'}`;

    try {
      onboardingResult = await this.onboardingService.registerHotel(
        {
          name: tenantName,
          address: hotelAddress,
          phone: hotelPhone,
          email: email,
        },
        14, // 14-day trial
        system, // decides which free-trial plan is granted (FREE vs CAMP_FREE)
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

    // Registration hands back a live session, so the owner is signed in from this
    // moment — without this the brand-new account reads "never signed in".
    await this.recordLogin('user', user.id, deviceInfo);

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
            system: onboardingResult.system,
            plan: onboardingResult.plan,
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
      this.logger.warn(`Admin login failed: no admin with email ${email}`);
      throw AuthErrors.invalidCredentials();
    }

    if (admin.status !== 'active') {
      this.logger.warn(`Admin login blocked: ${email} status=${admin.status}`);
      throw AuthErrors.accountSuspended();
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      this.logger.warn(`Admin login failed: bad password for ${email}`);
      throw AuthErrors.invalidCredentials();
    }

    const tokens = await this.generateTokens(
      admin.id,
      admin.email,
      admin.role,
      undefined,
      'admin',
      deviceInfo,
    );

    await this.recordLogin('admin', admin.id, deviceInfo);

    return {
      ...tokens,
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        isPlatformAdmin: true,
        // null/empty array => admin can access every menu
        menuAccess: ((admin as { menuAccess?: unknown }).menuAccess as string[] | null) ?? null,
      },
    };
  }

  // Roles ที่ห้ามเข้าผ่าน /auth/login (ต้องใช้ /auth/admin/login เท่านั้น)
  private readonly ADMIN_ONLY_ROLES = ['platform_admin', 'admin'];

  async login(
    loginDto: LoginDto,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr' = 'main',
  ) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      this.logger.warn(`Login failed: no user with email ${email}`);
      throw AuthErrors.invalidCredentials();
    }

    // ── Lifecycle gate ────────────────────────────────────────────────────────
    // ถ้า expiresAt ผ่านไปแล้ว → ตั้ง status = expired ทันที (lazy-expire)
    // as any: Prisma type อาจยังไม่ sync หลัง schema migration
    const userExpiresAt = (user as any).expiresAt as Date | null | undefined;
    if (userExpiresAt && userExpiresAt.getTime() <= Date.now() && user.status !== 'expired') {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { status: 'expired' },
        });
        user.status = 'expired';
      } catch (err) {
        this.logger.warn(
          `Failed to lazy-expire user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (user.status !== 'active') {
      this.logger.warn(`Login blocked: ${email} status=${user.status}`);
      switch (user.status) {
        case 'suspended':
          throw AuthErrors.accountSuspended();
        case 'expired':
          throw AuthErrors.accountExpired();
        case 'inactive':
          throw AuthErrors.accountInactive();
        default:
          throw AuthErrors.accountNotActive();
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // บล็อก admin-level roles จากการ login ผ่าน /auth/login
    if (this.ADMIN_ONLY_ROLES.includes(user.role)) {
      this.logger.warn(`Login blocked: ${email} is admin-level role=${user.role}`);
      throw AuthErrors.adminEndpointOnly();
    }

    // ── System Access Control ────────────────────────────────────────────────
    // Validate that this user is allowed to log into the requested system
    const allowedSystemsRaw = (user as any).allowedSystems as string | undefined;
    if (allowedSystemsRaw) {
      try {
        const allowed: string[] = JSON.parse(allowedSystemsRaw);
        if (!allowed.includes(systemContext)) {
          this.logger.warn(
            `Login blocked: ${email} not authorized for system=${systemContext} (allowed=${allowed.join(',')})`,
          );
          throw AuthErrors.notAuthorizedForSystem(systemContext);
        }
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        // JSON parse error — allow through (DB migration may not have run yet)
        this.logger.warn(
          `Could not parse allowedSystems for user ${user.id}: ${allowedSystemsRaw}`,
        );
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed: bad password for ${email}`);
      throw AuthErrors.invalidCredentials();
    }

    // ── Two-Factor Authentication gate ────────────────────────────────────────
    // If the user has 2FA enabled, do NOT issue session tokens yet. Instead
    // return a short-lived tempToken; the client must call POST /auth/2fa/validate
    // (or /verify-backup) with this token + a TOTP/backup code to complete login.
    const twoFactor = await this.prisma.user2FASettings
      .findUnique({ where: { userId: user.id } })
      .catch(() => null);

    if (twoFactor?.isEnabled) {
      const tempToken = this.generateTempToken(user.id, user.email, systemContext);
      this.logger.log(`Login requires 2FA for user ${user.id}`);
      return {
        requires2FA: true,
        tempToken,
        email: user.email,
      };
    }
    // ──────────────────────────────────────────────────────────────────────────

    return this.buildLoginResponse(user, systemContext, deviceInfo);
  }

  /**
   * Complete a login that was gated by 2FA. Called after the TOTP / backup code
   * has been verified. Re-loads the user, runs the same lifecycle + system-access
   * checks as login(), then issues real session tokens.
   */
  async completeLoginWith2FA(
    userId: string,
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr' = 'main',
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
    // findFirst (not findUnique): `User` is tenant-scoped. findUnique is rejected
    // by the TenantScope middleware when a tenant context is active; findFirst
    // lets the middleware inject tenantId (and is a no-op when no context is set).
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw AuthErrors.invalidCredentials();
    }

    if (user.status !== 'active') {
      this.logger.warn(`2FA login blocked: ${user.email} status=${user.status}`);
      switch (user.status) {
        case 'suspended':
          throw AuthErrors.accountSuspended();
        case 'expired':
          throw AuthErrors.accountExpired();
        case 'inactive':
          throw AuthErrors.accountInactive();
        default:
          throw AuthErrors.accountNotActive();
      }
    }

    return this.buildLoginResponse(user, systemContext, deviceInfo);
  }

  /**
   * Stamp "last seen" on the account that just authenticated.
   *
   * Every read path (admin user list, POS staff list, the per-terminal user
   * services) already surfaces `lastLoginAt`, but nothing ever wrote it — so the
   * column stayed NULL for every account and the console showed "ยังไม่เคยเข้าระบบ"
   * next to people who log in daily.
   *
   * Only credential logins land here. Refreshing a token, exchanging a launch
   * deep-link, or an admin impersonating someone are not the account holder
   * signing in and must not move this date.
   *
   * Failure is swallowed on purpose: a bookkeeping write must never be the reason
   * a valid login is rejected.
   */
  private async recordLogin(
    account: 'user' | 'admin',
    id: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const data = {
      lastLoginAt: new Date(),
      // `req.ip` is undefined behind some proxies; keep whatever was there before
      // rather than blanking a known address with an unknown one.
      ...(deviceInfo?.ipAddress ? { lastLoginIp: deviceInfo.ipAddress } : {}),
    };

    try {
      if (account === 'admin') {
        await this.prisma.admin.update({ where: { id }, data });
      } else {
        await this.prisma.user.update({ where: { id }, data });
      }
    } catch (err) {
      this.logger.warn(
        `Could not stamp lastLoginAt on ${account} ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Build the full login success payload (tokens + user object + property) for a
   * validated user. Shared by login() and completeLoginWith2FA().
   */
  private async buildLoginResponse(
    user: any,
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr',
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
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

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      tenantId,
      'user',
      deviceInfo,
      systemContext,
    );

    // Every credential login for every system funnels through here — main
    // dashboard, all six terminals, and the 2FA completion path.
    await this.recordLogin('user', user.id, deviceInfo);

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

    // ── Procurement-specific fields ─────────────────────────────────────────
    // Include extra procurement metadata when logging in via the purchasing terminal
    const procurementFields =
      systemContext === 'procurement'
        ? {
            employeeId: (user as any).employeeId ?? null,
            approvalLimit:
              (user as any).approvalLimit != null ? Number((user as any).approvalLimit) : null,
            permissions: (() => {
              try {
                const raw = (user as any).procurementPermissions;
                return raw ? JSON.parse(raw) : [];
              } catch {
                return [];
              }
            })(),
            propertyName: defaultProperty?.name ?? null,
          }
        : {};

    // ── Warehouse-specific fields ───────────────────────────────────────────
    // Include warehouse metadata when logging in via the warehouse terminal
    const warehouseFields =
      systemContext === 'warehouse'
        ? {
            employeeId: (user as any).employeeId ?? null,
            warehouseIds: (() => {
              try {
                const raw = (user as any).warehouseIds;
                return raw ? JSON.parse(raw) : [];
              } catch {
                return [];
              }
            })(),
            permissions: (() => {
              try {
                const raw = (user as any).warehousePermissions;
                return raw ? JSON.parse(raw) : [];
              } catch {
                return [];
              }
            })(),
            propertyName: defaultProperty?.name ?? null,
          }
        : {};

    // ── Hotel Terminal–specific fields ──────────────────────────────────────
    // Include hotel terminal metadata (permissions, property linkage) when
    // logging in via /auth/hotel-terminal/login.
    const hotelTerminalFields =
      systemContext === 'hotel-terminal'
        ? {
            employeeId: (user as any).employeeId ?? null,
            permissions: (() => {
              try {
                const raw = (user as any).hotelTerminalPermissions;
                return raw ? JSON.parse(raw) : HOTEL_MANAGER_PERMISSIONS;
              } catch {
                return HOTEL_MANAGER_PERMISSIONS;
              }
            })(),
            propertyId: defaultProperty?.id ?? null,
            propertyName: defaultProperty?.name ?? null,
          }
        : {};

    // ── HR Terminal–specific fields ─────────────────────────────────────────
    // Include HR metadata (permissions, property linkage) when logging in via
    // /auth/hr/login. Permissions reuse the warehousePermissions column
    // (same convention as accounting-users / hr-terminal-users).
    const hrTerminalFields =
      systemContext === 'hr'
        ? {
            employeeId: (user as any).employeeId ?? null,
            permissions: (() => {
              try {
                const raw = (user as any).warehousePermissions;
                return raw ? JSON.parse(raw) : HR_MANAGER_PERMISSIONS;
              } catch {
                return HR_MANAGER_PERMISSIONS;
              }
            })(),
            propertyId: defaultProperty?.id ?? null,
            propertyName: defaultProperty?.name ?? null,
          }
        : {};

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
        ...procurementFields,
        ...warehouseFields,
        ...hotelTerminalFields,
        ...hrTerminalFields,
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
      throw AuthErrors.refreshTokenInvalid();
    }

    // Check if token is expired
    if (new Date() > tokenRecord.expiresAt) {
      // Delete expired token
      await this.prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      });
      throw AuthErrors.refreshTokenExpired();
    }

    // Check if token is revoked
    if (tokenRecord.revokedAt) {
      throw AuthErrors.refreshTokenRevoked();
    }

    const account = tokenRecord.admin || tokenRecord.user;
    if (!account) {
      throw AuthErrors.accountNotFound();
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
    const systemContext =
      ((tokenRecord as any).systemContext as
        | 'main'
        | 'pos'
        | 'procurement'
        | 'warehouse'
        | 'hotel-terminal'
        | 'accounting'
        | 'hr') ?? 'main';

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
    systemContext?:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr',
  ) {
    if (refreshToken) {
      // Revoke the specific refresh token
      // If systemContext provided, also filter by it (prevents cross-system token revocation)
      await this.prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          OR: [{ userId: userIdOrAdminId }, { adminId: userIdOrAdminId }],
          ...(systemContext ? ({ systemContext } as any) : {}),
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
          ...(systemContext ? ({ systemContext } as any) : {}),
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
      throw AuthErrors.resetTokenInvalid();
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
      throw AuthErrors.emailAlreadyExists(dto.email);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Determine allowedSystems based on role:
    // - Managers can access both main dashboard and POS
    // - Operational POS staff (waiter, chef, cashier, kitchen_staff) → POS only
    const POS_ONLY_ROLES = ['waiter', 'chef', 'cashier', 'kitchen_staff'];
    const allowedSystems = POS_ONLY_ROLES.includes(dto.role) ? '["pos"]' : '["main","pos"]';

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

  /**
   * Front half of every "trade the deep-link token for a session" call.
   *
   * A launch token lives 5 minutes and carries no refresh token, so a terminal
   * that kept it *as* its session went dead a few minutes in: every poll started
   * to 401 and the staff were thrown back to the login screen. The dashboard has
   * already authorised the hand-off (each /auth/*-launch endpoint needs a live
   * session), so all that is left here is to prove the token really is a launch
   * token of the expected kind and that the account is still usable.
   */
  private async openLaunchToken(
    token: string,
    claimFlag: 'posLaunch' | 'purchasingLaunch' | 'hotelTerminalLaunch',
    systemLabel: string,
  ): Promise<{ claims: LaunchTokenClaims; user: any }> {
    let claims: LaunchTokenClaims;
    try {
      claims = this.jwtService.verify(token);
    } catch {
      // Expired or tampered with — the manager just needs to press the button again.
      throw new UnauthorizedException(`${systemLabel} launch link is invalid or has expired`);
    }

    // Refuse an ordinary access token: only the matching launch claim qualifies,
    // so a POS link can never be traded for a purchasing session and vice versa.
    if (!claims?.[claimFlag] || !claims.sub) {
      this.logger.warn(`${systemLabel} launch exchange rejected: token is not a ${claimFlag} token`);
      throw new UnauthorizedException(`${systemLabel} launch link is invalid or has expired`);
    }

    // findFirst (not findUnique): `User` is tenant-scoped — see completeLoginWith2FA.
    const user = await this.prisma.user.findFirst({ where: { id: claims.sub } });
    if (!user) {
      throw AuthErrors.accountNotFound();
    }

    // The account may have been suspended in the 5 minutes since the link was made.
    if (user.status !== 'active') {
      this.logger.warn(`${systemLabel} launch exchange blocked: ${user.email} status=${user.status}`);
      switch (user.status) {
        case 'suspended':
          throw AuthErrors.accountSuspended();
        case 'expired':
          throw AuthErrors.accountExpired();
        case 'inactive':
          throw AuthErrors.accountInactive();
        default:
          throw AuthErrors.accountNotActive();
      }
    }

    return { claims, user };
  }

  /**
   * Trade a deep-link launch token for a real POS session.
   *
   * The dashboard already checked the restaurant belongs to the caller's tenant
   * when it minted the link, so this mints the same session /auth/pos/login
   * would and hands back the restaurant/table the link pointed at.
   */
  async exchangePosLaunchToken(
    token: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
    const { claims, user } = await this.openLaunchToken(token, 'posLaunch', 'POS');

    const session = await this.buildLoginResponse(user, 'pos', deviceInfo);

    this.logger.log(`POS launch token exchanged for a session by user ${user.id}`);

    return {
      ...session,
      restaurantId: claims.restaurantId ?? null,
      tableId: claims.tableId ?? null,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a short-lived launch token so a manager can open the Purchasing
   * terminal pre-authenticated: /purchasing?token=<jwt>
   */
  async generatePurchasingLaunchToken(
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: 'procurement_manager',
      tenantId: caller.tenantId,
      purchasingLaunch: true,
      firstName: null,
      lastName: null,
      permissions: [
        'pr.create',
        'pr.view',
        'pr.approve',
        'rfq.create',
        'rfq.view',
        'quote.compare',
        'po.create',
        'po.view',
        'po.approve',
        'supplier.view',
        'supplier.manage',
        'grn.create',
        'grn.view',
        'qc.inspect',
        'qc.view',
        'report.view',
        'user.manage',
        'approval-flow.manage',
      ],
      originIp: originIp ?? null,
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    const launchUrl = `/purchasing?token=${token}`;
    this.logger.log(`Purchasing launch token generated by user ${caller.userId}`);
    return { success: true, data: { token, launchUrl, expiresIn: 300 } };
  }

  /**
   * Trade a purchasing deep-link token for a real procurement session.
   *
   * Same fix as the POS: the terminal used to keep the 5-minute launch token as
   * its session and died once it expired. It now gets access + refresh tagged
   * systemContext="procurement", which /auth/refresh can renew all day.
   *
   * The launch token also *elevates* the caller to procurement_manager with the
   * full permission set, and the purchasing shell reads exactly those two fields
   * to decide which menu items to show. So they are carried over onto the
   * returned user — but only there. The access token itself is minted from the
   * account's real role, like every other session, because /auth/refresh rebuilds
   * tokens from the database and would drop a forged role at the first renewal
   * anyway. In practice this changes nothing for the tenant admins and managers
   * who open the terminal (every procurement route already accepts those roles);
   * an account below that level now gets menus its token cannot actually use,
   * instead of a genuinely elevated token.
   */
  async exchangePurchasingLaunchToken(
    token: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
    const { claims, user } = await this.openLaunchToken(token, 'purchasingLaunch', 'Purchasing');

    const session = await this.buildLoginResponse(user, 'procurement', deviceInfo);

    this.logger.log(`Purchasing launch token exchanged for a session by user ${user.id}`);

    return {
      ...session,
      user: {
        ...session.user,
        role: claims.role ?? session.user.role,
        permissions: claims.permissions?.length
          ? claims.permissions
          : (session.user as { permissions?: string[] }).permissions ?? [],
      },
    };
  }

  /**
   * Generate a short-lived launch token so a manager can open the Warehouse
   * terminal pre-authenticated: /inventory?token=<jwt>
   */
  async generateWarehouseLaunchToken(
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: 'warehouse_manager',
      tenantId: caller.tenantId,
      warehouseLaunch: true,
      firstName: null,
      lastName: null,
      permissions: [
        'item.view',
        'item.manage',
        'warehouse.view',
        'warehouse.manage',
        'gr.create',
        'gr.view',
        'gr.receive',
        'movement.create',
        'movement.view',
        'qc.inspect',
        'qc.view',
        'lot.manage',
        'lot.view',
        'stock.view',
        'stock.adjust',
        'stock.count',
        'report.view',
        'forecast.view',
        'user.manage',
      ],
      originIp: originIp ?? null,
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    const launchUrl = `/inventory?token=${token}`;
    this.logger.log(`Warehouse launch token generated by user ${caller.userId}`);
    return { success: true, data: { token, launchUrl, expiresIn: 300 } };
  }

  /**
   * Generate a short-lived launch token so a manager can open the Hotel
   * Management Terminal pre-authenticated: /hotel-terminal?token=<jwt>
   *
   * The user is logged in as `hotel_manager` (highest level) and receives the
   * full permission set so they can navigate every menu item.
   */
  async generateHotelTerminalLaunchToken(
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    // Resolve default property so the terminal header can show "Property: ..."
    let property: { id: string; name: string } | null = null;
    if (caller.tenantId) {
      property = await this.prisma.property.findFirst({
        where: { tenantId: caller.tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true },
      });
    }

    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: 'hotel_manager',
      tenantId: caller.tenantId,
      hotelTerminalLaunch: true,
      firstName: null,
      lastName: null,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
      permissions: HOTEL_MANAGER_PERMISSIONS,
      originIp: originIp ?? null,
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    const launchUrl = `/hotel-terminal?token=${token}`;
    this.logger.log(`Hotel Terminal launch token generated by user ${caller.userId}`);
    return { success: true, data: { token, launchUrl, expiresIn: 300 } };
  }

  /**
   * Trade a hotel-terminal deep-link token for a real terminal session.
   *
   * Mirrors exchangePurchasingLaunchToken — see the note there on why the role
   * and permissions the link granted ride along on the user object while the
   * access token is minted from the account's real role. The property the link
   * resolved is passed through so the terminal header keeps showing it even if
   * the tenant's default property changes mid-session.
   */
  async exchangeHotelTerminalLaunchToken(
    token: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
  ) {
    const { claims, user } = await this.openLaunchToken(
      token,
      'hotelTerminalLaunch',
      'Hotel Terminal',
    );

    const session = await this.buildLoginResponse(user, 'hotel-terminal', deviceInfo);
    const sessionUser = session.user as {
      permissions?: string[];
      propertyId?: string | null;
      propertyName?: string | null;
    };

    this.logger.log(`Hotel Terminal launch token exchanged for a session by user ${user.id}`);

    return {
      ...session,
      user: {
        ...session.user,
        role: claims.role ?? session.user.role,
        permissions: claims.permissions?.length
          ? claims.permissions
          : sessionUser.permissions ?? HOTEL_MANAGER_PERMISSIONS,
        propertyId: sessionUser.propertyId ?? claims.propertyId ?? null,
        propertyName: sessionUser.propertyName ?? claims.propertyName ?? null,
      },
    };
  }

  /**
   * Generate a short-lived launch token for Accounting terminal: /accounting?token=<jwt>
   */
  async generateAccountingLaunchToken(
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    // Resolve default property
    let property: { id: string; name: string } | null = null;
    if (caller.tenantId) {
      property = await this.prisma.property.findFirst({
        where: { tenantId: caller.tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true },
      });
    }

    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: 'accounting_manager',
      tenantId: caller.tenantId,
      accountingLaunch: true,
      firstName: null,
      lastName: null,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
      permissions: ACCOUNTING_MANAGER_PERMISSIONS,
      originIp: originIp ?? null,
      systemContext: 'accounting',
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    const launchUrl = `/accounting?token=${token}`;
    this.logger.log(`Accounting launch token generated by user ${caller.userId}`);
    return { success: true, data: { token, launchUrl, expiresIn: 300 } };
  }

  /**
   * Generate a short-lived launch token for HR terminal: /hr?token=<jwt>
   */
  async generateHrLaunchToken(
    caller: { userId: string; email: string; role: string; tenantId: string },
    originIp?: string,
  ) {
    // Resolve default property
    let property: { id: string; name: string } | null = null;
    if (caller.tenantId) {
      property = await this.prisma.property.findFirst({
        where: { tenantId: caller.tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true },
      });
    }

    const payload = {
      sub: caller.userId,
      email: caller.email,
      role: 'hr_manager',
      tenantId: caller.tenantId,
      hrLaunch: true,
      firstName: null,
      lastName: null,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
      permissions: HR_MANAGER_PERMISSIONS,
      originIp: originIp ?? null,
      systemContext: 'hr',
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    const launchUrl = `/hr?token=${token}`;
    this.logger.log(`HR launch token generated by user ${caller.userId}`);
    return { success: true, data: { token, launchUrl, expiresIn: 300 } };
  }

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
    if (/iphone/i.test(userAgent))
      return `iPhone — ${/safari/i.test(userAgent) ? 'Safari' : 'Browser'}`;
    if (/ipad/i.test(userAgent))
      return `iPad — ${/safari/i.test(userAgent) ? 'Safari' : 'Browser'}`;
    if (/android/i.test(userAgent))
      return `Android — ${/chrome/i.test(userAgent) ? 'Chrome' : 'Browser'}`;
    if (/windows/i.test(userAgent))
      return `Windows — ${/chrome/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : /edge/i.test(userAgent) ? 'Edge' : 'Browser'}`;
    if (/macintosh|mac os/i.test(userAgent))
      return `Mac — ${/chrome/i.test(userAgent) ? 'Chrome' : /safari/i.test(userAgent) ? 'Safari' : /firefox/i.test(userAgent) ? 'Firefox' : 'Browser'}`;
    if (/linux/i.test(userAgent))
      return `Linux — ${/chrome/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : 'Browser'}`;
    return 'Unknown Device';
  }

  /**
   * Sign a short-lived (5 min) temporary token used to bridge the gap between
   * password verification and 2FA code verification. Carries systemContext so
   * the completed login lands in the right system.
   */
  private generateTempToken(
    userId: string,
    email: string,
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr',
  ): string {
    return this.jwtService.sign(
      { sub: userId, email, type: '2fa_pending', systemContext },
      { expiresIn: '5m' },
    );
  }

  /**
   * Verify a 2fa_pending temp token. Returns the embedded claims or null.
   */
  verifyTempToken(token: string): {
    userId: string;
    email: string;
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr';
  } | null {
    try {
      const payload = this.jwtService.verify(token) as {
        sub: string;
        email: string;
        type?: string;
        systemContext?:
          | 'main'
          | 'pos'
          | 'procurement'
          | 'warehouse'
          | 'hotel-terminal'
          | 'accounting'
          | 'hr';
      };
      if (payload.type !== '2fa_pending') {
        return null;
      }
      return {
        userId: payload.sub,
        email: payload.email,
        systemContext: payload.systemContext ?? 'main',
      };
    } catch {
      return null;
    }
  }

  private async generateTokens(
    id: string,
    email: string,
    role: string,
    tenantId?: string,
    userType: 'admin' | 'user' = 'user',
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    systemContext:
      | 'main'
      | 'pos'
      | 'procurement'
      | 'warehouse'
      | 'hotel-terminal'
      | 'accounting'
      | 'hr' = 'main',
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

      throw AuthErrors.sessionCreateFailed();
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
