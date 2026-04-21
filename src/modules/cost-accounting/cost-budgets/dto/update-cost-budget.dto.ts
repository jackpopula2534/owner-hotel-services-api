import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCostBudgetDto {
  @ApiProperty({
    description: 'Budget amount (number)',
    example: 5500.0,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @ApiProperty({
    description: 'Notes or comments about the budget',
    example: 'Adjusted allocation',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
