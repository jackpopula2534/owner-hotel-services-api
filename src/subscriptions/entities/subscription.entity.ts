import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
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
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIAL,
  })
  status: SubscriptionStatus;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date' })
  endDate: Date;

  @Column({ name: 'auto_renew', default: true })
  autoRenew: boolean;

  @ManyToOne(() => Tenant, (tenant) => tenant.subscription)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Plan, (plan) => plan.subscriptions)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @OneToMany(() => SubscriptionFeature, (subscriptionFeature) => subscriptionFeature.subscription)
  subscriptionFeatures: SubscriptionFeature[];

  @OneToMany(() => Invoice, (invoice) => invoice.subscription)
  invoices: Invoice[];
}


