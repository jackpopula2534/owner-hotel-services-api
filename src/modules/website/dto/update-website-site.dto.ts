import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { SITE_LANGS, SiteLang, TEMPLATE_KEYS, TemplateKey } from '../website.constants';

/**
 * theme / content / seo เป็น JSON ทั้งก้อน — รูปร่างข้างในตรวจและทำความสะอาด
 * ด้วย sanitize* ใน website-content.ts ไม่ใช่ class-validator
 */
export class UpdateWebsiteSiteDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  slug?: string;

  @ApiProperty({ enum: TEMPLATE_KEYS, required: false })
  @IsOptional()
  @IsIn(TEMPLATE_KEYS)
  templateKey?: TemplateKey;

  @ApiProperty({ enum: SITE_LANGS, required: false })
  @IsOptional()
  @IsIn(SITE_LANGS)
  defaultLang?: SiteLang;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object, description: '{ sections, roomTypes, contact }' })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  seo?: Record<string, unknown>;
}
