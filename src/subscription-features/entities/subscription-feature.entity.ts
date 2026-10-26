import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Feature } from '../../features/entities/feature.entity';

@Entity('subscription_features')
export class SubscriptionFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id' })
  subscriptionId: string;

  @Column({ name: 'feature_id' })
  featureId: string;

  @Column({ type: 'int', nullable: true, default: 1 })
  quantity: number; // สำหรับ limit type เช่น extra user

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // add-on แบบใช้ก่อน เก็บเงินรอบบิลถัดไป — ดู common/billing/addon-billing.ts
  @Column({ name: 'billing_mode', type: 'varchar', length: 20, nullable: true })
  billingMode: string | null;

  @Column({ name: 'activated_at', type: 'datetime', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'billing_starts_on', type: 'date', nullable: true })
  billingStartsOn: string | null;

  @Column({ name: 'billed_through', type: 'date', nullable: true })
  billedThrough: string | null;

  @Column({ name: 'committed_until', type: 'date', nullable: true })
  committedUntil: string | null;

  @Column({ name: 'cancel_at', type: 'date', nullable: true })
  cancelAt: string | null;

  @Column({ name: 'accepted_at', type: 'datetime', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'accepted_by', type: 'varchar', length: 36, nullable: true })
  acceptedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Subscription, (subscription) => subscription.subscriptionFeatures)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @ManyToOne(() => Feature, (feature) => feature.subscriptionFeatures)
  @JoinColumn({ name: 'feature_id' })
  feature: Feature;
}
