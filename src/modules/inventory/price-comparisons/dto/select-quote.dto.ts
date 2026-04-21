import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectQuoteDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174003',
    description: 'Supplier quote ID to select',
  })
  @IsString()
  selectedQuoteId: string;

  @ApiProperty({
    example: 'Best price with fast delivery',
    description: 'Reason for selecting this quote',
    required: false,
  })
  @IsOptional()
  @IsString()
  selectionReason?: string;
}
