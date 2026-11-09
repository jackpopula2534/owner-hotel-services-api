import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LinkIngredientsDto {
  @ApiPropertyOptional({ description: 'Scope linking to a single restaurant' })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({
    description:
      'Create a minimal inventory item for ingredient names with no match (default true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createMissing?: boolean;
}
