import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type DomainStatus = 'not_configured' | 'pending' | 'verified' | 'failed';

export interface UpsertBrandingInput {
  tenantId: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  emailSenderName?: string;
  emailSenderAddress?: string;
}

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForTenant(tenantId: string) {
    const row = await (this.prisma as any).tenant_brandings.findUnique({
      where: { tenant_id: tenantId },
    });
    return row || null;
  }

  /**
   * Public lookup by custom domain — used by edge router to map a CNAME
   * back to a tenant. Only returns rows whose DNS is verified.
   */
  async resolveByDomain(domain: string) {
    return (this.prisma as any).tenant_brandings.findFirst({
      where: { custom_domain: domain, domain_status: 'verified' as any },
    });
  }

  async upsert(input: UpsertBrandingInput) {
    if (input.primaryColor && !this.isValidColor(input.primaryColor)) {
      throw new BadRequestException('primaryColor must be a hex string like #aabbcc');
    }
    if (input.accentColor && !this.isValidColor(input.accentColor)) {
      throw new BadRequestException('accentColor must be a hex string like #aabbcc');
    }
    if (input.emailSenderAddress && !this.isValidEmail(input.emailSenderAddress)) {
      throw new BadRequestException('emailSenderAddress must be a valid email');
    }

    const data = {
      tenant_id: input.tenantId,
      logo_url: input.logoUrl,
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
      email_sender_name: input.emailSenderName,
      email_sender_address: input.emailSenderAddress,
    };

    return (this.prisma as any).tenant_brandings.upsert({
      where: { tenant_id: input.tenantId },
      create: data,
      update: { ...data, updated_at: new Date() },
    });
  }

  /**
   * Tenant requests a custom domain. We store it as `pending` and return
   * the verification token (expects a TXT record at _staysync.<domain>).
   */
  async requestCustomDomain(tenantId: string, domain: string) {
    const cleaned = (domain || '').toLowerCase().trim();
    if (!cleaned || !this.isValidDomain(cleaned)) {
      throw new BadRequestException('Invalid domain');
    }
    const taken = await (this.prisma as any).tenant_brandings.findFirst({
      where: { custom_domain: cleaned, NOT: { tenant_id: tenantId } },
    });
    if (taken) {
      throw new BadRequestException('Domain already used by another tenant');
    }

    const token = `staysync-verify=${randomBytes(16).toString('hex')}`;
    const row = await (this.prisma as any).tenant_brandings.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        custom_domain: cleaned,
        domain_status: 'pending',
        domain_verification_token: token,
      },
      update: {
        custom_domain: cleaned,
        domain_status: 'pending',
        domain_verification_token: token,
        updated_at: new Date(),
      },
    });

    return {
      domain: cleaned,
      verificationToken: token,
      txtRecord: `_staysync.${cleaned}`,
      cname: `cname.staysync.com`,
      brandingId: row.id,
    };
  }

  /**
   * Mark a custom domain as verified. Caller (cron / admin button) is
   * responsible for actually doing the DNS lookup; this method just
   * records the result.
   */
  async setDomainStatus(tenantId: string, status: DomainStatus): Promise<void> {
    const row = await (this.prisma as any).tenant_brandings.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!row) throw new NotFoundException('Branding row not found');
    await (this.prisma as any).tenant_brandings.update({
      where: { tenant_id: tenantId },
      data: {
        domain_status: status,
        last_verified_at: status === 'verified' ? new Date() : row.last_verified_at,
        updated_at: new Date(),
      },
    });
  }

  // ── helpers ──

  private isValidColor(s: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(s);
  }

  private isValidEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  private isValidDomain(s: string): boolean {
    // Simple TLD check; sufficient for storing — full validation happens
    // when the DNS resolver actually queries the record.
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      s,
    );
  }
}
