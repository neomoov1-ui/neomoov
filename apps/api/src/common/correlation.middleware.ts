import type { NextFunction, Request, Response } from 'express';
import { currentCorrelationId, runWithCorrelation } from './logger.js';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Un identifiant de corrélation par requête : repris de l'en-tête `X-Correlation-Id` envoyé par le web et les mobiles
 * (`packages/api-client`) s'il est valide (8 à 64 caractères sûrs), sinon créé. Il est renvoyé dans la réponse, porté
 * par chaque ligne de journal de la requête et transmis aux tâches mises en file pendant la requête.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  runWithCorrelation(req.header(CORRELATION_HEADER), () => {
    res.setHeader(CORRELATION_HEADER, currentCorrelationId()!);
    next();
  });
}
