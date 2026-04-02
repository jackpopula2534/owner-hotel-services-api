import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddFolioChargeDto } from './dto/add-folio-charge.dto';

export interface FolioCharge {
  description: string;
  amount: number;
  category: string;
  createdAt: string;
}

export interface GuestFolio {
  bookingId: string;
  guestName: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  roomChargeAmount: number;
  additionalCharges: FolioCharge[];
  totalBalance: number;
}

@Injectable()
export class GuestFolioService {
  private readonly logger = new Logger(GuestFolioService.name);

  constructor(private prisma: PrismaService) {}

  async getFolio(bookingId: string, tenantId: string): Promise<GuestFolio> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: { room: true, guest: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Fetch invoice for this booking to get additional charges
    const invoice = await this.prisma.invoices.findFirst({
      where: { booking_id: bookingId, tenant_id: tenantId },
      include: { invoice_items: true },
    });

    // Parse additional charges from invoice items (stored as JSON in metadata or as separate items)
    const additionalCharges: FolioCharge[] = [];
    if (invoice && invoice.invoice_items) {
      invoice.invoice_items.forEach((item: any) => {
        if (item.type !== 'room_charge') {
          additionalCharges.push({
            description: item.description,
            amount: Number(item.amount),
            category: item.type || 'other',
            createdAt: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString(),
          });
        }
      });
    }

    const roomChargeAmount = Number(booking.totalPrice);
    const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
    const totalBalance = roomChargeAmount + additionalChargesTotal;

    return {
      bookingId: booking.id,
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomNumber: booking.room?.number || 'N/A',
      checkInDate: booking.checkIn.toISOString(),
      checkOutDate: booking.checkOut.toISOString(),
      roomChargeAmount,
      additionalCharges,
      totalBalance,
    };
  }

  async addCharge(bookingId: string, tenantId: string, dto: AddFolioChargeDto): Promise<GuestFolio> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Find or create invoice for this booking
    let invoice = await this.prisma.invoices.findFirst({
      where: { booking_id: bookingId, tenant_id: tenantId },
    });

    if (!invoice) {
      // Create invoice if it doesn't exist
      const invoiceNo = this.generateInvoiceNumber();
      invoice = await this.prisma.invoices.create({
        data: {
          tenant_id: tenantId,
          invoice_no: invoiceNo,
          amount: Number(booking.totalPrice),
          status: 'draft',
          due_date: booking.checkOut,
        },
      });
    }

    // Create invoice item for this charge
    await this.prisma.invoice_items.create({
      data: {
        invoice_id: invoice.id,
        type: dto.category || 'other',
        description: dto.description,
        quantity: 1,
        unit_price: dto.amount,
        amount: dto.amount,
      },
    });

    this.logger.log(
      `Added charge to folio - Booking: ${bookingId}, Amount: ${dto.amount}, Category: ${dto.category || 'other'}`,
    );

    // Return updated folio
    return this.getFolio(bookingId, tenantId);
  }

  async finalizeFolio(bookingId: string, tenantId: string): Promise<GuestFolio> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Get current folio to calculate total
    const folio = await this.getFolio(bookingId, tenantId);

    // Find invoice and update with final total
    const invoice = await this.prisma.invoices.findFirst({
      where: { booking_id: bookingId, tenant_id: tenantId },
    });

    if (invoice) {
      await this.prisma.invoices.update({
        where: { id: invoice.id },
        data: {
          amount: folio.totalBalance,
          status: 'finalized',
        },
      });

      this.logger.log(
        `Finalized folio - Booking: ${bookingId}, Total Balance: ${folio.totalBalance}`,
      );
    }

    return folio;
  }

  /**
   * Generate invoice number: INV-{YYYYMMDD}-{random4digits}
   */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return `INV-${year}${month}${day}-${random}`;
  }
}
