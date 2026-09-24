import type { ApiErrorBody } from './types.js';

function isErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string';
}

/**
 * Erreur levée par le client : soit la réponse d'erreur de l'API (section 7.1), soit un incident côté client
 * (`status` 0 : `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string,
  ) {
    super(message);
  }

  /** Construit l'erreur à partir du corps de la réponse ; un corps inconnu donne le code `HTTP_<statut>`. */
  static fromBody(status: number, body: unknown, fallbackCorrelationId?: string): ApiError {
    if (isErrorBody(body)) {
      const message = typeof body.message === 'string' && body.message ? body.message : `Erreur HTTP ${status}`;
      return new ApiError(status, body.code, message, body.details, body.correlationId ?? fallbackCorrelationId);
    }
    return new ApiError(status, `HTTP_${status}`, `Erreur HTTP ${status}`, body, fallbackCorrelationId);
  }

  /** Session absente ou perdue (401 après tentative de rafraîchissement). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Aucune réponse de l'API : panne réseau, délai dépassé ou annulation. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}
