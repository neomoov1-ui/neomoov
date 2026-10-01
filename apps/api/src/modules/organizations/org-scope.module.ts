import { Module } from '@nestjs/common';
import { OrgScopeService } from './org-scope.service.js';

/**
 * Transactions restreintes par organisation (étape 20), sans le reste du module des organisations : les modules métier
 * (courses, règlement, conformité, avis, facturation) en ont besoin pour leurs tâches par lots d'organisation, alors que
 * le module des organisations importe lui-même les courses et My Hub (routes d'organisation). L'importer ici plutôt que
 * `OrganizationsModule` évite le cycle d'imports courses → organisations → My Hub → courses (étape 23, à la réunion des
 * branches de l'étape 20).
 */
@Module({ providers: [OrgScopeService], exports: [OrgScopeService] })
export class OrgScopeModule {}
