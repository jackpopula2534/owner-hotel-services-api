import { IsString, IsNumber, IsInt, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({
    example: 'S',
    description: 'Unique plan code identifier (S=Starter, M=Professional, L=Enterprise)',
  })
  @IsString()
  code: string;

  @ApiProperty({
    example: 'Starter',
    description: 'Plan display name',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 1990,
    description: 'Monthly price in Thai Baht (THB)',
  })
  @IsNumber()
  priceMonthly: number;

  @ApiProperty({
    example: 20,
    description: 'Maximum number of rooms allowed in this plan',
  })
  @IsInt()
  maxRooms: number;

  @ApiProperty({
    example: 3,
    description: 'Maximum number of users allowed in this plan',
  })
  @IsInt()
  maxUsers: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this plan is active and available for purchase',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
