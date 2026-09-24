import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
import { pino, type Logger } from 'pino';

export const correlationStore = new AsyncLocalStorage<{ correlationId: string }>();

export function currentCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

/** Journal structuré JSON ; les champs sensibles sont masqués (section 8). */
export function createLogger(name: string, level = process.env['LOG_LEVEL'] ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret', '*.cardNumber', '*.card_number'],
      censor: '[masqué]',
    },
    mixin: () => {
      const id = currentCorrelationId();
      return id ? { correlationId: id } : {};
    },
  });
}

/** Adaptateur pino pour le journal interne de NestJS. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}

export const APP_LOGGER = Symbol('APP_LOGGER');
