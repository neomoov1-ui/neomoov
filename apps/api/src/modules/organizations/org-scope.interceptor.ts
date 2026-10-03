/**
 * Intercepteur global (étape 20) : sur une route d'organisation (`req.orgScope` posé par `OrgScopeGuard`), le gestionnaire
 * s'exécute dans `OrgScopeService.run(chemin, ...)` : transaction restreinte au sous-arbre de l'organisation (rôle
 * PostgreSQL `neomoov_scoped`, réglage `app.scope_path`), pendant laquelle `database.db` de tous les services désigne
 * cette transaction. Sans contexte d'organisation, rien ne change. L'observable du gestionnaire est attendu comme une
 * promesse (une réponse vide, 204, donne `undefined`) puis rendu ; une exception annule la transaction et suit son cours.
 * Après la validation (ou l'annulation), les droits changés pendant la transaction sont revidés du cache.
 * Finalisation du 3 octobre 2026 : après la réussite seulement, une requête admise par une permission sensible
 * (`req.orgSensitiveUse`, posé par la garde) est journalisée et le propriétaire du compte en est avisé.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { currentOrgScope, type OrgScopeContext } from '../../common/org-scope.context.js';
import { AccessService } from '../auth/access.service.js';
import { requestContext } from '../auth/actor.js';
import { OrgScopeService } from './org-scope.service.js';
import { SensitiveUseService } from './sensitive-use.service.js';

@Injectable()
export class OrgScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly orgScope: OrgScopeService,
    private readonly access: AccessService,
    private readonly sensitiveUse: SensitiveUseService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const scope = req.orgScope;
    if (!scope) return next.handle();
    return defer(async () => {
      const opened: { context: OrgScopeContext | null } = { context: null };
      let result: unknown;
      try {
        result = await this.orgScope.run(scope.path, () => {
          opened.context = currentOrgScope();
          return lastValueFrom(next.handle(), { defaultValue: undefined });
        });
      } finally {
        if (opened.context) this.access.afterScopedCommit(opened.context);
      }
      const actor = req.actor;
      if (req.orgSensitiveUse?.length && actor?.kind === 'user') {
        const ctx = requestContext(req);
        const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
        await this.sensitiveUse.record(actor, scope, req.orgSensitiveUse, { method: req.method, route, ip: ctx.ip, correlationId: ctx.correlationId });
      }
      return result;
    });
  }
}
