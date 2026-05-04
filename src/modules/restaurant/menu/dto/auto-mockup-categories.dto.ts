import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Optional payload for the `POST /restaurants/:restaurantId/menu-categories/auto-mockup`
 * endpoint. Callers can request a specific number of categories within the
 * supported [5, 10] range. When omitted, the service picks a random count.
 */
export class AutoMockupCategoriesDto {
  @ApiPropertyOptional({
    minimum: 5,
    maximum: 10,
    example: 8,
    description: 'How many mockup categories to insert. Defaults to a random number between 5 and 10.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10)
  @IsOptional()
  count?: number;
}
