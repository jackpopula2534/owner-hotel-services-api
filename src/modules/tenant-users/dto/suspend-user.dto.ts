import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuspendUserDto {
  @ApiProperty({ example: 'ลาออก — รอส่งมอบงาน' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
