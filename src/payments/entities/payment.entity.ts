import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';

// ต้องมีครบทุกค่าตรงกับ Prisma enum `payments_method` ไม่งั้น dataSource.synchronize()
// ใน db:refresh จะ ALTER enum ใน DB ให้เหลือแค่ค่าที่ประกาศที่นี่ (drop stripe/truemoney)
export enum PaymentMethod {
  TRANSFER = 'transfer',
  QR = 'qr',
  CASH = 'cash',
  STRIPE = 'stripe',
  TRUEMONEY = 'truemoney',
}

export enum PaymentStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payment_no', unique: true, nullable: true })
  paymentNo: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @Index('payments_tenant_id_idx')
  @Column({ name: 'tenant_id', length: 255, nullable: true })
  tenantId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
  })
  method: PaymentMethod;

  @Column({ name: 'slip_url', type: 'text', nullable: true })
  slipUrl: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ name: 'refunded_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  refundedAmount: number;

  @Column({ name: 'approved_by', length: 191, nullable: true })
  approvedBy: string; // admin_id

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Invoice, (invoice) => invoice.payments)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
