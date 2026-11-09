import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

export type ImpersonationScope = 'read_only' | 'full';

export interface StartImpersonationInput {
  adminId: string;
  tenantId: string;
  reason: string;
  scope?: ImpersonationScope;
  ttlMinutes?: number; // default 15
  ipAddress?: string;
  userAgent?: string;
}

export interface ImpersonationToken {
  sessionId: string;
  token: string;
  expiresAt: string;
  scope: ImpersonationScope;
}

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly DEFAULT_TTL_MIN = 15;
  private readonly MAX_TTL_MIN = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Start an impersonation session. Issues a short-lived JWT carrying the
   * session id and the impersonator's identity. Caller (admin guard) is
   * responsible for verifying the actor is platform admin.
   */
  async start(input: StartImpersonationInput): Promise<ImpersonationToken> {
    if (!input.reason?.trim()) {
      throw new BadRequestException('reason is required');
    }
    const ttl = Math.min(input.ttlMinutes || this.DEFAULT_TTL_MIN, this.MAX_TTL_MIN);
    const scope: ImpersonationScope = input.scope || 'read_only';

    const tenant = await (this.prisma as any).tenants.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttl);

    const session = await (this.prisma as any).impersonation_sessions.create({
      data: {
        admin_id: input.adminId,
        target_tenant_id: input.tenantId,
        reason: input.reason.trim(),
        scope: scope as any,
        status: 'active' as any,
        expires_at: expiresAt,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
      },
    });

    const token = this.jwt.sign(
      {
        sub: input.adminId,
        tenant_id: input.tenantId,
        impersonator_id: input.adminId,
        impersonation_session_id: session.id,
        impersonation_scope: scope,
      },
      { expiresIn: `${ttl}m` },
    );

    this.logger.log(
      `Impersonation started: admin=${input.adminId} -> tenant=${input.tenantId} ` +
        `(scope=${scope}, ttl=${ttl}m, session=${session.id})`,
    );

    return {
      sessionId: session.id,
      token,
      expiresAt: expiresAt.toISOString(),
      scope,
    };
  }

  /** Mark a session as ended (admin clicked End Session). */
  async end(sessionId: string, adminId: string): Promise<void> {
    const session = await (this.prisma as any).impersonation_sessions.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Impersonation session not found');
    if (session.admin_id !== adminId) {
      throw new ForbiddenException('Only the originating admin can end this session');
    }
    if (session.status !== 'active') return;

    await (this.prisma as any).impersonation_sessions.update({
      where: { id: sessionId },
      data: { status: 'ended', ended_at: new Date() },
    });

    this.logger.log(`Impersonation ended: session=${sessionId}`);
  }

  /** List recent sessions (admin audit page). */
  async list(filters: {
    adminId?: string;
    tenantId?: string;
    status?: 'active' | 'ended' | 'expired';
    limit?: number;
  }): Promise<unknown[]> {
    return (this.prisma as any).impersonation_sessions.findMany({
      where: {
        ...(filters.adminId && { admin_id: filters.adminId }),
        ...(filters.tenantId && { target_tenant_id: filters.tenantId }),
        ...(filters.status && { status: filters.status as any }),
      },
      orderBy: { started_at: 'desc' },
      take: filters.limit || 50,
    });
  }

  /**
   * Verify that an impersonation session referenced in a JWT is still
   * usable. Called by the auth guard on each request that carries an
   * `impersonation_session_id` claim.
   */
  async assertActive(sessionId: string): Promise<{ scope: ImpersonationScope; tenantId: string }> {
    const session = await (this.prisma as any).impersonation_sessions.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new ForbiddenException('Unknown impersonation session');
    if (session.status !== 'active') {
      throw new ForbiddenException('Impersonation session has ended');
    }
    if (new Date(session.expires_at) < new Date()) {
      // Auto-expire
      await (this.prisma as any).impersonation_sessions.update({
        where: { id: sessionId },
        data: { status: 'expired', ended_at: new Date() },
      });
      throw new ForbiddenException('Impersonation session expired');
    }
    return {
      scope: session.scope as ImpersonationScope,
      tenantId: session.target_tenant_id,
    };
  }
}
