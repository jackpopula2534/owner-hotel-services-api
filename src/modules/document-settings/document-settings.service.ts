import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDocumentSettingsDto } from './dto/update-document-settings.dto';

/**
 * The tenant's own company profile ("ข้อมูลกิจการ"), shaped like the document
 * settings fields it can stand in for. Printers use it for any field the
 * property's document settings leave blank, so a PO never goes out without a
 * buyer name just because nobody opened the procurement settings page.
 */
export interface DocumentCompanyFallback {
  companyName: string | null;
  companyNameEn: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

@Injectable()
export class DocumentSettingsService {
  private readonly logger = new Logger(DocumentSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Get or create document settings for a property */
  async getByProperty(tenantId: string, propertyId: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.documentSettings.findFirst({
      where: { tenantId, propertyId },
    });

    if (existing) return existing as unknown as Record<string, unknown>;

    // Auto-create with defaults
    const created = await this.prisma.documentSettings.create({
      data: { tenantId, propertyId },
    });

    this.logger.log(`Created default document settings for property ${propertyId}`);
    return created as unknown as Record<string, unknown>;
  }

  /** Company details from the tenant row, for fields the settings leave blank. */
  async getCompanyFallback(tenantId: string): Promise<DocumentCompanyFallback | null> {
    const t = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        name_en: true,
        tax_id: true,
        address: true,
        district: true,
        province: true,
        postal_code: true,
        phone: true,
        email: true,
        website: true,
      },
    });
    if (!t) return null;
    const address = [t.address, t.district, t.province, t.postal_code]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ');
    return {
      companyName: t.name || null,
      companyNameEn: t.name_en || null,
      taxId: t.tax_id || null,
      address: address || null,
      phone: t.phone || null,
      email: t.email || null,
      website: t.website || null,
    };
  }

  /** Update document settings */
  async update(
    tenantId: string,
    propertyId: string,
    dto: UpdateDocumentSettingsDto,
  ): Promise<Record<string, unknown>> {
    // Ensure record exists first
    await this.getByProperty(tenantId, propertyId);

    const updated = await this.prisma.documentSettings.update({
      where: { tenantId_propertyId: { tenantId, propertyId } },
      data: { ...dto },
    });

    this.logger.log(`Updated document settings for property ${propertyId}`);
    return updated as unknown as Record<string, unknown>;
  }

  /** Update logo URL after file upload */
  async updateLogo(
    tenantId: string,
    propertyId: string,
    logoUrl: string,
  ): Promise<Record<string, unknown>> {
    // Ensure record exists first
    await this.getByProperty(tenantId, propertyId);

    const updated = await this.prisma.documentSettings.update({
      where: { tenantId_propertyId: { tenantId, propertyId } },
      data: { logoUrl },
    });

    this.logger.log(`Updated logo for property ${propertyId}: ${logoUrl}`);
    return updated as unknown as Record<string, unknown>;
  }

  /** Remove logo */
  async removeLogo(tenantId: string, propertyId: string): Promise<Record<string, unknown>> {
    const settings = await this.prisma.documentSettings.findFirst({
      where: { tenantId, propertyId },
    });

    if (!settings) {
      throw new NotFoundException('Document settings not found');
    }

    const updated = await this.prisma.documentSettings.update({
      where: { tenantId_propertyId: { tenantId, propertyId } },
      data: { logoUrl: null },
    });

    return updated as unknown as Record<string, unknown>;
  }
}
