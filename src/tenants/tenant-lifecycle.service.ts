import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStatus } from './entities/tenant.entity';

/**
 * State machine for tenant lifecycle.
 *
 *           ┌─────► past_due ─────► suspended ──┐
 *  trial ──►│                                   ├──► cancelled ──► archived
 *           └─────► active ──────► expired ─────┘            ▲
 *                       ▲                                    │
 *                       └────── reactivate ──────────────────┘
 *
 * Allowed transitions are explicit so we never silently push a tenant
 * into a state the rest of the system isn't ready for.
 */
const ALLOWED: Record<TenantStatus, TenantStatus[]> = {
  [TenantStatus.TRIAL]: [TenantStatus.ACTIVE, TenantStatus.EXPIRED, TenantStatus.CANCELLED],
  [TenantStatus.ACTIVE]: [TenantStatus.PAST_DUE, TenantStatus.SUSPENDED, TenantStatus.CANCELLED],
  [TenantStatus.PAST_DUE]: [TenantStatus.ACTIVE, TenantStatus.SUSPENDED, TenantStatus.CANCELLED],
  [TenantStatus.SUSPENDED]: [TenantStatus.ACTIVE, TenantStatus.CANCELLED],
  [TenantStatus.EXPIRED]: [TenantStatus.ACTIVE, TenantStatus.CANCELLED],
  [TenantStatus.CANCELLED]: [TenantStatus.ARCHIVED, TenantStatus.ACTIVE],
  [TenantStatus.ARCHIVED]: [],
};

export interface TransitionInput {
  tenantId: string;
  toStatus: TenantStatus;
  reason: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TenantLifecycleService {
  private readonly logger = new Logger(TenantLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transition a tenant to a new status. Throws BadRequestException if the
   * transition is not allowed by the state machine.
   */
  async transition(input: TransitionInput): Promise<{ id: string; status: TenantStatus }> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: input.tenantId },
      select: { id: true, status: true, name: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${input.tenantId} not found`);
    }

    const from = tenant.status as TenantStatus;
    const to = input.toStatus;

    if (from === to) {
      // Idempotent — return current state without writing.
      return { id: tenant.id, status: from };
    }

    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Cannot transition tenant from "${from}" to "${to}". ` +
          `Allowed: [${ALLOWED[from]?.join(', ') || 'none'}]`,
      );
    }

    await this.prisma.tenants.update({
      where: { id: tenant.id },
      data: { status: to as any, updated_at: new Date() },
    });

    this.logger.log(
      `Tenant ${tenant.name} (${tenant.id}): ${from} -> ${to} ` +
        `(reason: ${input.reason}, by: ${input.actorId || 'system'})`,
    );

    // Hook point: emit event for audit-log + notifications
    // EventEmitter2 wiring is left to the caller's module to avoid
    // circular import with audit-log/email modules.

    return { id: tenant.id, status: to };
  }

  canTransition(from: TenantStatus, to: TenantStatus): boolean {
    return (ALLOWED[from] || []).includes(to);
  }

  /** Convenience: must-be-active guard helper for downstream services. */
  isOperational(status: TenantStatus): boolean {
    return status === TenantStatus.TRIAL || status === TenantStatus.ACTIVE;
  }

  /**
   * Convenience: a tenant in past_due can still log in and pay their bill,
   * but suspended/expired/cancelled cannot reach feature endpoints.
   */
  isReadOnly(status: TenantStatus): boolean {
    return status === TenantStatus.PAST_DUE;
  }
}
