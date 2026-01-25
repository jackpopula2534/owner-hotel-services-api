import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { InvoiceItem } from '../../invoice-items/entities/invoice-item.entity';
import { Payment } from '../../payments/entities/payment.entity';

export enum InvoiceStatus {
  PENDING = 'pending',
  PAID = 'paid',
  REJECTED = 'rejected',
  VOIDED = 'voided',
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'subscription_id', nullable: true })
  subscriptionId: string;

  @Column({ name: 'invoice_no', unique: true })
  invoiceNo: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'original_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  originalAmount: number;

  @Column({ name: 'adjusted_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  adjustedAmount: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: Date;

  @Column({ name: 'voided_at', type: 'timestamp', nullable: true })
  voidedAt: Date;

  @Column({ name: 'voided_reason', type: 'text', nullable: true })
  voidedReason: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.invoices)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Subscription, (subscription) => subscription.invoices)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @OneToMany(() => InvoiceItem, (invoiceItem) => invoiceItem.invoice)
  invoiceItems: InvoiceItem[];

  @OneToMany(() => Payment, (payment) => payment.invoice)
  payments: Payment[];
}


