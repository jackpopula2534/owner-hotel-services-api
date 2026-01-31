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

  @Column({ name: 'price_yearly', type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceYearly: number;

  @Column({ name: 'yearly_discount_percent', type: 'int', default: 0 })
  yearlyDiscountPercent: number; // เปอร์เซ็นต์ส่วนลดสำหรับรายปี (0-100)

  @Column({ name: 'max_rooms', type: 'int' })
  maxRooms: number;

  @Column({ name: 'max_users', type: 'int' })
  maxUsers: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Sales Page fields
  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_popular', default: false })
  isPopular: boolean;

  @Column({ type: 'text', nullable: true })
  badge: string;

  @Column({ name: 'highlight_color', type: 'varchar', length: 50, nullable: true })
  highlightColor: string;

  @Column({ type: 'text', nullable: true })
  features: string; // JSON stringified array of feature strings

  @Column({ name: 'button_text', type: 'varchar', length: 100, nullable: true, default: 'เริ่มใช้งาน' })
  buttonText: string;

  @OneToMany(() => PlanFeature, (planFeature) => planFeature.plan)
  planFeatures: PlanFeature[];

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];
}


