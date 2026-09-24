import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import { currentCorrelationId } from './logger.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
}

/** Toute erreur sort au même format ; les erreurs inattendues ne révèlent rien de leur cause (journalisées côté serveur). */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const correlationId = currentCorrelationId();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Erreur interne. Réessayez, ou contactez l\'assistance avec l\'identifiant de corrélation.' };
    let known = true;

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : ((response as { message?: string | string[] }).message ?? exception.message);
      body = { code: CODE_BY_STATUS[status] ?? 'HTTP_ERROR', message: Array.isArray(message) ? message.join(' ; ') : String(message) };
    } else {
      known = false;
    }
    // Toute erreur 5xx est journalisée avec l'identifiant de corrélation donné au client, quelle que soit sa classe.
    if (status >= 500) this.logger.error({ err: exception, correlationId, code: body.code }, known ? 'Erreur HTTP 5xx' : 'Erreur non gérée');
    if (correlationId) body.correlationId = correlationId;
    if (body.details === undefined) delete body.details;
    res.status(status).json(body);
  }
}
