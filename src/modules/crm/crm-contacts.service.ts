import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto, QueryContactsDto, UpdateContactDto } from './dto/create-contact.dto';

/**
 * CRM Guest 360 service — manages CrmContact records that enrich the existing
 * Guest model with CRM-specific data (segment, RFM, LTV, tags).
 *
 * Multi-tenant: every query is scoped by tenantId.
 */
@Injectable()
export class CrmContactsService {
  private readonly logger = new Logger(CrmContactsService.name);
  private readonly guestSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    nationality: true,
  } as const;

  private static readonly WRITABLE_FIELDS = [
    'guestId',
    'companyName',
    'contactType',
    'segment',
    'preferredChannel',
    'tags',
    'notes',
    'rfmRecency',
    'rfmFrequency',
    'rfmMonetary',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  private sanitize(dto: CreateContactDto | UpdateContactDto): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const source = dto as unknown as Record<string, unknown>;
    for (const key of CrmContactsService.WRITABLE_FIELDS) {
      if (source[key] !== undefined) {
        out[key] = source[key];
      }
    }
    return out;
  }

  private async attachGuests<T extends { guestId?: string | null }>(
    contacts: T[],
  ): Promise<Array<T & { guest: Record<string, unknown> | null }>> {
    const guestIds = Array.from(
      new Set(contacts.map((contact) => contact.guestId).filter((guestId): guestId is string => !!guestId)),
    );

    if (guestIds.length === 0) {
      return contacts.map((contact) => ({ ...contact, guest: null }));
    }

    const guests = await this.prisma.guest.findMany({
      where: { id: { in: guestIds } },
      select: this.guestSelect,
    });
    const guestMap = new Map(guests.map((guest) => [guest.id, guest]));

    return contacts.map((contact) => ({
      ...contact,
      guest: contact.guestId ? guestMap.get(contact.guestId) ?? null : null,
    }));
  }

  async findAll(query: QueryContactsDto, tenantId?: string) {
    if (!tenantId) {
      return { data: [], total: 0, page: 1, limit: 20 };
    }

    const page = Math.max(parseInt(query.page ?? '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.segment) where.segment = query.segment;
    if (query.contactType) where.contactType = query.contactType;
    if (query.search) {
      where.OR = [
        { companyName: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    try {
      const [contacts, total] = await Promise.all([
        this.prisma.crmContact.findMany({
          where,
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.crmContact.count({ where }),
      ]);
      const data = await this.attachGuests(contacts);
      return { data, total, page, limit };
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') {
        return { data: [], total: 0, page, limit };
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const contact = await this.prisma.crmContact.findFirst({ where: { id, tenantId } });
    if (!contact) throw new NotFoundException(`Contact ${id} not found`);
    const [enriched] = await this.attachGuests([contact]);
    return enriched;
  }

  async getStayHistory(contactId: string, tenantId: string) {
    const contact = await this.findOne(contactId, tenantId);
    if (!contact.guestId) return [];
    return this.prisma.booking.findMany({
      where: { tenantId, guestId: contact.guestId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(dto: CreateContactDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    if (dto.guestId) {
      const existing = await this.prisma.crmContact.findFirst({
        where: { tenantId, guestId: dto.guestId },
      });
      if (existing) {
        throw new BadRequestException(`Contact already exists for guest ${dto.guestId}`);
      }
    }

    const data = {
      ...this.sanitize(dto),
      tenantId,
    } as Parameters<PrismaService['crmContact']['create']>[0]['data'];

    return this.prisma.crmContact.create({ data });
  }

  /**
   * Upsert a contact from an event (e.g. booking.created).
   * Safe to call repeatedly — idempotent on (tenantId, guestId).
   */
  async upsertFromGuest(tenantId: string, guestId: string, extras: Partial<CreateContactDto> = {}) {
    if (!tenantId || !guestId) {
      throw new BadRequestException('tenantId and guestId required for upsert');
    }
    const existing = await this.prisma.crmContact.findFirst({
      where: { tenantId, guestId },
    });
    if (existing) {
      const data = this.sanitize(extras);
      if (Object.keys(data).length === 0) return existing;
      return this.prisma.crmContact.update({ where: { id: existing.id }, data });
    }
    return this.create({ guestId, ...extras }, tenantId);
  }

  async update(id: string, dto: UpdateContactDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);
    return this.prisma.crmContact.update({ where: { id }, data: this.sanitize(dto) });
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);
    return this.prisma.crmContact.delete({ where: { id } });
  }

  /**
   * Increment stay counters after a checkout. Called from event listener.
   * Fails silently and logs — must not block checkout.
   */
  async recordStayCompletion(
    tenantId: string,
    guestId: string,
    bookingAmount: number,
  ): Promise<void> {
    try {
      const contact = await this.upsertFromGuest(tenantId, guestId);
      await this.prisma.crmContact.update({
        where: { id: contact.id },
        data: {
          totalStays: { increment: 1 },
          lifetimeValue: { increment: bookingAmount },
          lastStayAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record stay for guest ${guestId}: ${(error as Error).message}`);
    }
  }
}
