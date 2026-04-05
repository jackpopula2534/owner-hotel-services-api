import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Payment } from '../../payments/entities/payment.entity';

export enum AdminRole {
  SUPER = 'super',
  FINANCE = 'finance',
  SUPPORT = 'support',
}
@Entity('admins')
export class Admin {
  // Prisma migration สร้าง id เป็น VARCHAR(36) — ต้องตรง type เพื่อป้องกัน TypeORM synchronize
  // พยายาม ALTER PRIMARY KEY (ซึ่งจะ fail เพราะ refresh_tokens FK อ้างถึง admins.id)
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false }) // Hide password by default
  password: string;

  @Column({
    type: 'varchar',
    default: 'platform_admin',
  })
  role: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  lastLoginIp: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
