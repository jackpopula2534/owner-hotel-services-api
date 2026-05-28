import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteReferralDto {
  @ApiProperty({ example: 'friend@example.com' })
  @IsEmail()
  email: string;
}

export class EarnPointsDto {
  @ApiProperty({
    description: 'Guest who earns the points',
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID()
  guestId: string;

  @ApiProperty({ description: 'Booking amount in THB. 1 point per 100 THB.', example: 2500 })
  @IsInt()
  @Min(0)
  bookingAmount: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiProperty({ required: false, example: 'checkout_award' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RedeemPointsDto {
  @ApiProperty()
  @IsUUID()
  guestId: string;

  @ApiProperty({ description: 'Points to deduct. Must be positive.', example: 500 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  points: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiProperty({ required: false, example: 'discount_voucher_redemption' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdjustPointsDto {
  @ApiProperty()
  @IsUUID()
  guestId: string;

  @ApiProperty({ description: 'Positive or negative point adjustment by admin', example: 100 })
  @IsInt()
  points: number;

  @ApiProperty({ required: false, example: 'manual_compensation' })
  @IsOptional()
  @IsString()
  reason?: string;
}
