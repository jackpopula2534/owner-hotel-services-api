import { IsNotEmpty, IsString, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferDto {
  @ApiProperty({ description: 'Source warehouse ID' })
  @IsNotEmpty()
  @IsString()
  fromWarehouseId: string;

  @ApiProperty({ description: 'Target warehouse ID' })
  @IsNotEmpty()
  @IsString()
  toWarehouseId: string;

  @ApiProperty({ description: 'Inventory Item ID' })
  @IsNotEmpty()
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'Quantity to transfer' })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'Transfer notes/remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
}
