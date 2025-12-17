import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
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

  @Column({ type: 'int', nullable: true })
  quantity: number; // สำหรับ limit type เช่น extra user

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @ManyToOne(() => Subscription, (subscription) => subscription.subscriptionFeatures)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @ManyToOne(() => Feature, (feature) => feature.subscriptionFeatures)
  @JoinColumn({ name: 'feature_id' })
  feature: Feature;
}


