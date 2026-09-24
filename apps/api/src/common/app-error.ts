import { HttpStatus } from '@nestjs/common';

/** Erreur métier avec un code stable, exposé tel quel au client (section 7.1 : `{ code, message, details, correlationId }`). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.NOT_FOUND, details);
  }
  static forbidden(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.FORBIDDEN, details);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
  static unauthorized(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED, details);
  }
}
