import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { correlationStore } from './logger.js';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Un identifiant de corrélation par requête : repris de l'en-tête s'il est fourni (32 caractères sûrs au plus), sinon généré. */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(CORRELATION_HEADER);
  const correlationId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : nanoid(16);
  res.setHeader(CORRELATION_HEADER, correlationId);
  correlationStore.run({ correlationId }, () => next());
}
