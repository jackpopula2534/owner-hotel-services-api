import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { SubscriptionFeature } from './subscription-feature.entity';

export enum FeatureLogAction {
  ADDED = 'added',
  UPDATED = 'updated',
  REMOVED = 'removed',
}

@Entity('subscription_feature_logs')
export class SubscriptionFeatureLogs {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_feature_id', nullable: true })
  subscriptionFeatureId: string;

  @Column({ name: 'subscription_id' })
  subscriptionId: string;

  @Column({ name: 'feature_id' })
  featureId: string;

  @Column({ name: 'feature_name' })
  featureName: string;

  @Column({
    type: 'enum',
    enum: FeatureLogAction,
  })
  action: FeatureLogAction;

  @Column({ name: 'old_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  oldPrice: number;

  @Column({ name: 'new_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  newPrice: number;

  @Column({ name: 'old_quantity', type: 'int', nullable: true })
  oldQuantity: number;

  @Column({ name: 'new_quantity', type: 'int', nullable: true })
  newQuantity: number;

  @Column({ name: 'prorated_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  proratedAmount: number;

  @Column({ name: 'credit_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  creditAmount: number;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ name: 'effective_date', type: 'date', nullable: true })
  effectiveDate: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => SubscriptionFeature, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_feature_id' })
  subscriptionFeature: SubscriptionFeature;
}
