import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ResolveQRDto {
  @ApiProperty({ description: 'Signed QR payload string (JSON)' })
  @IsString()
  @IsNotEmpty()
  payload: string;
}
