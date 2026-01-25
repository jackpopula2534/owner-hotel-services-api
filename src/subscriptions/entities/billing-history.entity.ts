import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

export enum BillingEventType {
  CREATED = 'created',
  RENEWED = 'renewed',
  UPGRADED = 'upgraded',
  DOWNGRADED = 'downgraded',
  CYCLE_CHANGED = 'cycle_changed',
  CANCELLED = 'cancelled',
  REACTIVATED = 'reactivated',
  EXPIRED = 'expired',
}

@Entity('billing_history')
export class BillingHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id' })
  subscriptionId: string;

  @Column({ name: 'invoice_id', nullable: true })
  invoiceId: string;

  @Column({
    type: 'enum',
    enum: BillingEventType,
  })
  eventType: BillingEventType;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'old_plan_id', nullable: true })
  oldPlanId: string;

  @Column({ name: 'new_plan_id', nullable: true })
  newPlanId: string;

  @Column({ name: 'old_billing_cycle', nullable: true })
  oldBillingCycle: string;

  @Column({ name: 'new_billing_cycle', nullable: true })
  newBillingCycle: string;

  @Column({ name: 'old_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  oldAmount: number;

  @Column({ name: 'new_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  newAmount: number;

  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @ManyToOne(() => Invoice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
