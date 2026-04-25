import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RejectComparisonDto {
  @ApiProperty({ description: 'เหตุผลที่ปฏิเสธ', minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason!: string;
}
