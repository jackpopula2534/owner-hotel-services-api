import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';

export interface QRPayloadData {
  type: 'item' | 'lot';
  tenantId: string;
  itemId: string;
  sku: string;
  itemName: string;
  lotId?: string;
  lotNumber?: string;
  expiryDate?: string;
}

export interface SignedQRPayload extends QRPayloadData {
  v: number; // Version
  sig: string; // HMAC signature (first 16 chars)
}

@Injectable()
export class QrCodeService {
  private readonly logger = new Logger(QrCodeService.name);
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.get<string>('INVENTORY_QR_SECRET', '');
    if (!this.secret || this.secret.length < 32) {
      this.logger.warn('INVENTORY_QR_SECRET is not set or too short (min 32 chars)');
    }
  }

  // ─── Generate HMAC-signed payload ───────────────────────────────────────────
  generateSignedPayload(data: QRPayloadData): string {
    const payload: SignedQRPayload = {
      v: 1,
      ...data,
      sig: '',
    };

    // Compute signature over all fields except sig
    const { sig: _, ...payloadWithoutSig } = payload;
    const msgToSign = JSON.stringify(payloadWithoutSig);
    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(msgToSign);
    payload.sig = hmac.digest('hex').substring(0, 16);

    return JSON.stringify(payload);
  }

  // ─── Verify HMAC payload ─────────────────────────────────────────────────────
  verifyPayload(rawPayload: string, expectedTenantId: string): QRPayloadData {
    let parsed: SignedQRPayload;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new Error('QR payload ไม่ถูกต้อง — invalid JSON');
    }

    // Check tenant
    if (parsed.tenantId !== expectedTenantId) {
      throw new Error('QR นี้ไม่ใช่ของโรงแรมคุณ');
    }

    // Re-compute sig
    const { sig, ...rest } = parsed;
    const msgToSign = JSON.stringify(rest);
    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(msgToSign);
    const expected = hmac.digest('hex').substring(0, 16);

    if (expected !== sig) {
      throw new Error('QR ไม่ถูกต้อง — signature ไม่ตรง');
    }

    return {
      type: parsed.type,
      tenantId: parsed.tenantId,
      itemId: parsed.itemId,
      sku: parsed.sku,
      itemName: parsed.itemName,
      lotId: parsed.lotId,
      lotNumber: parsed.lotNumber,
      expiryDate: parsed.expiryDate,
    };
  }

  // ─── Render QR as buffer (PNG or SVG) ───────────────────────────────────────
  async renderQRBuffer(
    payload: string,
    format: 'png' | 'svg' = 'png',
    size: number = 256,
  ): Promise<Buffer> {
    if (format === 'svg') {
      const svg = await QRCode.toString(payload, {
        type: 'svg',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      return Buffer.from(svg);
    }

    // PNG
    const buffer = await QRCode.toBuffer(payload, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return buffer;
  }

  // ─── Render QR as data URL (for embedding in PDF) ───────────────────────────
  async renderQRDataUrl(payload: string, size: number = 256): Promise<string> {
    return QRCode.toDataURL(payload, {
      type: 'image/png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  }
}
