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


