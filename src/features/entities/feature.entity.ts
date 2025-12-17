import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { PlanFeature } from '../../plan-features/entities/plan-feature.entity';
import { SubscriptionFeature } from '../../subscription-features/entities/subscription-feature.entity';

export enum FeatureType {
  TOGGLE = 'toggle',
  LIMIT = 'limit',
  MODULE = 'module',
}

@Entity('features')
export class Feature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string; // ota_booking, automation, tax_invoice

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: FeatureType,
  })
  type: FeatureType;

  @Column({ name: 'price_monthly', type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceMonthly: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => PlanFeature, (planFeature) => planFeature.feature)
  planFeatures: PlanFeature[];

  @OneToMany(() => SubscriptionFeature, (subscriptionFeature) => subscriptionFeature.feature)
  subscriptionFeatures: SubscriptionFeature[];
}


