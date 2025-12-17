import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Plan } from '../../plans/entities/plan.entity';
import { Feature } from '../../features/entities/feature.entity';

@Entity('plan_features')
export class PlanFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'feature_id' })
  featureId: string;

  @ManyToOne(() => Plan, (plan) => plan.planFeatures)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @ManyToOne(() => Feature, (feature) => feature.planFeatures)
  @JoinColumn({ name: 'feature_id' })
  feature: Feature;
}


