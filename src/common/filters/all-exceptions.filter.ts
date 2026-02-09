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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;
      error = (exceptionResponse as any).error || 'Http Exception';
    } 
    // Handle Prisma Errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // สำหรับผู้ใช้ใหม่ที่ยังไม่มี table/column ให้ส่ง empty data แทน error
      if (exception.code === 'P2021' || exception.code === 'P2022') {
        this.logger.warn(`Database schema not ready (${exception.code}): returning empty data`);

        // ส่ง empty data ตาม path
        const emptyResponse: any = {
          success: true,
          statusCode: 200,
          timestamp: new Date().toISOString(),
          path: request.url,
        };

        // ตรวจสอบ path เพื่อส่ง format ที่เหมาะสม
        if (request.url.includes('/notifications')) {
          emptyResponse.items = [];
          emptyResponse.meta = { total: 0, page: 1, limit: 10, totalPages: 0 };
        } else if (request.url.includes('/promotions')) {
          emptyResponse.data = [];
        } else {
          // default format for list endpoints
          emptyResponse.data = [];
          emptyResponse.total = 0;
          emptyResponse.page = 1;
          emptyResponse.limit = 10;
        }

        return response.status(200).json(emptyResponse);
      }

      status = HttpStatus.BAD_REQUEST;
      message = this.getPrismaMessage(exception);
      error = 'Database Error';
      this.logger.error(`Prisma Error (${exception.code}): ${exception.message}`);
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'ข้อมูลไม่ถูกต้องตามโครงสร้างฐานข้อมูล (Database validation error)';
      error = 'Validation Error';
      this.logger.error(`Prisma Validation Error: ${exception.message}`);
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled Error: ${exception.stack}`);
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: message,
      error: error,
    };

    response.status(status).json(errorResponse);
  }

  private getPrismaMessage(exception: Prisma.PrismaClientKnownRequestError): string {
    switch (exception.code) {
      case 'P2002':
        const target = (exception.meta?.target as string[])?.join(', ') || 'field';
        return `ข้อมูลนี้สะสมอยู่ในระบบแล้ว (${target} already exists)`;
      case 'P2025':
        return 'ไม่พบข้อมูลที่ต้องการ (Record not found)';
      case 'P2003':
        return 'ไม่สามารถดำเนินการได้เนื่องจากสัมพันธ์กับข้อมูลอื่น (Foreign key constraint failed)';
      default:
        return `เกิดข้อผิดพลาดในการจัดการฐานข้อมูล (${exception.code})`;
    }
  }
}
