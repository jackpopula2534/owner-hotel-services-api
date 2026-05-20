/**
 * LanguageMiddleware — resolves the request locale from `?lang=` query first,
 * then `Accept-Language` header (with quality-weighted tags), falling back to
 * Thai. Downstream filters/services read `req.language` to localise responses.
 */
import { LanguageMiddleware } from './language.middleware';
import { SupportedLanguage } from '../../i18n/dto/i18n.dto';
import { Request, Response, NextFunction } from 'express';

function makeRequest(
  opts: {
    query?: Record<string, string>;
    acceptLanguage?: string;
  } = {},
): Request {
  return {
    query: opts.query ?? {},
    headers: opts.acceptLanguage ? { 'accept-language': opts.acceptLanguage } : {},
  } as unknown as Request;
}

describe('LanguageMiddleware', () => {
  let middleware: LanguageMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new LanguageMiddleware();
    next = jest.fn();
  });

  it('falls back to Thai when no query or header is provided', () => {
    const req = makeRequest();
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.TH);
    expect(next).toHaveBeenCalled();
  });

  it('honours `?lang=` query parameter over header', () => {
    const req = makeRequest({
      query: { lang: 'en' },
      acceptLanguage: 'th-TH,th;q=0.9',
    });
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.EN);
  });

  it('parses Accept-Language header with quality weights', () => {
    const req = makeRequest({
      acceptLanguage: 'en-US,en;q=0.9,th;q=0.8',
    });
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.EN);
  });

  it('extracts language from a regional tag (th-TH)', () => {
    const req = makeRequest({ acceptLanguage: 'th-TH' });
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.TH);
  });

  it('falls back to Thai when query lang is unsupported', () => {
    const req = makeRequest({ query: { lang: 'jp' } });
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.TH);
  });

  it('skips unsupported languages in header and picks the first supported one', () => {
    const req = makeRequest({
      acceptLanguage: 'jp,ko,en-US;q=0.9',
    });
    middleware.use(req, {} as Response, next);
    expect(req.language).toBe(SupportedLanguage.EN);
  });

  it('always calls next()', () => {
    const req = makeRequest({ acceptLanguage: 'th' });
    middleware.use(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
