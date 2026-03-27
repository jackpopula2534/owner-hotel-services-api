import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SupportedLanguage {
  TH = 'th',
  EN = 'en',
}

export class TranslateDto {
  @ApiProperty({ description: 'Translation key (e.g., "common.welcome")' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ enum: SupportedLanguage, description: 'Target language' })
  @IsEnum(SupportedLanguage)
  language: SupportedLanguage;

  @ApiPropertyOptional({ description: 'Variables to interpolate' })
  @IsObject()
  @IsOptional()
  variables?: Record<string, string | number>;
}

export class TranslateBulkDto {
  @ApiProperty({
    description: 'Array of translation keys',
    type: [String],
  })
  @IsString({ each: true })
  keys: string[];

  @ApiProperty({ enum: SupportedLanguage, description: 'Target language' })
  @IsEnum(SupportedLanguage)
  language: SupportedLanguage;
}

export class UpdateTranslationDto {
  @ApiProperty({ description: 'Translation key' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ enum: SupportedLanguage, description: 'Language' })
  @IsEnum(SupportedLanguage)
  language: SupportedLanguage;

  @ApiProperty({ description: 'Translation value' })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class TranslationResponseDto {
  key: string;
  value: string;
  language: string;
}

export class LanguageInfoDto {
  code: string;
  name: string;
  nativeName: string;
  isDefault: boolean;
}

export class TranslationNamespaceDto {
  @ApiProperty({ description: 'Namespace to fetch (e.g., "common", "booking")' })
  @IsString()
  @IsNotEmpty()
  namespace: string;

  @ApiProperty({ enum: SupportedLanguage, description: 'Target language' })
  @IsEnum(SupportedLanguage)
  language: SupportedLanguage;
}
