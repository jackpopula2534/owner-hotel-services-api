import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateFolioChargeDto } from './dto/create-folio-charge.dto';
import { CreateFolioPaymentDto } from './dto/create-folio-payment.dto';

@Injectable()
export class GuestFolioService {
  private readonly logger = new Logger(GuestFolioService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generateFolioNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'FOLIO', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'FOLIO', prefix: 'FOLIO', yearMonth, lastNumber: 1 },
    });
    return `FOLIO-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, propertyId?: string, status?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;

    const data = await this.prisma.guestFolio.findMany({
      where,
      include: {
        booking: { select: { id: true, bookingNo: true } },
        guest: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id, tenantId },
      include: {
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paymentDate: 'asc' } },
        booking: { select: { id: true, bookingNo: true } },
        guest: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!folio) throw new NotFoundException(`Folio ${id} not found`);
    return folio;
  }

  async findByBooking(bookingId: string, tenantId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { bookingId, tenantId },
      include: {
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paymentDate: 'asc' } },
      },
    });
    if (!folio) throw new NotFoundException(`Folio for booking ${bookingId} not found`);
    return folio;
  }

  async createForBooking(
    bookingId: string,
    guestId: string,
    propertyId: string,
    tenantId: string,
    createdBy: string,
  ) {
    const existing = await this.prisma.guestFolio.findFirst({
      where: { bookingId, tenantId },
    });
    if (existing) {
      this.logger.warn(`Folio already exists for booking ${bookingId}`);
      return existing;
    }

    const folioNo = await this.generateFolioNo(tenantId);

    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId } });
    const checkInDate = booking?.checkIn ?? new Date();

    const folio = await this.prisma.guestFolio.create({
      data: {
        tenantId,
        propertyId,
        booking: { connect: { id: bookingId } },
        guest: { connect: { id: guestId } },
        folioNo,
        status: 'OPEN',
        checkInDate,
        openDate: new Date(),
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
        createdBy,
      },
    });

    this.logger.log(`Created folio ${folioNo} for booking ${bookingId}`);
    return folio;
  }

  async addCharge(dto: CreateFolioChargeDto, tenantId: string, postedBy: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: dto.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio ${dto.folioId} not found`);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot add charge to folio with status: ${folio.status}`);
    }

    const vatRate = dto.vatRate ?? 7;
    const netAmount = dto.quantity * dto.unitPrice;
    const vatAmount = netAmount * (vatRate / 100);
    const totalAmount = netAmount + vatAmount;
    const chargeDate = dto.chargeDate ? new Date(dto.chargeDate) : new Date();

    const charge = await this.prisma.$transaction(async (tx) => {
      const newCharge = await tx.folioCharge.create({
        data: {
          tenantId,
          propertyId: folio.propertyId,
          folio: { connect: { id: dto.folioId } },
          chargeDate,
          chargeType: dto.chargeType,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          netAmount,
          vatRate,
          vatAmount,
          totalAmount,
          accountId: dto.accountId,
          costCenterId: dto.costCenterId,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          postedBy,
          status: 'POSTED',
        },
      });

      await tx.guestFolio.update({
        where: { id: dto.folioId },
        data: {
          totalCharges: { increment: totalAmount },
          balance: { increment: totalAmount },
        },
      });

      return newCharge;
    });

    return charge;
  }

  async addPayment(dto: CreateFolioPaymentDto, tenantId: string, postedBy: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: dto.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio ${dto.folioId} not found`);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot add payment to folio with status: ${folio.status}`);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const newPayment = await tx.folioPayment.create({
        data: {
          tenantId,
          propertyId: folio.propertyId,
          folio: { connect: { id: dto.folioId } },
          paymentDate: new Date(),
          method: dto.method,
          amount: dto.amount,
          reference: dto.reference,
          payerName: dto.payerName,
          notes: dto.notes,
          postedBy,
          status: 'CLEARED',
        },
      });

      await tx.guestFolio.update({
        where: { id: dto.folioId },
        data: {
          totalPayments: { increment: dto.amount },
          balance: { decrement: dto.amount },
        },
      });

      return newPayment;
    });

    return payment;
  }

  async close(id: string, tenantId: string, closedBy: string) {
    const folio = await this.findOne(id, tenantId);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot close folio with status: ${folio.status}`);
    }
    if (Number(folio.balance) > 0.01) {
      throw new BadRequestException('Folio has outstanding balance');
    }

    const updated = await this.prisma.guestFolio.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy,
      },
    });

    this.logger.log(`Folio ${folio.folioNo} closed by ${closedBy}`);
    return updated;
  }

  async reverseCharge(chargeId: string, tenantId: string, reversedBy: string) {
    const charge = await this.prisma.folioCharge.findFirst({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException(`Charge ${chargeId} not found`);
    if (charge.status === 'REVERSED') {
      throw new BadRequestException('Charge is already reversed');
    }

    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: charge.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio for charge not found`);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot reverse charge on folio with status: ${folio.status}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const reversed = await tx.folioCharge.update({
        where: { id: chargeId },
        data: { status: 'REVERSED', reversedBy, reversedAt: new Date() },
      });

      await tx.guestFolio.update({
        where: { id: charge.folioId },
        data: {
          totalCharges: { decrement: Number(charge.totalAmount) },
          balance: { decrement: Number(charge.totalAmount) },
        },
      });

      return reversed;
    });

    return result;
  }
}
