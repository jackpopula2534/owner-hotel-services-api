import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  SupportedLanguage,
  TranslationResponseDto,
  LanguageInfoDto,
} from './dto/i18n.dto';

@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);
  private translations: Map<string, Record<string, any>> = new Map();
  private readonly defaultLanguage = SupportedLanguage.TH;
  private readonly translationsPath: string;

  constructor() {
    this.translationsPath = path.join(__dirname, 'translations');
    this.loadTranslations();
  }

  /**
   * Load all translation files
   */
  private loadTranslations(): void {
    const languages = Object.values(SupportedLanguage);

    for (const lang of languages) {
      try {
        const filePath = path.join(this.translationsPath, `${lang}.json`);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          this.translations.set(lang, JSON.parse(content));
          this.logger.log(`Loaded translations for ${lang}`);
        } else {
          this.logger.warn(`Translation file not found: ${filePath}`);
        }
      } catch (error) {
        this.logger.error(`Failed to load translations for ${lang}: ${error.message}`);
      }
    }
  }

  /**
   * Reload translations from files
   */
  reloadTranslations(): void {
    this.translations.clear();
    this.loadTranslations();
    this.logger.log('Translations reloaded');
  }

  /**
   * Get translation by key
   */
  translate(
    key: string,
    language: SupportedLanguage = this.defaultLanguage,
    variables?: Record<string, string | number>,
  ): string {
    const translations = this.translations.get(language);

    if (!translations) {
      return this.getFallback(key, variables);
    }

    const value = this.getNestedValue(translations, key);

    if (value === undefined) {
      // Try fallback to default language
      if (language !== this.defaultLanguage) {
        const fallbackTranslations = this.translations.get(this.defaultLanguage);
        if (fallbackTranslations) {
          const fallbackValue = this.getNestedValue(fallbackTranslations, key);
          if (fallbackValue !== undefined) {
            return this.interpolate(fallbackValue, variables);
          }
        }
      }
      return this.getFallback(key, variables);
    }

    return this.interpolate(value, variables);
  }

  /**
   * Get multiple translations at once
   */
  translateBulk(
    keys: string[],
    language: SupportedLanguage = this.defaultLanguage,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const key of keys) {
      result[key] = this.translate(key, language);
    }

    return result;
  }

  /**
   * Get all translations for a namespace
   */
  getNamespace(
    namespace: string,
    language: SupportedLanguage = this.defaultLanguage,
  ): Record<string, any> | null {
    const translations = this.translations.get(language);

    if (!translations || !translations[namespace]) {
      return null;
    }

    return translations[namespace];
  }

  /**
   * Get all translations for a language
   */
  getAllTranslations(language: SupportedLanguage): Record<string, any> | null {
    return this.translations.get(language) || null;
  }

  /**
   * Get available languages
   */
  getLanguages(): LanguageInfoDto[] {
    return [
      {
        code: 'th',
        name: 'Thai',
        nativeName: 'ไทย',
        isDefault: true,
      },
      {
        code: 'en',
        name: 'English',
        nativeName: 'English',
        isDefault: false,
      },
    ];
  }

  /**
   * Get all available namespaces
   */
  getNamespaces(language: SupportedLanguage = this.defaultLanguage): string[] {
    const translations = this.translations.get(language);
    if (!translations) {
      return [];
    }
    return Object.keys(translations);
  }

  /**
   * Check if a translation key exists
   */
  hasTranslation(key: string, language: SupportedLanguage): boolean {
    const translations = this.translations.get(language);
    if (!translations) {
      return false;
    }
    return this.getNestedValue(translations, key) !== undefined;
  }

  /**
   * Search translations by text
   */
  searchTranslations(
    query: string,
    language: SupportedLanguage = this.defaultLanguage,
  ): TranslationResponseDto[] {
    const results: TranslationResponseDto[] = [];
    const translations = this.translations.get(language);

    if (!translations) {
      return results;
    }

    const flatTranslations = this.flattenObject(translations);
    const lowerQuery = query.toLowerCase();

    for (const [key, value] of Object.entries(flatTranslations)) {
      if (
        key.toLowerCase().includes(lowerQuery) ||
        value.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          key,
          value,
          language,
        });
      }
    }

    return results;
  }

  /**
   * Helper: Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Helper: Interpolate variables in translation string
   */
  private interpolate(
    template: string,
    variables?: Record<string, string | number>,
  ): string {
    if (!variables || typeof template !== 'string') {
      return template;
    }

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key]?.toString() ?? match;
    });
  }

  /**
   * Helper: Get fallback value when translation not found
   */
  private getFallback(key: string, variables?: Record<string, string | number>): string {
    // Return the key itself as fallback
    return key;
  }

  /**
   * Helper: Flatten nested object to dot notation keys
   */
  private flattenObject(
    obj: Record<string, any>,
    prefix = '',
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value, newKey));
      } else if (typeof value === 'string') {
        result[newKey] = value;
      }
    }

    return result;
  }

  /**
   * Get translation for email templates
   */
  getEmailTranslations(language: SupportedLanguage = this.defaultLanguage): Record<string, any> {
    const translations = this.translations.get(language);
    if (!translations) {
      return {};
    }

    return {
      common: translations.common || {},
      booking: translations.booking || {},
      payment: translations.payment || {},
      notification: translations.notification || {},
    };
  }
}
