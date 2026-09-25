/**
 * Intercepteur global : toute mutation (POST, PUT, PATCH, DELETE) réussie laisse une trace dans `audit_log`. Les entrées
 * enregistrées par les services pendant la requête sont écrites avec l'acteur, l'adresse IP et l'identifiant de
 * corrélation ; sans entrée explicite, une entrée générique « <méthode> <route> » (ou celle du décorateur @Audit) est écrite.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { AUDIT_KEY, NO_AUDIT_KEY, requestContext, type AuditOptions } from '../auth/actor.js';
import { AuditService, maskSensitive, type AuditEntry } from './audit.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Les entrées sont écrites avant que la réponse parte (un lecteur du journal juste après la réponse les voit). Sur une
   * exception, les entrées déjà enregistrées par les services (changements effectifs) sont écrites aussi, puis l'erreur suit.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [context.getHandler(), context.getClass()]) === true) return next.handle();
    const store = { entries: [] as AuditEntry[] };
    return new Observable((subscriber) => {
      const subscription = this.audit.storage.run(store, () =>
        next
          .handle()
          .pipe(
            mergeMap((body) => from(this.flush(context, req, store.entries, body, false).then(() => body))),
            catchError((error: unknown) => from(this.flush(context, req, store.entries, undefined, true)).pipe(mergeMap(() => throwError(() => error)))),
          )
          .subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }

  private async flush(context: ExecutionContext, req: Request, entries: AuditEntry[], body: unknown, failed: boolean): Promise<void> {
    const ctx = requestContext(req);
    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, [context.getHandler(), context.getClass()]);
    const generic: AuditEntry[] = [];
    if (!failed && (!entries.length || options)) {
      const idFrom = options?.idFrom ?? 'id';
      const fromBody = body && typeof body === 'object' ? (body as Record<string, unknown>)[idFrom] : undefined;
      const fromParams = req.params[idFrom];
      const entityId = typeof fromParams === 'string' ? fromParams : typeof fromBody === 'string' ? fromBody : null;
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      generic.push({
        action: options?.action ?? `${req.method} ${route}`,
        entity: options?.entity ?? context.getClass().name.replace(/Controller$/, '').toLowerCase(),
        entityId,
        after: options && body && typeof body === 'object' ? maskSensitive(body) : undefined,
      });
    }
    await this.audit.write([...generic, ...entries], { actor: req.actor ?? null, ip: ctx.ip, correlationId: ctx.correlationId });
  }
}
