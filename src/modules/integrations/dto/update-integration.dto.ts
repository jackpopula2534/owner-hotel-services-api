import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiProperty({
    example: true,
    description: 'เปิด (true) หรือปิด (false) การเชื่อมต่อระหว่าง Sub-System นี้',
  })
  @IsBoolean()
  enabled: boolean;
}
