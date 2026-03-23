import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RejectPaymentDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the admin rejecting this payment'
  })
  @IsString()
  adminId: string;

  @ApiPropertyOptional({
    example: 'Payment slip is unclear, please resubmit',
    description: 'Reason for rejecting the payment'
  })
  @IsString()
  @IsOptional()
  reason?: string;
}


