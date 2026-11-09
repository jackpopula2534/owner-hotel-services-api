import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangeMyPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' })
  @MaxLength(72)
  newPassword: string;
}
