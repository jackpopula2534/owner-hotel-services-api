import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { PlanFeature } from '../../plan-features/entities/plan-feature.entity';
import { SubscriptionFeature } from '../../subscription-features/entities/subscription-feature.entity';

export enum FeatureType {
  TOGGLE = 'toggle',
  LIMIT = 'limit',
  MODULE = 'module',
}

/**
 * Feature catalog entity.
 *
 * Categories follow the StaySync taxonomy and are used by the admin UI to
 * group/filter features (CORE, PMS, RESTAURANT, HR, HOUSEKEEPING,
 * MAINTENANCE, REPORTING, INTEGRATION, ADVANCED). The column is nullable to
 * stay backwards-compatible with rows seeded before the migration.
 */
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

  @Index('IDX_features_category')
  @Column({ type: 'varchar', length: 80, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  icon: string | null;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @Column({ name: 'price_monthly', type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceMonthly: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => PlanFeature, (planFeature) => planFeature.feature)
  planFeatures: PlanFeature[];

  @OneToMany(() => SubscriptionFeature, (subscriptionFeature) => subscriptionFeature.feature)
  subscriptionFeatures: SubscriptionFeature[];
}
