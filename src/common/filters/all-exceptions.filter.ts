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
        message = Array.isArray(b.message)
          ? b.message.join(', ')
          : (b.message ?? exception.message);
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
        message = 'ตารางข้อมูลยังไม่พร้อม กรุณา run migration ก่อนใช้งาน (Database table not found — please run prisma migrate)';
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
      message = 'ข้อมูลไม่ถูกต้องตามโครงสร้างฐานข้อมูล (Database validation error)';
      this.logger.error(`Prisma validation: ${exception.message}`, undefined, requestId);

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
        const target = (exception.meta?.target as string[])?.join(', ') || 'field';
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
