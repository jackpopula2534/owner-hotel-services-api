import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QrCodeService } from '@/common/services/qr-code.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class QRService {
  private readonly logger = new Logger(QRService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qrCodeService: QrCodeService,
  ) {}

  // ─── Generate item-level QR ──────────────────────────────────────────────────
  async getItemQR(
    tenantId: string,
    itemId: string,
    format: 'png' | 'svg' = 'png',
    size: number = 256,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('ไม่พบสินค้า');

    const payload = this.qrCodeService.generateSignedPayload({
      type: 'item',
      tenantId,
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
    });

    const buffer = await this.qrCodeService.renderQRBuffer(payload, format, size);
    return {
      buffer,
      mimeType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    };
  }

  // ─── Generate lot-level QR ───────────────────────────────────────────────────
  async getLotQR(
    tenantId: string,
    lotId: string,
    format: 'png' | 'svg' = 'png',
    size: number = 256,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const lot = await this.prisma.inventoryLot.findFirst({
      where: { id: lotId, tenantId },
      include: { item: true },
    });
    if (!lot) throw new NotFoundException('ไม่พบ lot');

    const payload = this.qrCodeService.generateSignedPayload({
      type: 'lot',
      tenantId,
      itemId: lot.itemId,
      sku: lot.item.sku,
      itemName: lot.item.name,
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate?.toISOString().split('T')[0],
    });

    // Cache signed payload in lot record for fast subsequent lookups
    if (!lot.qrPayload) {
      await this.prisma.inventoryLot.update({
        where: { id: lotId },
        data: { qrPayload: payload },
      });
    }

    const buffer = await this.qrCodeService.renderQRBuffer(payload, format, size);
    return {
      buffer,
      mimeType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    };
  }

  // ─── Generate PDF label sheet (A4 grid) ─────────────────────────────────────
  async getItemLabelsPDF(tenantId: string, itemId: string, count: number = 12): Promise<Buffer> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('ไม่พบสินค้า');

    const payload = this.qrCodeService.generateSignedPayload({
      type: 'item',
      tenantId,
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
    });

    return this.generateLabelSheet(payload, item.name, item.sku, count);
  }

  async getLotLabelsPDF(tenantId: string, lotId: string, count: number = 1): Promise<Buffer> {
    const lot = await this.prisma.inventoryLot.findFirst({
      where: { id: lotId, tenantId },
      include: { item: true },
    });
    if (!lot) throw new NotFoundException('ไม่พบ lot');

    const payload = this.qrCodeService.generateSignedPayload({
      type: 'lot',
      tenantId,
      itemId: lot.itemId,
      sku: lot.item.sku,
      itemName: lot.item.name,
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate?.toISOString().split('T')[0],
    });

    const labelText = `${lot.item.name}\n${lot.lotNumber}${lot.expiryDate ? `\nExp: ${lot.expiryDate.toISOString().split('T')[0]}` : ''}`;
    return this.generateLabelSheet(payload, lot.item.name, lot.lotNumber, count, labelText);
  }

  // ─── Resolve QR payload ──────────────────────────────────────────────────────
  async resolveQR(tenantId: string, payloadStr: string) {
    let data;
    try {
      data = this.qrCodeService.verifyPayload(payloadStr, tenantId);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'QR ไม่ถูกต้อง';
      throw new BadRequestException(message);
    }

    if (data.type === 'item') {
      const item = await this.prisma.inventoryItem.findFirst({
        where: { id: data.itemId, tenantId, deletedAt: null },
        include: { category: { select: { id: true, name: true } } },
      });
      if (!item) throw new NotFoundException('ไม่พบสินค้าในระบบ');
      return { type: 'item', item };
    }

    if (data.type === 'lot') {
      const lot = await this.prisma.inventoryLot.findFirst({
        where: { id: data.lotId, tenantId },
        include: {
          item: true,
          warehouse: { select: { id: true, name: true } },
        },
      });
      if (!lot) throw new NotFoundException('ไม่พบ lot ในระบบ');
      return { type: 'lot', lot };
    }

    throw new BadRequestException('QR type ไม่รู้จัก');
  }

  // ─── PDF label generation helper ────────────────────────────────────────────
  private async generateLabelSheet(
    payload: string,
    name: string,
    code: string,
    count: number,
    labelText?: string,
  ): Promise<Buffer> {
    const qrDataUrl = await this.qrCodeService.renderQRDataUrl(payload, 120);
    // Strip the data URL prefix to get base64
    const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const qrBuffer = Buffer.from(base64, 'base64');

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // A4 = 595.28 x 841.89 pts
      const pageWidth = 595.28 - 40; // minus margins
      const cols = 4;
      const rows = 3;
      const cellWidth = pageWidth / cols;
      const cellHeight = 200;
      const qrSize = 90;
      const padding = 10;

      let labelCount = 0;
      let page = 0;

      for (let i = 0; i < count; i++) {
        const posOnPage = i % (cols * rows);
        if (posOnPage === 0 && i > 0) {
          doc.addPage();
          page++;
        }

        const col = posOnPage % cols;
        const row = Math.floor(posOnPage / cols);
        const x = 20 + col * cellWidth + padding;
        const y = 20 + row * cellHeight + padding;

        // Border
        doc.rect(20 + col * cellWidth, 20 + row * cellHeight, cellWidth, cellHeight).stroke();

        // QR Code image
        doc.image(qrBuffer, x, y, { width: qrSize, height: qrSize });

        // Text labels
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(name, x, y + qrSize + 4, {
            width: cellWidth - 2 * padding,
            ellipsis: true,
          });
        doc
          .font('Helvetica')
          .fontSize(7)
          .text(code, x, y + qrSize + 16, {
            width: cellWidth - 2 * padding,
          });

        if (labelText) {
          doc.fontSize(6).text(labelText, x, y + qrSize + 28, {
            width: cellWidth - 2 * padding,
          });
        }

        labelCount++;
      }

      doc.end();
    });
  }
}
