import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export enum CreditType {
  MANUAL = 'manual',           // Admin manual credit
  REFUND = 'refund',           // From payment refund
  PRORATION = 'proration',     // From proration calculation
  PROMOTION = 'promotion',     // Promotional credit
  CANCELLATION = 'cancellation', // From subscription cancellation
}

export enum CreditStatus {
  AVAILABLE = 'available',
  USED = 'used',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('tenant_credits')
export class TenantCredit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({
    type: 'enum',
    enum: CreditType,
    default: CreditType.MANUAL,
  })
  type: CreditType;

  @Column({
    type: 'enum',
    enum: CreditStatus,
    default: CreditStatus.AVAILABLE,
  })
  status: CreditStatus;

  @Column({ name: 'original_amount', type: 'decimal', precision: 10, scale: 2 })
  originalAmount: number;

  @Column({ name: 'remaining_amount', type: 'decimal', precision: 10, scale: 2 })
  remainingAmount: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'reference_type', nullable: true })
  referenceType: string; // 'invoice', 'payment', 'subscription', etc.

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  usedAt: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
