import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Payment } from './payment.entity';

export enum RefundStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

export enum RefundMethod {
  ORIGINAL_METHOD = 'original_method', // Refund to original payment method
  BANK_TRANSFER = 'bank_transfer',
  CREDIT = 'credit',                   // Add to tenant credit balance
}

@Entity('payment_refunds')
export class PaymentRefund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payment_id' })
  paymentId: string;

  @Column({ name: 'refund_no', unique: true })
  refundNo: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Column({
    type: 'enum',
    enum: RefundMethod,
    default: RefundMethod.ORIGINAL_METHOD,
  })
  method: RefundMethod;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'bank_account', nullable: true })
  bankAccount: string;

  @Column({ name: 'bank_name', nullable: true })
  bankName: string;

  @Column({ name: 'account_holder', nullable: true })
  accountHolder: string;

  @Column({ name: 'credit_id', nullable: true })
  creditId: string; // If refund as credit, link to tenant_credits

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ name: 'processed_by', nullable: true })
  processedBy: string;

  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
