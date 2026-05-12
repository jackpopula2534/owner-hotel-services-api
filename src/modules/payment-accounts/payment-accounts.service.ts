import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePaymentAccountDto,
  PaymentAccountKind,
  UpdatePaymentAccountDto,
} from './dto/payment-account.dto';

// ─────────────────────────────────────────────────────────────────────────────
// PaymentAccountsService — multi-account CRUD ต่อ property
//
// Invariants ที่ service บังคับ:
//  - 1 propertyId + 1 kind สามารถมี isDefault = true ได้แค่ 1 รายการ
//    (ตอน create/update จะ unset default ของรายการอื่นใน kind เดียวกัน)
//  - ห้ามลบบัญชีสุดท้ายที่ isDefault = true ถ้ายังมีบัญชีอื่น — auto promote
//    บัญชีต่อไปให้เป็น default แทน
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentAccountsService {
  private readonly logger = new Logger(PaymentAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── List ────────────────────────────────────────────────────────────────
  async list(propertyId: string, kind?: PaymentAccountKind) {
    return this.prisma.paymentAccount.findMany({
      where: {
        propertyId,
        ...(kind ? { kind } : {}),
      },
      orderBy: [
        { isDefault: 'desc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  // ─── Get one ─────────────────────────────────────────────────────────────
  async get(propertyId: string, id: string) {
    const account = await this.prisma.paymentAccount.findFirst({
      where: { id, propertyId },
    });
    if (!account) {
      throw new NotFoundException(`Payment account ${id} not found`);
    }
    return account;
  }

  // ─── Create ──────────────────────────────────────────────────────────────
  async create(propertyId: string, dto: CreatePaymentAccountDto) {
    this.assertChannelFields(dto);

    return this.prisma.$transaction(async (tx) => {
      // ถ้ายังไม่มีบัญชีในช่องทางนี้ → ตั้งเป็น default อัตโนมัติ
      const existingCount = await tx.paymentAccount.count({
        where: { propertyId, kind: dto.kind },
      });
      const shouldBeDefault =
        dto.isDefault === true || existingCount === 0;

      // ถ้าจะตั้งเป็น default → unset อื่นใน kind เดียวกัน
      if (shouldBeDefault) {
        await tx.paymentAccount.updateMany({
          where: { propertyId, kind: dto.kind, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.paymentAccount.create({
        data: {
          propertyId,
          kind: dto.kind,
          label: dto.label,
          promptpayId: dto.kind === 'promptpay' ? dto.promptpayId : null,
          bankCode: dto.kind === 'bank' ? dto.bankCode : null,
          accountNumber: dto.kind === 'bank' ? dto.accountNumber : null,
          accountName: dto.accountName,
          branch: dto.kind === 'bank' ? dto.branch : null,
          isDefault: shouldBeDefault,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? existingCount,
        },
      });

      this.logger.log(
        `Created ${dto.kind} payment account ${created.id} for property ${propertyId}`,
      );
      return created;
    });
  }

  // ─── Update ──────────────────────────────────────────────────────────────
  async update(
    propertyId: string,
    id: string,
    dto: UpdatePaymentAccountDto,
  ) {
    const existing = await this.get(propertyId, id);

    // ถ้าเปลี่ยน kind ต้องตรวจ field ใหม่
    const finalKind = (dto.kind ?? (existing.kind as PaymentAccountKind));
    if (dto.kind && dto.kind !== existing.kind) {
      this.assertChannelFields({
        ...existing,
        ...dto,
        kind: finalKind,
        accountName: dto.accountName ?? existing.accountName ?? '',
      } as CreatePaymentAccountDto);
    }

    return this.prisma.$transaction(async (tx) => {
      // ถ้าจะตั้งเป็น default → unset อื่นใน kind เดียวกัน
      if (dto.isDefault === true) {
        await tx.paymentAccount.updateMany({
          where: {
            propertyId,
            kind: finalKind,
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }

      const updated = await tx.paymentAccount.update({
        where: { id },
        data: {
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.promptpayId !== undefined && {
            promptpayId: finalKind === 'promptpay' ? dto.promptpayId : null,
          }),
          ...(dto.bankCode !== undefined && {
            bankCode: finalKind === 'bank' ? dto.bankCode : null,
          }),
          ...(dto.accountNumber !== undefined && {
            accountNumber: finalKind === 'bank' ? dto.accountNumber : null,
          }),
          ...(dto.accountName !== undefined && {
            accountName: dto.accountName,
          }),
          ...(dto.branch !== undefined && {
            branch: finalKind === 'bank' ? dto.branch : null,
          }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      });

      this.logger.log(`Updated payment account ${id} for property ${propertyId}`);
      return updated;
    });
  }

  // ─── Delete ──────────────────────────────────────────────────────────────
  async remove(propertyId: string, id: string) {
    const existing = await this.get(propertyId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentAccount.delete({ where: { id } });

      // ถ้าลบ default → promote ตัวถัดไป (ถ้ามี) ขึ้นเป็น default
      if (existing.isDefault) {
        const next = await tx.paymentAccount.findFirst({
          where: { propertyId, kind: existing.kind },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        if (next) {
          await tx.paymentAccount.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }

      this.logger.log(`Deleted payment account ${id} for property ${propertyId}`);
      return { success: true };
    });
  }

  // ─── Set default ─────────────────────────────────────────────────────────
  async setDefault(propertyId: string, id: string) {
    const existing = await this.get(propertyId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentAccount.updateMany({
        where: { propertyId, kind: existing.kind, isDefault: true },
        data: { isDefault: false },
      });
      const updated = await tx.paymentAccount.update({
        where: { id },
        data: { isDefault: true },
      });
      this.logger.log(
        `Set default ${existing.kind} payment account = ${id} for property ${propertyId}`,
      );
      return updated;
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  private assertChannelFields(dto: CreatePaymentAccountDto): void {
    if (dto.kind === 'promptpay') {
      if (!dto.promptpayId) {
        throw new BadRequestException('promptpayId is required for kind=promptpay');
      }
    } else if (dto.kind === 'bank') {
      if (!dto.bankCode || !dto.accountNumber) {
        throw new BadRequestException(
          'bankCode and accountNumber are required for kind=bank',
        );
      }
    }
    if (!dto.accountName?.trim()) {
      throw new BadRequestException('accountName is required');
    }
  }
}
