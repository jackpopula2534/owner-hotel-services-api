import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GuestLookupDto {
  @ApiProperty({
    description: 'Search query: guest name (firstName or lastName) or nationalId',
    example: 'Sompong',
  })
  @IsString()
  @MinLength(1)
  query: string;
}
