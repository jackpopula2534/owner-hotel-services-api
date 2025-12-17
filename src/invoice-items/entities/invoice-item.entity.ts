import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';

export enum InvoiceItemType {
  PLAN = 'plan',
  FEATURE = 'feature',
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

  @Column({ name: 'ref_id' })
  refId: string; // plan_id or feature_id

  @Column()
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @ManyToOne(() => Invoice, (invoice) => invoice.invoiceItems)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}


