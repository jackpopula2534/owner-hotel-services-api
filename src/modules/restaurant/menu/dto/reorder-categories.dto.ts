import { IsArray, IsNotEmpty, IsString, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CategoryOrderItemDto {
  @ApiProperty({ example: 'uuid-category-id' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class ReorderCategoriesDto {
  @ApiProperty({ type: [CategoryOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderItemDto)
  categories: CategoryOrderItemDto[];
}
