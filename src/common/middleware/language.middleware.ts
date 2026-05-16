/**
 * Language middleware — resolves the request locale from:
 *   1. `?lang=` query parameter
 *   2. `Accept-Language` HTTP header
 *   3. Falls back to Thai (default)
 *
 * The resolved locale is attached to the request as `req.language` so that
 * downstream filters, interceptors, and services (especially
 * `AllExceptionsFilter`) can localise error messages per request.
 */
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SupportedLanguage } from '../../i18n/dto/i18n.dto';

declare module 'express' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Request {
    language?: SupportedLanguage;
  }
}

@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LanguageMiddleware.name);
  private readonly supported = new Set<string>(Object.values(SupportedLanguage));
  private readonly fallback = SupportedLanguage.TH;

  use(req: Request, _res: Response, next: NextFunction): void {
    req.language = this.resolve(req);
    next();
  }

  /**
   * Resolve language from query > header > fallback.
   * Accept-Language can be a list like "th-TH,th;q=0.9,en-US;q=0.8" — we pick
   * the first tag whose 2-letter prefix is in our supported set.
   */
  private resolve(req: Request): SupportedLanguage {
    const queryLang = this.normalise(req.query?.lang as string | undefined);
    if (queryLang) return queryLang;

    const headerLang = this.parseAcceptLanguage(req.headers['accept-language']);
    if (headerLang) return headerLang;

    return this.fallback;
  }

  private normalise(raw: string | undefined): SupportedLanguage | null {
    if (!raw) return null;
    const code = raw.trim().toLowerCase().slice(0, 2);
    return this.supported.has(code) ? (code as SupportedLanguage) : null;
  }

  private parseAcceptLanguage(header: string | undefined): SupportedLanguage | null {
    if (!header) return null;
    // Split "th-TH,th;q=0.9,en;q=0.8" → ["th-TH", "th;q=0.9", "en;q=0.8"]
    const tags = header.split(',').map((t) => t.split(';')[0].trim());
    for (const tag of tags) {
      const match = this.normalise(tag);
      if (match) return match;
    }
    return null;
  }
}
