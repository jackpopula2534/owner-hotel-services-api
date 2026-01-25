import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

export enum AdjustmentType {
  DISCOUNT = 'discount',
  CREDIT = 'credit',
  SURCHARGE = 'surcharge',
  PRORATION = 'proration',
  VOID = 'void',
  REFUND = 'refund',
}

@Entity('invoice_adjustments')
export class InvoiceAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @Column({
    type: 'enum',
    enum: AdjustmentType,
  })
  type: AdjustmentType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'original_amount', type: 'decimal', precision: 10, scale: 2 })
  originalAmount: number;

  @Column({ name: 'new_amount', type: 'decimal', precision: 10, scale: 2 })
  newAmount: number;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'adjustment_reference', nullable: true })
  adjustmentReference: string; // เลขอ้างอิง Credit Memo เช่น CM-2024-001

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
