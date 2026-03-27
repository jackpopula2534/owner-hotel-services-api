import { Controller, Get, Post, Body, Query, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { I18nService } from './i18n.service';
import {
  SupportedLanguage,
  TranslateDto,
  TranslateBulkDto,
  TranslationResponseDto,
  LanguageInfoDto,
  TranslationNamespaceDto,
} from './dto/i18n.dto';

@ApiTags('i18n / Translations')
@Controller('api/v1/i18n')
export class I18nController {
  constructor(private readonly i18nService: I18nService) {}

  /**
   * Get available languages
   */
  @Get('languages')
  @ApiOperation({ summary: 'Get available languages' })
  @ApiResponse({ status: 200, type: [LanguageInfoDto] })
  getLanguages(): LanguageInfoDto[] {
    return this.i18nService.getLanguages();
  }

  /**
   * Get available namespaces
   */
  @Get('namespaces')
  @ApiOperation({ summary: 'Get available translation namespaces' })
  @ApiQuery({ name: 'language', enum: SupportedLanguage, required: false })
  @ApiResponse({ status: 200, type: [String] })
  getNamespaces(@Query('language') language: SupportedLanguage = SupportedLanguage.TH): string[] {
    return this.i18nService.getNamespaces(language);
  }

  /**
   * Get all translations for a language
   */
  @Get('translations/:language')
  @ApiOperation({ summary: 'Get all translations for a language' })
  @ApiParam({ name: 'language', enum: SupportedLanguage })
  @ApiResponse({ status: 200, description: 'Returns all translations' })
  getAllTranslations(@Param('language') language: SupportedLanguage): Record<string, any> {
    const translations = this.i18nService.getAllTranslations(language);
    return translations || {};
  }

  /**
   * Get translations for a specific namespace
   */
  @Get('translations/:language/:namespace')
  @ApiOperation({ summary: 'Get translations for a specific namespace' })
  @ApiParam({ name: 'language', enum: SupportedLanguage })
  @ApiParam({ name: 'namespace', description: 'e.g., common, booking, payment' })
  @ApiResponse({ status: 200, description: 'Returns namespace translations' })
  getNamespaceTranslations(
    @Param('language') language: SupportedLanguage,
    @Param('namespace') namespace: string,
  ): Record<string, any> {
    const translations = this.i18nService.getNamespace(namespace, language);
    return translations || {};
  }

  /**
   * Translate a single key
   */
  @Post('translate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Translate a single key' })
  @ApiResponse({ status: 200, type: TranslationResponseDto })
  translate(@Body() dto: TranslateDto): TranslationResponseDto {
    const value = this.i18nService.translate(dto.key, dto.language, dto.variables);
    return {
      key: dto.key,
      value,
      language: dto.language,
    };
  }

  /**
   * Translate multiple keys at once
   */
  @Post('translate/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Translate multiple keys at once' })
  @ApiResponse({ status: 200, description: 'Returns translated key-value pairs' })
  translateBulk(@Body() dto: TranslateBulkDto): Record<string, string> {
    return this.i18nService.translateBulk(dto.keys, dto.language);
  }

  /**
   * Get translation by key via GET request
   */
  @Get('t/:key')
  @ApiOperation({ summary: 'Get translation by key' })
  @ApiParam({
    name: 'key',
    description: 'Translation key (use dot notation, e.g., common.welcome)',
  })
  @ApiQuery({ name: 'lang', enum: SupportedLanguage, required: false })
  @ApiResponse({ status: 200, type: TranslationResponseDto })
  getTranslation(
    @Param('key') key: string,
    @Query('lang') lang: SupportedLanguage = SupportedLanguage.TH,
  ): TranslationResponseDto {
    const value = this.i18nService.translate(key, lang);
    return {
      key,
      value,
      language: lang,
    };
  }

  /**
   * Search translations
   */
  @Get('search')
  @ApiOperation({ summary: 'Search translations by text' })
  @ApiQuery({ name: 'q', description: 'Search query' })
  @ApiQuery({ name: 'language', enum: SupportedLanguage, required: false })
  @ApiResponse({ status: 200, type: [TranslationResponseDto] })
  searchTranslations(
    @Query('q') query: string,
    @Query('language') language: SupportedLanguage = SupportedLanguage.TH,
  ): TranslationResponseDto[] {
    return this.i18nService.searchTranslations(query, language);
  }

  /**
   * Check if translation key exists
   */
  @Get('exists/:key')
  @ApiOperation({ summary: 'Check if translation key exists' })
  @ApiParam({ name: 'key', description: 'Translation key' })
  @ApiQuery({ name: 'language', enum: SupportedLanguage, required: false })
  @ApiResponse({ status: 200 })
  checkTranslationExists(
    @Param('key') key: string,
    @Query('language') language: SupportedLanguage = SupportedLanguage.TH,
  ): { key: string; exists: boolean; language: string } {
    const exists = this.i18nService.hasTranslation(key, language);
    return { key, exists, language };
  }

  /**
   * Reload translations from files (admin only)
   */
  @Post('reload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reload translations from files' })
  @ApiResponse({ status: 200 })
  reloadTranslations(): { success: boolean; message: string } {
    this.i18nService.reloadTranslations();
    return { success: true, message: 'Translations reloaded successfully' };
  }
}
