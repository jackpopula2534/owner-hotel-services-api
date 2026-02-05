import {
  Entity,
  PrimaryGeneratedColumn,
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
  @PrimaryColumn({ type: 'char', length: 36 })
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
