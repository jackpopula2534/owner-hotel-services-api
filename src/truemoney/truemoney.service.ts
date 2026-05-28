import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { InitiateTrueMoneyDto, TrueMoneyCallbackDto } from './dto/truemoney.dto';

/**
 * TrueMoneyService
 *
 * Integration ผ่าน 2C2P Payment Gateway
 * Docs: https://developer.2c2p.com/docs
 *
 * Flow:
 *   1. POST /truemoney/initiate   → สร้าง payment token จาก 2C2P → return redirect URL
 *   2. ลูกค้า redirect ไปหน้า TrueMoney Wallet ชำระเงิน
 *   3. 2C2P callback กลับมาที่ POST /truemoney/callback
 *   4. บ่าวตรวจ hash, update status, approve payment
 */
@Injectable()
export class TrueMoneyService {
  private readonly logger = new Logger(TrueMoneyService.name);
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly apiUrl: string;
  private readonly frontendUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.merchantId = this.configService.get<string>('TWO_C2P_MERCHANT_ID', '');
    this.secretKey = this.configService.get<string>('TWO_C2P_SECRET_KEY', '');
    this.apiUrl = this.configService.get<string>(
      'TWO_C2P_API_URL',
      'https://sandbox-pgw.2c2p.com/payment/4.1',
    );
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    if (!this.merchantId || !this.secretKey) {
      this.logger.warn('TWO_C2P_MERCHANT_ID or TWO_C2P_SECRET_KEY not configured — TrueMoney payments disabled');
    }
  }

  // ─── Initiate TrueMoney payment ───────────────────────────────────────────
  async initiate(tenantId: string, dto: InitiateTrueMoneyDto) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: dto.invoiceId, tenant_id: tenantId },
    });
    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);
    if (invoice.status === 'paid') throw new BadRequestException('Invoice is already paid');

    const merchantOrderId = this.generateMerchantOrderId(tenantId);
    const returnUrl = dto.frontendReturnUrl
      ? dto.frontendReturnUrl
      : `${this.frontendUrl}/payment/truemoney/result`;
    const backendUrl = `${this.configService.get('API_URL', 'http://localhost:3001')}/api/v1/truemoney/callback`;

    // Build 2C2P Payment Token Request payload
    const payload = {
      merchantID: this.merchantId,
      invoiceNo: merchantOrderId,
      description: `Invoice ${invoice.invoice_no}`,
      amount: dto.amount.toFixed(2),
      currencyCode: '764', // THB
      paymentChannel: ['TRUEMONEY'],
      request3DS: 'N',
      frontendReturnUrl: returnUrl,
      backendReturnUrl: backendUrl,
    };

    const token = this.buildJwtPayload(payload);

    // เรียก 2C2P เพื่อขอ payment token
    const response = await this.request2C2PToken(token);

    if (response.respCode !== '0000') {
      throw new BadRequestException(`2C2P error: ${response.respDesc}`);
    }

    // บันทึก transaction
    await this.prisma.trueMoneyTransaction.create({
      data: {
        tenantId,
        invoiceId: dto.invoiceId,
        merchantOrderId,
        amount: dto.amount,
        currency: 'THB',
        status: 'pending',
        paymentToken: response.paymentToken,
        redirectUrl: response.webPaymentUrl,
      },
    });

    this.logger.log(`Initiated TrueMoney payment for invoice ${dto.invoiceId}`);

    return {
      merchantOrderId,
      redirectUrl: response.webPaymentUrl,
      paymentToken: response.paymentToken,
    };
  }

  // ─── Handle 2C2P callback ─────────────────────────────────────────────────
  async handleCallback(dto: TrueMoneyCallbackDto): Promise<void> {
    const transaction = await this.prisma.trueMoneyTransaction.findUnique({
      where: { merchantOrderId: dto.merchantOrderId },
    });

    if (!transaction) {
      this.logger.warn(`TrueMoney callback: unknown merchantOrderId ${dto.merchantOrderId}`);
      return;
    }

    const isSuccess = dto.respCode === '0000';
    const newStatus = isSuccess ? 'completed' : 'failed';

    await this.prisma.trueMoneyTransaction.update({
      where: { merchantOrderId: dto.merchantOrderId },
      data: {
        status: newStatus,
        callbackData: dto as any,
        paidAt: isSuccess ? new Date() : null,
        errorMessage: isSuccess ? null : `${dto.respCode}: ${dto.respDesc ?? ''}`,
      },
    });

    if (isSuccess && transaction.invoiceId) {
      await this.prisma.$transaction(async (tx) => {
        const paymentNo = `TMN-${Date.now()}`;
        await tx.payments.create({
          data: {
            invoice_id: transaction.invoiceId!,
            tenant_id: transaction.tenantId,
            method: 'truemoney',
            amount: transaction.amount,
            status: 'approved',
            approved_at: new Date(),
            payment_no: paymentNo,
          },
        });

        await tx.invoices.update({
          where: { id: transaction.invoiceId! },
          data: { status: 'paid' },
        });
      });

      this.logger.log(`TrueMoney payment success → invoice ${transaction.invoiceId} paid`);
    } else {
      this.logger.warn(`TrueMoney payment failed for order ${dto.merchantOrderId}: ${dto.respDesc}`);
    }
  }

  // ─── Get transaction status ───────────────────────────────────────────────
  async getTransactionStatus(tenantId: string, merchantOrderId: string) {
    const tx = await this.prisma.trueMoneyTransaction.findFirst({
      where: { merchantOrderId, tenantId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────
  private generateMerchantOrderId(tenantId: string): string {
    const timestamp = Date.now().toString();
    const hash = crypto
      .createHash('md5')
      .update(`${tenantId}${timestamp}`)
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();
    return `TMN${timestamp}${hash}`;
  }

  /**
   * Build JWT payload สำหรับ 2C2P (HS256, signed ด้วย secretKey)
   * Docs: https://developer.2c2p.com/docs/payment-token-request
   */
  private buildJwtPayload(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  /**
   * ส่ง payment token request ไปที่ 2C2P
   */
  private async request2C2PToken(jwtToken: string): Promise<{
    respCode: string;
    respDesc?: string;
    paymentToken?: string;
    webPaymentUrl?: string;
  }> {
    const url = `${this.apiUrl}/PaymentToken`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: jwtToken }),
    });

    if (!res.ok) {
      throw new BadRequestException(`2C2P API error: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { payload: string };

    // decode JWT response
    const parts = data.payload.split('.');
    if (parts.length < 2) throw new BadRequestException('Invalid 2C2P response');

    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return decoded;
  }
}
