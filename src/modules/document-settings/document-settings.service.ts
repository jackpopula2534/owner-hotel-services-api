import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDocumentSettingsDto } from './dto/update-document-settings.dto';

@Injectable()
export class DocumentSettingsService {
  private readonly logger = new Logger(DocumentSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Get or create document settings for a property */
  async getByProperty(tenantId: string, propertyId: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.documentSettings.findUnique({
      where: { tenantId_propertyId: { tenantId, propertyId } },
    });

    if (existing) return existing as unknown as Record<string, unknown>;

    // Auto-create with defaults
    const created = await this.prisma.documentSettings.create({
      data: { tenantId, propertyId },
    });

    this.logger.log(`Created default document settings for property ${propertyId}`);
    return created as unknown as Record<string, unknown>;
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
    const settings = await this.prisma.documentSettings.findUnique({
      where: { tenantId_propertyId: { tenantId, propertyId } },
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
