import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { PlanFeature } from '../../plan-features/entities/plan-feature.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string; // S, M, L

  @Column()
  name: string;

  @Column({ name: 'price_monthly', type: 'decimal', precision: 10, scale: 2 })
  priceMonthly: number;

  @Column({ name: 'max_rooms', type: 'int' })
  maxRooms: number;

  @Column({ name: 'max_users', type: 'int' })
  maxUsers: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => PlanFeature, (planFeature) => planFeature.plan)
  planFeatures: PlanFeature[];

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];
}


