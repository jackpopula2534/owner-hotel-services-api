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
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { QueryFailedError, EntityNotFoundError, TypeORMError } from 'typeorm';

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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any)['requestId'] as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Internal server error';

    // ─── NestJS / HTTP ────────────────────────────────────────────────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        code = this.statusToCode(status);
      } else {
        const b = body as Record<string, any>;
        if (Array.isArray(b.message)) {
          // class-validator returns array of validation messages — join & translate
          message = this.translateValidationMessages(b.message);
        } else {
          message = b.message ?? exception.message;
        }
        code = b.error
          ? String(b.error).toUpperCase().replace(/\s+/g, '_')
          : this.statusToCode(status);
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
        message =
          'ตารางข้อมูลยังไม่พร้อม กรุณา run migration ก่อนใช้งาน (Database table not found — please run prisma migrate)';
      } else {
        status = this.prismaStatus(exception.code);
        code = `PRISMA_${exception.code}`;
        message = this.getPrismaMessage(exception);
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
      message = 'ไม่พบข้อมูลที่ต้องการ (Record not found)';
      this.logger.warn(`TypeORM EntityNotFound: ${exception.message}`, requestId);

      // ─── TypeORM base (connection lost, etc.) ────────────────────────────
    } else if (exception instanceof TypeORMError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'DATABASE_ERROR';
      message = 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล (Database error)';
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
  private translateValidationMessages(messages: string[]): string {
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
      return translations[msg.toLowerCase()] ?? msg;
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

  private getPrismaMessage(exception: Prisma.PrismaClientKnownRequestError): string {
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
        return `ข้อมูลนี้มีอยู่ในระบบแล้ว (${target} already exists)`;
      }
      case 'P2025':
        return 'ไม่พบข้อมูลที่ต้องการ (Record not found)';
      case 'P2003':
        return 'ไม่สามารถดำเนินการได้เนื่องจากสัมพันธ์กับข้อมูลอื่น (Foreign key constraint failed)';
      default:
        return `เกิดข้อผิดพลาดในการจัดการฐานข้อมูล (${exception.code})`;
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
