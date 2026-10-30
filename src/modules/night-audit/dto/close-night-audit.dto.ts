import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CloseNightAuditDto {
  @ApiPropertyOptional({
    description: 'true = โพสต์ JE เข้า GL ทันที, false = เก็บเป็น DRAFT ให้ฝ่ายบัญชีตรวจ',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  postJournal?: boolean;
}
