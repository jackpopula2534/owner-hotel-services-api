import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { Payment } from '../../payments/entities/payment.entity';

export enum AdminRole {
  SUPER = 'super',
  FINANCE = 'finance',
  SUPPORT = 'support',
}

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({
    type: 'enum',
    enum: AdminRole,
  })
  role: AdminRole;

  @OneToMany(() => Payment, (payment) => payment.approver)
  approvedPayments: Payment[];
}


