import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateStaffCallDto, CallSourceDto } from './dto/create-staff-call.dto';
import { AcknowledgeCallDto, ResolveCallDto } from './dto/update-staff-call.dto';
import { StaffCallGateway } from './staff-call.gateway';
import { LineNotifyEventsService } from '../../../line-notify/line-notify-events.service';

@Injectable()
export class StaffCallService {
  private readonly logger = new Logger(StaffCallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: StaffCallGateway,
    private readonly lineNotifyEvents: LineNotifyEventsService,
  ) {}

  // ─── Create a new staff call ─────────────────────────────────────────────────
  async create(tenantId: string, restaurantId: string, dto: CreateStaffCallDto) {
    // Validate table exists and belongs to this restaurant
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: dto.tableId, restaurantId },
    });

    if (!table) {
      throw new NotFoundException('Table not found in this restaurant');
    }

    // Check for duplicate pending call from same table + same type (prevent spam)
    const existingCall = await this.prisma.staffCall.findFirst({
      where: {
        tenantId,
        restaurantId,
        tableId: dto.tableId,
        callType: dto.callType ?? 'SERVICE',
        status: 'PENDING',
      },
    });

    if (existingCall) {
      throw new BadRequestException('A pending call of this type already exists for this table');
    }

    const call = await this.prisma.staffCall.create({
      data: {
        tenantId,
        restaurantId,
        tableId: dto.tableId,
        callType: dto.callType ?? 'SERVICE',
        source: dto.source ?? CallSourceDto.CUSTOMER,
        message: dto.message ?? null,
        customerName: dto.customerName ?? null,
        status: 'PENDING',
      },
      include: {
        table: { select: { tableNumber: true, zone: true } },
      },
    });

    this.logger.log(
      `Staff call created: ${call.id} (table ${table.tableNumber}, type ${call.callType})`,
    );

    // Emit real-time event to POS clients
    this.gateway.emitNewCall(tenantId, restaurantId, {
      ...call,
      tableNumber: call.table.tableNumber,
      zone: call.table.zone,
    });

    // Send LINE Notify to staff
    try {
      await this.lineNotifyEvents.onStaffCallCreated(tenantId, {
        tableNumber: table.tableNumber,
        zone: table.zone,
        callType: call.callType,
        message: call.message,
        customerName: call.customerName,
        source: call.source,
      });
    } catch (error) {
      this.logger.warn(`LINE Notify failed for staff call ${call.id}: ${error}`);
    }

    return call;
  }

  // ─── List active calls for a restaurant ──────────────────────────────────────
  async findActive(tenantId: string, restaurantId: string) {
    const calls = await this.prisma.staffCall.findMany({
      where: {
        tenantId,
        restaurantId,
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
      },
      include: {
        table: { select: { tableNumber: true, zone: true } },
      },
      orderBy: [
        { status: 'asc' }, // PENDING first
        { createdAt: 'asc' }, // oldest first
      ],
    });

    return calls;
  }

  // ─── List all calls with pagination ──────────────────────────────────────────
  async findAll(
    tenantId: string,
    restaurantId: string,
    params: {
      page?: number;
      limit?: number;
      status?: string;
      includeResolved?: boolean;
    },
  ) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId,
      restaurantId,
    };

    if (params.status) {
      where.status = params.status;
    } else if (!params.includeResolved) {
      where.status = { in: ['PENDING', 'ACKNOWLEDGED'] };
    }

    const [calls, total] = await Promise.all([
      this.prisma.staffCall.findMany({
        where,
        include: {
          table: { select: { tableNumber: true, zone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.staffCall.count({ where }),
    ]);

    return {
      data: calls,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Acknowledge a call (staff is on the way) ───────────────────────────────
  async acknowledge(
    tenantId: string,
    restaurantId: string,
    callId: string,
    dto: AcknowledgeCallDto,
  ) {
    const call = await this.findCallOrThrow(tenantId, restaurantId, callId);

    if (call.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING calls can be acknowledged');
    }

    const updated = await this.prisma.staffCall.update({
      where: { id: callId },
      data: {
        status: 'ACKNOWLEDGED',
        assignedToId: dto.staffId ?? null,
        assignedAt: new Date(),
      },
      include: {
        table: { select: { tableNumber: true, zone: true } },
      },
    });

    this.gateway.emitCallUpdated(tenantId, restaurantId, updated);

    return updated;
  }

  // ─── Resolve a call ──────────────────────────────────────────────────────────
  async resolve(tenantId: string, restaurantId: string, callId: string, dto: ResolveCallDto) {
    const call = await this.findCallOrThrow(tenantId, restaurantId, callId);

    if (call.status === 'RESOLVED' || call.status === 'CANCELLED') {
      throw new BadRequestException('Call is already resolved or cancelled');
    }

    const updated = await this.prisma.staffCall.update({
      where: { id: callId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: dto.staffId ?? null,
        resolution: dto.resolution ?? null,
      },
      include: {
        table: { select: { tableNumber: true, zone: true } },
      },
    });

    this.gateway.emitCallResolved(tenantId, restaurantId, updated);

    return updated;
  }

  // ─── Cancel a call ───────────────────────────────────────────────────────────
  async cancel(tenantId: string, restaurantId: string, callId: string) {
    const call = await this.findCallOrThrow(tenantId, restaurantId, callId);

    if (call.status === 'RESOLVED' || call.status === 'CANCELLED') {
      throw new BadRequestException('Call is already resolved or cancelled');
    }

    const updated = await this.prisma.staffCall.update({
      where: { id: callId },
      data: { status: 'CANCELLED' },
      include: {
        table: { select: { tableNumber: true, zone: true } },
      },
    });

    this.gateway.emitCallUpdated(tenantId, restaurantId, updated);

    return updated;
  }

  // ─── Resolve all pending/acknowledged calls for a restaurant ─────────────────
  async resolveAll(tenantId: string, restaurantId: string) {
    const result = await this.prisma.staffCall.updateMany({
      where: {
        tenantId,
        restaurantId,
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
    });

    this.gateway.emitAllResolved(tenantId, restaurantId);

    return { resolved: result.count };
  }

  // ─── Get call counts by status ───────────────────────────────────────────────
  async getCounts(tenantId: string, restaurantId: string) {
    const [pending, acknowledged, todayResolved] = await Promise.all([
      this.prisma.staffCall.count({
        where: { tenantId, restaurantId, status: 'PENDING' },
      }),
      this.prisma.staffCall.count({
        where: { tenantId, restaurantId, status: 'ACKNOWLEDGED' },
      }),
      this.prisma.staffCall.count({
        where: {
          tenantId,
          restaurantId,
          status: 'RESOLVED',
          resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return { pending, acknowledged, todayResolved, active: pending + acknowledged };
  }

  // ─── Public create (resolves tenantId from restaurant) ────────────────────────
  async createPublic(restaurantId: string, dto: CreateStaffCallDto) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { tenantId: true },
    });

    if (!restaurant || !restaurant.tenantId) {
      throw new NotFoundException('Restaurant not found');
    }

    return this.create(restaurant.tenantId, restaurantId, dto);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────
  private async findCallOrThrow(tenantId: string, restaurantId: string, callId: string) {
    const call = await this.prisma.staffCall.findFirst({
      where: { id: callId, tenantId, restaurantId },
    });

    if (!call) {
      throw new NotFoundException('Staff call not found');
    }

    return call;
  }
}
