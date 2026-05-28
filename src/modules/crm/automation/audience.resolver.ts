import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceQueryDto } from './dto/campaign.dto';

export interface AudienceMember {
  contactId: string;
  guestId: string | null;
  email: string | null;
  preferredChannel: string | null;
}

/**
 * Resolves a campaign audience from a segmentation query.
 * Returns the de-duplicated list of contacts matching ALL provided filters,
 * joined with Guest for email/phone lookup.
 *
 * Multi-tenant: tenantId is mandatory on every call.
 */
@Injectable()
export class AudienceResolver {
  private readonly logger = new Logger(AudienceResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Safely parse audienceQuery JSON; returns empty object on failure. */
  static parseQuery(raw: string | null | undefined): AudienceQueryDto {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  async resolve(tenantId: string, query: AudienceQueryDto): Promise<AudienceMember[]> {
    if (!tenantId) return [];

    const where: Record<string, unknown> = { tenantId };
    if (query.segments?.length) where.segment = { in: query.segments };
    if (query.contactTypes?.length) where.contactType = { in: query.contactTypes };
    if (query.preferredChannels?.length) where.preferredChannel = { in: query.preferredChannels };
    if (query.minLifetimeValue !== undefined) where.lifetimeValue = { gte: query.minLifetimeValue };
    if (query.minTotalStays !== undefined) where.totalStays = { gte: query.minTotalStays };

    try {
      const contacts = await this.prisma.crmContact.findMany({
        where,
        select: { id: true, guestId: true, preferredChannel: true },
        take: 50_000,
      });

      // Hydrate emails from Guest table — single batch query
      const guestIds = contacts.map((c) => c.guestId).filter((id): id is string => !!id);
      const guests = guestIds.length
        ? await this.prisma.guest.findMany({
            where: { tenantId, id: { in: guestIds } },
            select: { id: true, email: true, consentGiven: true },
          })
        : [];
      const emailByGuest = new Map<string, string | null>();
      const consentByGuest = new Map<string, boolean>();
      for (const g of guests) {
        emailByGuest.set(g.id, g.email ?? null);
        consentByGuest.set(g.id, g.consentGiven);
      }

      return contacts
        .filter((c) => {
          // PDPA: only include guests that have given marketing consent
          if (!c.guestId) return false;
          return consentByGuest.get(c.guestId) === true;
        })
        .map<AudienceMember>((c) => ({
          contactId: c.id,
          guestId: c.guestId,
          email: c.guestId ? (emailByGuest.get(c.guestId) ?? null) : null,
          preferredChannel: c.preferredChannel,
        }));
    } catch (error) {
      this.logger.error(`Failed to resolve audience: ${(error as Error).message}`);
      return [];
    }
  }

  /** Estimate audience size without hydrating Guest data. Faster for previews. */
  async estimateSize(tenantId: string, query: AudienceQueryDto): Promise<number> {
    if (!tenantId) return 0;
    const where: Record<string, unknown> = { tenantId };
    if (query.segments?.length) where.segment = { in: query.segments };
    if (query.contactTypes?.length) where.contactType = { in: query.contactTypes };
    if (query.preferredChannels?.length) where.preferredChannel = { in: query.preferredChannels };
    if (query.minLifetimeValue !== undefined) where.lifetimeValue = { gte: query.minLifetimeValue };
    if (query.minTotalStays !== undefined) where.totalStays = { gte: query.minTotalStays };

    try {
      return await this.prisma.crmContact.count({ where });
    } catch (error) {
      this.logger.error(`Failed to estimate audience: ${(error as Error).message}`);
      return 0;
    }
  }
}
