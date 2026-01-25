import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';

export enum InvoiceItemType {
  PLAN = 'plan',
  FEATURE = 'feature',
  ADJUSTMENT = 'adjustment',
}

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @Column({
    type: 'enum',
    enum: InvoiceItemType,
  })
  type: InvoiceItemType;

  @Column({ name: 'ref_id', nullable: true })
  refId: string; // plan_id or feature_id

  @Column()
  description: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'original_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  originalAmount: number;

  @Column({ name: 'is_adjusted', default: false })
  isAdjusted: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Invoice, (invoice) => invoice.invoiceItems)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}


