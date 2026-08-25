import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url?: string }>();

    if (response.headersSent) {
      return;
    }

    const { status, error } = this.normalize(exception, request?.url);
    if (status >= 500) {
      this.logger.error(this.stringify(exception));
    }

    response.status(status).json({ error });
  }

  private normalize(exception: unknown, url?: string): { status: number; error: string } {
    if (
      exception &&
      typeof exception === 'object' &&
      'name' in exception &&
      exception.name === 'MulterError'
    ) {
      const code =
        'code' in exception && typeof exception.code === 'string'
          ? exception.code
          : '';
      if (code === 'LIMIT_FILE_SIZE') {
        const photo = typeof url === 'string' && url.includes('/users/');
        return {
          status: HttpStatus.BAD_REQUEST,
          error: photo ? 'Keep the photo under 2 MB' : 'That file is too large',
        };
      }
      return { status: HttpStatus.BAD_REQUEST, error: 'Could not upload that file' };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        error: this.messageFromHttp(exception),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Something went wrong',
    };
  }

  private messageFromHttp(exception: HttpException): string {
    const payload = exception.getResponse();
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      const record = payload as {
        error?: unknown;
        message?: unknown;
      };
      if (typeof record.error === 'string' && record.error.trim()) {
        return record.error;
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        return record.message;
      }
      if (Array.isArray(record.message) && typeof record.message[0] === 'string') {
        return record.message[0];
      }
    }

    return exception.message || 'Request failed';
  }

  private stringify(exception: unknown) {
    if (exception instanceof Error) return exception.message;
    try {
      return JSON.stringify(exception);
    } catch {
      return 'Unknown error';
    }
  }
}
