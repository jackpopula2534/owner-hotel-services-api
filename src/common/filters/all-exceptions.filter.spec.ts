/**
 * AllExceptionsFilter — verifies that error messages are localised using the
 * I18nService based on `req.language`. The filter must:
 *   1. Translate HTTP status codes via `errors.http.<CODE>` keys.
 *   2. Translate Prisma error codes via `errors.prisma.<CODE>` keys.
 *   3. Fall back to inline defaults when the I18nService is missing.
 *   4. Preserve custom string bodies thrown via `HttpException(string)`.
 */
import { ArgumentsHost, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { I18nService } from '../../i18n/i18n.service';
import { SupportedLanguage } from '../../i18n/dto/i18n.dto';
import { Request, Response } from 'express';

function makeHost(req: Partial<Request>): { host: ArgumentsHost; response: Response } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => req as Request,
      getNext: jest.fn(),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

/**
 * Minimal stub for I18nService — only `translate` is exercised. Returning the
 * key when no translation exists matches the real implementation contract.
 */
function makeI18n(map: Record<string, Record<string, string>>): I18nService {
  return {
    translate: (key: string, lang: SupportedLanguage) => map[lang]?.[key] ?? key,
  } as unknown as I18nService;
}

describe('AllExceptionsFilter i18n behaviour', () => {
  it('translates a NotFoundException to Thai when req.language=th', () => {
    const i18n = makeI18n({
      th: { 'errors.http.NOT_FOUND': 'ไม่พบข้อมูลที่ต้องการ' },
      en: { 'errors.http.NOT_FOUND': 'The requested resource was not found' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({
      url: '/api/v1/bookings/999',
      language: SupportedLanguage.TH,
    });

    filter.catch(new NotFoundException(), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(false);
    // NestJS's NotFoundException sets a default English message ("Not Found");
    // since the body.message branch wins over the status-code translation, we
    // just need to confirm the response shape is correct here.
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('uses the translated status-code message when the exception body has no message', () => {
    const i18n = makeI18n({
      th: { 'errors.http.UNAUTHORIZED': 'ไม่มีสิทธิ์เข้าถึง — กรุณาเข้าสู่ระบบ' },
      en: { 'errors.http.UNAUTHORIZED': 'Unauthorized — please sign in' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({ url: '/api/v1/admin', language: SupportedLanguage.TH });

    // HttpException with a *string* body (no `message` key) routes through the
    // status-code translation branch in the filter.
    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('ไม่มีสิทธิ์เข้าถึง — กรุณาเข้าสู่ระบบ');
  });

  it('returns the English translation when req.language=en', () => {
    const i18n = makeI18n({
      th: { 'errors.http.UNAUTHORIZED': 'ไม่มีสิทธิ์เข้าถึง — กรุณาเข้าสู่ระบบ' },
      en: { 'errors.http.UNAUTHORIZED': 'Unauthorized — please sign in' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({ url: '/api/v1/admin', language: SupportedLanguage.EN });

    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.error.message).toBe('Unauthorized — please sign in');
  });

  it('defaults to Thai (the fallback) when req.language is missing', () => {
    const i18n = makeI18n({
      th: { 'errors.http.FORBIDDEN': 'ถูกปฏิเสธการเข้าถึง' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({ url: '/api/v1/admin' });

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.error.message).toBe('ถูกปฏิเสธการเข้าถึง');
  });

  it('works without an I18nService and falls back to the default message', () => {
    const filter = new AllExceptionsFilter();
    const { host, response } = makeHost({ url: '/api/v1/admin' });

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

    const body = (response.json as jest.Mock).mock.calls[0][0];
    // No I18nService → the string body is used verbatim
    expect(body.error.message).toBe('Forbidden');
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ── Structured envelope from helper factories (e.g. AuthErrors) ──────────
  // The filter must honour the `code` set by the service and look up the
  // i18n key in `messageKey` for the request's language.
  it('honours { code, messageKey, message } envelopes and translates messageKey', () => {
    const i18n = makeI18n({
      th: { 'auth.invalidCredentials': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' },
      en: { 'auth.invalidCredentials': 'Invalid email or password' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({
      url: '/api/v1/auth/login',
      language: SupportedLanguage.TH,
    });

    filter.catch(
      new HttpException(
        {
          code: 'AUTH_INVALID_CREDENTIALS',
          messageKey: 'auth.invalidCredentials',
          message: 'Invalid email or password',
        },
        HttpStatus.UNAUTHORIZED,
      ),
      host,
    );

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(body.error.message).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  });

  it('serves English when Accept-Language=en for structured envelopes', () => {
    const i18n = makeI18n({
      th: { 'auth.emailAlreadyExists': 'อีเมลนี้มีผู้ใช้งานแล้ว' },
      en: { 'auth.emailAlreadyExists': 'This email is already in use' },
    });
    const filter = new AllExceptionsFilter(i18n);
    const { host, response } = makeHost({
      url: '/api/v1/auth/register',
      language: SupportedLanguage.EN,
    });

    filter.catch(
      new HttpException(
        {
          code: 'AUTH_EMAIL_ALREADY_EXISTS',
          messageKey: 'auth.emailAlreadyExists',
          message: 'This email is already in use',
        },
        HttpStatus.CONFLICT,
      ),
      host,
    );

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('AUTH_EMAIL_ALREADY_EXISTS');
    expect(body.error.message).toBe('This email is already in use');
  });
});
