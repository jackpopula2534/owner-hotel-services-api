import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ServeItemsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Only these ready items (ส่งที่พร้อมก่อน). Leave out to serve every ready item.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  itemIds?: string[];
}
