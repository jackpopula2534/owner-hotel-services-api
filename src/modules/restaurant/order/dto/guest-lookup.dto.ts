import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GuestLookupDto {
  @ApiProperty({
    description: 'Search query: guest first or last name only. National ID lookup is intentionally disabled for PDPA data minimization.',
    example: 'Sompong',
  })
  @IsString()
  @MinLength(2)
  query: string;
}
