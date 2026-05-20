/**
 * Global exception filter — catches every unhandled exception and converts it
 * to the project-standard error envelope defined in api-design.md:
 *
 *   { "success": false, "error": { "code": "...", "message": "..." } }
 *
 * Additional debug fields (timestamp, path, requestId) are included to aid
 * log correlation; they are never sensitive and are safe to expose.
 *
 * instanceof check order matters — always most-specific before most-general:
 *   HttpException  >  Prisma known  >  Prisma validation
 *   >  QueryFailedError  >  EntityNotFoundError  >  TypeORMError  >  Error
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { QueryFailedError, EntityNotFoundError, TypeORMError } from 'typeorm';
import { I18nService } from '../../i18n/i18n.service';
import { SupportedLanguage } from '../../i18n/dto/i18n.dto';

/** Shape matching api-design.md */
interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
  timestamp: string;
  path: string;
  requestId?: string;
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // I18nService is optional so the filter still works in unit tests that
  // construct the filter directly without a Nest container.
  constructor(@Optional() private readonly i18n?: I18nService) {}

  /**
   * Look up `key` in the I18nService for the request's locale, falling back to
   * `defaultMessage` if the service or key is missing.
   */
  private t(key: string, lang: SupportedLanguage, defaultMessage: string): string {
    if (!this.i18n) return defaultMessage;
    const translated = this.i18n.translate(key, lang);
    // The I18nService returns the key itself when the translation is missing —
    // treat that as a miss and fall through to the inline default.
    return translated && translated !== key ? translated : defaultMessage;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any)['requestId'] as string | undefined;
    const language = (request.language as SupportedLanguage) ?? SupportedLanguage.TH;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = this.t('errors.http.INTERNAL_SERVER_ERROR', language, 'Internal server error');

    // ─── NestJS / HTTP ────────────────────────────────────────────────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        // String body — translate when it's a known status code, otherwise pass through
        code = this.statusToCode(status);
        message = this.t(`errors.http.${code}`, language, body);
      } else {
        const b = body as Record<string, any>;

        // ─── Structured error envelope from helper factories ────────────────
        // Services can throw HttpException whose body is a plain object with
        // { code, messageKey, message, details? } — see modules/auth/auth-errors.ts
        // for the canonical pattern. We honour the `code` directly (stable
        // contract for the frontend) and look up `messageKey` via i18n so the
        // response is localised per Accept-Language header.
        const hasStructuredCode = typeof b.code === 'string' && b.code.length > 0;
        const hasMessageKey = typeof b.messageKey === 'string' && b.messageKey.length > 0;

        if (hasStructuredCode) {
          code = b.code as string;
        }

        if (Array.isArray(b.message)) {
          // class-validator returns array of validation messages — translate per-line
          message = this.translateValidationMessages(b.message, language);
          if (!hasStructuredCode) {
            code = b.error
              ? String(b.error).toUpperCase().replace(/\s+/g, '_')
              : this.statusToCode(status);
          }
        } else if (hasMessageKey) {
          // Prefer the i18n key — falls back to the supplied English `message`
          // if the translation file doesn't contain it yet.
          const fallback = typeof b.message === 'string' ? b.message : exception.message;
          message = this.t(b.messageKey as string, language, fallback);
        } else if (b.message) {
          message = b.message;
          if (!hasStructuredCode) {
            code = b.error
              ? String(b.error).toUpperCase().replace(/\s+/g, '_')
              : this.statusToCode(status);
          }
        } else {
          if (!hasStructuredCode) {
            code = this.statusToCode(status);
          }
          message = this.t(`errors.http.${code}`, language, exception.message);
        }
      }

      // ─── Prisma known errors ──────────────────────────────────────────────
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Schema not yet migrated — return graceful empty payload (P2021/P2022)
      // ONLY for GET requests; write operations (POST/PUT/PATCH/DELETE) must
      // surface the error so the frontend knows data was NOT persisted.
      if (exception.code === 'P2021' || exception.code === 'P2022') {
        if (request.method === 'GET') {
          this.logger.warn(`Database schema not ready (${exception.code}): returning empty data`);
          const emptyPayload: Record<string, unknown> = {
            success: true,
            data: [],
            meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
            timestamp: new Date().toISOString(),
            path: request.url,
          };
          if (request.url.includes('/notifications')) {
            emptyPayload.items = emptyPayload.data;
            delete emptyPayload.data;
          }
          response.status(200).json(emptyPayload);
          return;
        }
        // Non-GET: fall through to return a proper error so clients know the write failed
        this.logger.error(
          `Database schema not ready (${exception.code}) on ${request.method} ${request.url} — write operation failed`,
        );
        status = HttpStatus.SERVICE_UNAVAILABLE;
        code = `SCHEMA_NOT_READY`;
        message = this.t(
          'errors.prisma.SCHEMA_NOT_READY',
          language,
          'Database table not found — please run prisma migrate',
        );
      } else {
        status = this.prismaStatus(exception.code);
        code = `PRISMA_${exception.code}`;
        message = this.getPrismaMessage(exception, language);
        this.logger.error(`Prisma ${exception.code}: ${exception.message}`, undefined, requestId);
      }

      // ─── Prisma validation ────────────────────────────────────────────────
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      // The Prisma client throws this when the input shape doesn't match the
      // generated schema. The most common cause in dev is a stale client that
      // hasn't been regenerated after a schema change — surface that hint so
      // the team doesn't have to dig into server logs.
      const prismaMsg = exception.message || '';
      // Extract the first meaningful line from the Prisma error (it tends to be verbose)
      const firstLine = prismaMsg.split('\n').find((l) => l.trim().length > 0) ?? prismaMsg;
      const looksLikeUnknownArg = /Unknown (arg|argument) `(?<field>[^`]+)`/.exec(prismaMsg);
      const looksLikeInvalidValue = /Invalid value for argument `(?<field>[^`]+)`/.exec(prismaMsg);
      const looksLikeMissing = /Argument `(?<field>[^`]+)` is missing/.exec(prismaMsg);
      if (looksLikeUnknownArg?.groups?.field) {
        message = `ข้อมูลไม่ถูกต้อง: ฟิลด์ "${looksLikeUnknownArg.groups.field}" ไม่อยู่ใน Prisma client — กรุณา run \`npm run prisma:migrate\` เพื่อ regenerate client หลัง pull schema ใหม่`;
      } else if (looksLikeMissing?.groups?.field) {
        message = `ข้อมูลไม่ครบ: ฟิลด์ "${looksLikeMissing.groups.field}" จำเป็นต้องระบุค่า (required field missing)`;
      } else if (looksLikeInvalidValue?.groups?.field) {
        message = `ค่าไม่ถูกต้อง: ฟิลด์ "${looksLikeInvalidValue.groups.field}" มีประเภทข้อมูลผิด — ${firstLine}`;
      } else {
        message = `ข้อมูลไม่ถูกต้องตามโครงสร้างฐานข้อมูล — ${firstLine.substring(0, 120)}`;
      }
      this.logger.error(`Prisma validation: ${prismaMsg}`, undefined, requestId);

      // ─── TypeORM query failed ─────────────────────────────────────────────
    } else if (exception instanceof QueryFailedError) {
      status = this.typeOrmQueryStatus(exception);
      code = `DB_${(exception as any).code ?? 'QUERY_FAILED'}`;
      message = this.getTypeOrmQueryMessage(exception);
      this.logger.error(
        `TypeORM QueryFailedError [(${(exception as any).code}]: ${exception.message}`,
        undefined,
        requestId,
      );

      // ─── TypeORM entity not found ─────────────────────────────────────────
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      code = 'RECORD_NOT_FOUND';
      message = this.t('errors.prisma.P2025', language, 'Record not found');
      this.logger.warn(`TypeORM EntityNotFound: ${exception.message}`, requestId);

      // ─── TypeORM base (connection lost, etc.) ────────────────────────────
    } else if (exception instanceof TypeORMError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'DATABASE_ERROR';
      message = this.t('errors.serverError', language, 'Database error');
      this.logger.error(`TypeORMError: ${(exception as Error).stack}`, undefined, requestId);

      // ─── Generic / unknown ────────────────────────────────────────────────
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled Error: ${exception.stack}`, undefined, requestId);
    }

    const body: ErrorBody = {
      success: false,
      error: { code, message },
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(requestId ? { requestId } : {}),
    };

    response.status(status).json(body);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Translate class-validator English messages to user-friendly Thai/English.
   * Keeps custom Thai messages (from DTO decorators) as-is.
   */
  private translateValidationMessages(messages: string[], language: SupportedLanguage): string {
    const translations: Record<string, string> = {
      'page must be a number string': 'page ต้องเป็นตัวเลข (เช่น 1, 2, 3)',
      'limit must be a number string': 'limit ต้องเป็นตัวเลข (เช่น 10, 20, 50)',
      'page must be an integer number': 'page ต้องเป็นตัวเลขจำนวนเต็ม',
      'limit must be an integer number': 'limit ต้องเป็นตัวเลขจำนวนเต็ม',
      'page must not be less than 1': 'page ต้องมีค่าอย่างน้อย 1',
      'limit must not be less than 1': 'limit ต้องมีค่าอย่างน้อย 1',
      'limit must not be greater than 100': 'limit ต้องไม่เกิน 100 รายการต่อหน้า',
    };

    const translated = messages.map((msg) => {
      // If the message is already in Thai (contains Thai chars) — keep as-is
      if (/[\u0E00-\u0E7F]/.test(msg)) return msg;
      const lower = msg.toLowerCase();
      return this.t(`errors.validation.${lower}`, language, translations[lower] ?? msg);
    });

    return translated.join(', ');
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? `HTTP_${status}`;
  }

  private prismaStatus(code: string): number {
    const map: Record<string, number> = {
      P2002: HttpStatus.CONFLICT, // unique constraint
      P2025: HttpStatus.NOT_FOUND, // record not found
      P2003: HttpStatus.BAD_REQUEST, // FK constraint
      P2014: HttpStatus.BAD_REQUEST, // relation violation
    };
    return map[code] ?? HttpStatus.BAD_REQUEST;
  }

  private getPrismaMessage(
    exception: Prisma.PrismaClientKnownRequestError,
    language: SupportedLanguage,
  ): string {
    switch (exception.code) {
      case 'P2002': {
        // MySQL returns meta.target as a string (constraint name e.g. "employees_employeeCode_key")
        // PostgreSQL returns it as string[] — handle both
        const rawTarget = exception.meta?.target;
        const target = Array.isArray(rawTarget)
          ? rawTarget.join(', ')
          : typeof rawTarget === 'string'
            ? rawTarget
            : 'field';
        const base = this.t('errors.prisma.P2002', language, 'This record already exists');
        return `${base} (${target})`;
      }
      case 'P2025':
        return this.t('errors.prisma.P2025', language, 'Record not found');
      case 'P2003':
        return this.t('errors.prisma.P2003', language, 'Foreign key constraint failed');
      default:
        return this.t('errors.generic', language, `Database error (${exception.code})`);
    }
  }

  private typeOrmQueryStatus(exception: QueryFailedError): number {
    const code: string = (exception as any).code ?? '';
    const conflictCodes = ['ER_DUP_ENTRY'];
    const notFoundCodes = ['ER_NO_REFERENCED_ROW_2'];
    if (conflictCodes.includes(code)) return HttpStatus.CONFLICT;
    if (notFoundCodes.includes(code)) return HttpStatus.NOT_FOUND;
    return HttpStatus.BAD_REQUEST;
  }

  private getTypeOrmQueryMessage(exception: QueryFailedError): string {
    const code: string = (exception as any).code ?? '';
    switch (code) {
      case 'ER_DUP_ENTRY':
        return 'ข้อมูลนี้มีอยู่ในระบบแล้ว (Duplicate entry)';
      case 'ER_NO_REFERENCED_ROW_2':
      case 'ER_ROW_IS_REFERENCED_2':
        return 'ไม่สามารถดำเนินการได้เนื่องจากสัมพันธ์กับข้อมูลอื่น (Foreign key constraint failed)';
      case 'ER_DATA_TOO_LONG':
        return 'ข้อมูลยาวเกินกว่าที่กำหนด (Data too long for column)';
      default:
        return `เกิดข้อผิดพลาดในการ query ฐานข้อมูล (${code || 'unknown'})`;
    }
  }
}
