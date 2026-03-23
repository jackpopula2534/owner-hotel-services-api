import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApprovePaymentDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the admin approving this payment'
  })
  @IsString()
  adminId: string;
}


