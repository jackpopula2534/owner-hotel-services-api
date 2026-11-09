import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AnnouncementSeverity = 'info' | 'warning' | 'critical' | 'maintenance';
export type AnnouncementAudience = 'all' | 'tenants_by_status' | 'specific_tenants';

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  severity?: AnnouncementSeverity;
  audience?: AnnouncementAudience;
  audienceFilter?: { tenantIds?: string[]; statuses?: string[] };
  ctaLabel?: string;
  ctaUrl?: string;
  publishedAt?: string;
  expiresAt?: string;
  createdBy?: string;
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Admin operations ──

  async create(input: CreateAnnouncementInput) {
    if (!input.title?.trim() || !input.body?.trim()) {
      throw new BadRequestException('title and body are required');
    }
    return (this.prisma as any).announcements.create({
      data: {
        title: input.title.trim(),
        body: input.body.trim(),
        severity: input.severity || 'info',
        audience: input.audience || 'all',
        audience_filter: input.audienceFilter || null,
        cta_label: input.ctaLabel,
        cta_url: input.ctaUrl,
        published_at: input.publishedAt ? new Date(input.publishedAt) : new Date(),
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
        created_by: input.createdBy,
      },
    });
  }

  async list(filters: { activeOnly?: boolean; limit?: number }) {
    const now = new Date();
    return (this.prisma as any).announcements.findMany({
      where: filters.activeOnly
        ? {
            published_at: { lte: now },
            OR: [{ expires_at: null }, { expires_at: { gt: now } }],
          }
        : {},
      orderBy: { created_at: 'desc' },
      take: filters.limit || 50,
    });
  }

  async expire(id: string) {
    const ann = await (this.prisma as any).announcements.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException('Announcement not found');
    return (this.prisma as any).announcements.update({
      where: { id },
      data: { expires_at: new Date() },
    });
  }

  // ── Tenant operations ──

  /**
   * List announcements visible to the given tenant. Filters out expired
   * and audience-mismatched ones, and joins read state so frontend can
   * render unread badges.
   */
  async listForTenant(tenantId: string, tenantStatus: string | null) {
    const now = new Date();
    const all = await (this.prisma as any).announcements.findMany({
      where: {
        published_at: { lte: now },
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      },
      orderBy: { published_at: 'desc' },
      take: 50,
    });

    const visible = all.filter((a: any) => this.matchesAudience(a, tenantId, tenantStatus));

    const reads: any[] = await (this.prisma as any).announcement_reads.findMany({
      where: { tenant_id: tenantId, announcement_id: { in: visible.map((a: any) => a.id) } },
    });
    const readSet = new Set(reads.map((r) => r.announcement_id));

    return visible.map((a: any) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      severity: a.severity,
      ctaLabel: a.cta_label,
      ctaUrl: a.cta_url,
      publishedAt: a.published_at,
      expiresAt: a.expires_at,
      isRead: readSet.has(a.id),
    }));
  }

  async markAsRead(input: { announcementId: string; tenantId: string; userId?: string }) {
    try {
      await (this.prisma as any).announcement_reads.create({
        data: {
          announcement_id: input.announcementId,
          tenant_id: input.tenantId,
          user_id: input.userId,
        },
      });
    } catch (err) {
      // Idempotent: unique-constraint race = already marked
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Unique constraint')) throw err;
    }
  }

  async unreadCount(tenantId: string, tenantStatus: string | null): Promise<number> {
    const list = await this.listForTenant(tenantId, tenantStatus);
    return list.filter((a) => !a.isRead).length;
  }

  // ── private ──

  private matchesAudience(
    announcement: any,
    tenantId: string,
    tenantStatus: string | null,
  ): boolean {
    if (announcement.audience === 'all') return true;
    const filter = announcement.audience_filter || {};
    if (announcement.audience === 'specific_tenants') {
      const ids: string[] = Array.isArray(filter.tenantIds) ? filter.tenantIds : [];
      return ids.includes(tenantId);
    }
    if (announcement.audience === 'tenants_by_status') {
      const statuses: string[] = Array.isArray(filter.statuses) ? filter.statuses : [];
      return tenantStatus ? statuses.includes(tenantStatus) : false;
    }
    return false;
  }
}
