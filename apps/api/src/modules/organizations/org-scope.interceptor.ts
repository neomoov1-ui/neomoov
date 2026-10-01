/**
 * Intercepteur global (étape 20) : sur une route d'organisation (`req.orgScope` posé par `OrgScopeGuard`), le gestionnaire
 * s'exécute dans `OrgScopeService.run(chemin, ...)` : transaction restreinte au sous-arbre de l'organisation (rôle
 * PostgreSQL `neomoov_scoped`, réglage `app.scope_path`), pendant laquelle `database.db` de tous les services désigne
 * cette transaction. Sans contexte d'organisation, rien ne change. L'observable du gestionnaire est attendu comme une
 * promesse (une réponse vide, 204, donne `undefined`) puis rendu ; une exception annule la transaction et suit son cours.
 * Après la validation (ou l'annulation), les droits changés pendant la transaction sont revidés du cache.
 */
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { currentOrgScope, type OrgScopeContext } from '../../common/org-scope.context.js';
import { AccessService } from '../auth/access.service.js';
import { OrgScopeService } from './org-scope.service.js';

@Injectable()
export class OrgScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly orgScope: OrgScopeService,
    private readonly access: AccessService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const scope = context.switchToHttp().getRequest<Request>().orgScope;
    if (!scope) return next.handle();
    return defer(async () => {
      const opened: { context: OrgScopeContext | null } = { context: null };
      try {
        return await this.orgScope.run(scope.path, () => {
          opened.context = currentOrgScope();
          return lastValueFrom(next.handle(), { defaultValue: undefined });
        });
      } finally {
        if (opened.context) this.access.afterScopedCommit(opened.context);
      }
    });
  }
}
