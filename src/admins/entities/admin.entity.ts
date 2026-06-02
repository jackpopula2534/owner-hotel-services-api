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

  // Per-admin menu access (Prisma: menuAccess Json?). NULL/empty = full access.
  // ต้องประกาศที่นี่ด้วย ไม่งั้น dataSource.synchronize() ใน db:refresh จะ DROP คอลัมน์นี้ทิ้ง
  @Column({ type: 'json', nullable: true })
  menuAccess: unknown;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
