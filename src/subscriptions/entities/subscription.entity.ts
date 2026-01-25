import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Plan } from '../../plans/entities/plan.entity';
import { SubscriptionFeature } from '../../subscription-features/entities/subscription-feature.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

export enum SubscriptionStatus {
  TRIAL = 'trial',
  PENDING = 'pending',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_code', unique: true, nullable: true })
  subscriptionCode: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'previous_plan_id', nullable: true })
  previousPlanId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIAL,
  })
  status: SubscriptionStatus;

  @Column({
    name: 'billing_cycle',
    type: 'enum',
    enum: BillingCycle,
    default: BillingCycle.MONTHLY,
  })
  billingCycle: BillingCycle;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date' })
  endDate: Date;

  @Column({ name: 'next_billing_date', type: 'date', nullable: true })
  nextBillingDate: Date;

  @Column({ name: 'billing_anchor_date', type: 'date', nullable: true })
  billingAnchorDate: Date;

  @Column({ name: 'auto_renew', default: true })
  autoRenew: boolean;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt: Date;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string;

  @Column({ name: 'renewed_count', type: 'int', default: 0 })
  renewedCount: number;

  @Column({ name: 'last_renewed_at', type: 'timestamp', nullable: true })
  lastRenewedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.subscription)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Plan, (plan) => plan.subscriptions)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @ManyToOne(() => Plan, { nullable: true })
  @JoinColumn({ name: 'previous_plan_id' })
  previousPlan: Plan;

  @OneToMany(() => SubscriptionFeature, (subscriptionFeature) => subscriptionFeature.subscription)
  subscriptionFeatures: SubscriptionFeature[];

  @OneToMany(() => Invoice, (invoice) => invoice.subscription)
  invoices: Invoice[];
}


