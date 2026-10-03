/**
 * Finalisation du 3 octobre 2026 : ce que la garde des routes d'organisation (`OrgScopeGuard`) juge en plus des
 * permissions, avant le gestionnaire.
 *
 * - Conditions des rôles (`role_permissions.conditions`) : une route d'écriture déclare l'objet de son action
 *   (`@ActsOn`) : la course d'un paramètre, le devis d'un champ du corps, ou le lieu d'un champ du corps. Le montant
 *   (prix maximal consenti) et les zones qui contiennent le départ en sont tirés, sur le sous-arbre de l'organisation
 *   seulement (un objet hors du sous-arbre n'est pas jugé ici : le gestionnaire répond 404). Une route d'écriture sans
 *   déclaration ne connaît ni montant ni lieu : une permission plafonnée ou limitée à des zones y est refusée. Les
 *   lectures ne sont pas limitées par le montant ni les zones (les zones restreignent les actions, pas la vue).
 * - Statut de facturation (étape 25, `organizationWriteRefusal`) : sous `read_only`, `suspended` ou `closed` (de
 *   l'organisation ou d'un ancêtre client), les écritures sont refusées, sauf sur une course en cours et sur les routes
 *   qui servent à régulariser ou à se protéger (`@OrgWriteExempt`).
 * - Permissions sensibles utilisées : notées sur la requête (`orgSensitiveUse`) pour l'alerte au propriétaire, envoyée
 *   par l'intercepteur après la réussite du gestionnaire.
 */
import { SetMetadata } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { restrictiveOrganizationStatus, type ConditionFacts, type Permission } from '@neomoov/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { withoutOrgScope } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';

declare module 'express' {
  interface Request {
    /** Permissions sensibles qui ont seules admis la requête (alerte au propriétaire après la réussite). */
    orgSensitiveUse?: Permission[];
  }
}

export const ACTS_ON_KEY = 'neomoov:org:acts-on';
export const ORG_WRITE_EXEMPT_KEY = 'neomoov:org:write-exempt';

/** Objet de l'action d'une route d'organisation, pour juger les conditions des rôles et la course en cours. */
export type ActsOn = { ride: string } | { quote: string } | { place: string };

/**
 * L'action porte sur une course (paramètre de route), un devis (champ du corps qui porte son identifiant) ou un lieu
 * (champ du corps de la forme `{ coordinates: { lat, lng } }`, zones seulement).
 */
export const ActsOnRide = (param = 'id') => SetMetadata(ACTS_ON_KEY, { ride: param } satisfies ActsOn);
export const ActsOnQuote = (bodyField = 'quoteId') => SetMetadata(ACTS_ON_KEY, { quote: bodyField } satisfies ActsOn);
export const ActsOnPlace = (bodyField = 'origin') => SetMetadata(ACTS_ON_KEY, { place: bodyField } satisfies ActsOn);

/**
 * Écriture permise sous un statut de facturation sans écriture : portail de paiement, décisions sur l'accès du support,
 * retrait d'un membre ou d'une invitation (une organisation doit toujours pouvoir régulariser et se protéger).
 */
export const OrgWriteExempt = () => SetMetadata(ORG_WRITE_EXEMPT_KEY, true);

const UUID = /^[0-9a-f-]{36}$/i;
/** États d'une course où un chauffeur y est engagé (domaine : ACTIVE_RIDE_STATES). */
const ACTIVE_RIDE_STATES = ['assigned', 'en_route', 'arrived', 'in_progress'];

interface RideFacts {
  amountCents: number;
  zones: string[];
  active: boolean;
}

@Injectable()
export class OrgRequestGatesService {
  constructor(@Inject(DB) private readonly database: Database) {}

  /**
   * Montant et zones de l'action, seulement s'ils sont demandés par une tenue conditionnée. La garde s'exécute avant la
   * transaction restreinte : la lecture passe par la plateforme, bornée au sous-arbre `scopePath`.
   */
  async facts(req: Request, actsOn: ActsOn | undefined, scopePath: string, needed: { amount: boolean; zone: boolean }): Promise<Pick<ConditionFacts, 'amountCents' | 'zones'>> {
    if (!needed.amount && !needed.zone) return {};
    const pick = (amountCents: number | null, zones: string[]) => ({ ...(needed.amount ? { amountCents } : {}), ...(needed.zone ? { zones } : {}) });
    if (!actsOn) return pick(null, []);
    if ('ride' in actsOn) {
      const ride = await this.ride(req.params[actsOn.ride], scopePath);
      return ride ? pick(ride.amountCents, ride.zones) : {};
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ('quote' in actsOn) {
      const quote = await this.quote(body[actsOn.quote], scopePath);
      return quote ? pick(quote.amountCents, quote.zones) : {};
    }
    const place = body[actsOn.place] as { coordinates?: { lat?: unknown; lng?: unknown } } | undefined;
    const lat = place?.coordinates?.lat;
    const lng = place?.coordinates?.lng;
    // Lieu illisible : le schéma du corps le refusera (400). Une action sur un lieu (un devis) n'engage aucun montant : le
    // plafond ne s'y applique pas (il s'applique à la course créée ensuite à partir du devis).
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return {};
    return needed.zone ? { zones: await this.zonesAt(sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`) } : {};
  }

  /** Vrai si la route agit sur une course en cours du sous-arbre (jamais bloquée par la facturation). */
  async actsOnActiveRide(req: Request, actsOn: ActsOn | undefined, scopePath: string): Promise<boolean> {
    if (!actsOn || !('ride' in actsOn)) return false;
    return (await this.ride(req.params[actsOn.ride], scopePath))?.active ?? false;
  }

  /** Statut qui s'applique à l'organisation du chemin : le plus restrictif d'elle et de ses ancêtres clients (la racine exclue). */
  async organizationStatus(scopePath: string): Promise<string> {
    const ids = scopePath.split('/').filter(Boolean);
    const rows = await withoutOrgScope(() =>
      this.database.db.execute<{ status: string }>(sql`SELECT status FROM organizations WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND parent_id IS NOT NULL`),
    );
    return restrictiveOrganizationStatus([...rows].map((r) => r.status));
  }

  private async ride(raw: unknown, scopePath: string): Promise<RideFacts | null> {
    if (typeof raw !== 'string' || !UUID.test(raw)) return null;
    const [row] = await withoutOrgScope(() =>
      this.database.db.execute<{ amount: number; state: string; zones: string[] | null }>(sql`
        SELECT r.max_consented_cents AS amount, r.state,
               (SELECT array_agg(z.code ORDER BY z.code) FROM zones z WHERE z.active AND ST_Covers(z.geometry, r.origin_position)) AS zones
        FROM rides r JOIN organizations o ON o.id = r.organization_id
        WHERE r.id = ${raw}::uuid AND o.path LIKE ${scopePath} || '%'`),
    );
    return row ? { amountCents: Number(row.amount), zones: row.zones ?? [], active: ACTIVE_RIDE_STATES.includes(row.state) } : null;
  }

  private async quote(raw: unknown, scopePath: string): Promise<{ amountCents: number; zones: string[] } | null> {
    if (typeof raw !== 'string' || !UUID.test(raw)) return null;
    const [row] = await withoutOrgScope(() =>
      this.database.db.execute<{ amount: number; zones: string[] | null }>(sql`
        SELECT q.max_consented_cents AS amount,
               (SELECT array_agg(z.code ORDER BY z.code) FROM zones z WHERE z.active AND ST_Covers(z.geometry, q.origin_position)) AS zones
        FROM quotes q JOIN organizations o ON o.id = q.organization_id
        WHERE q.id = ${raw}::uuid AND o.path LIKE ${scopePath} || '%'`),
    );
    return row ? { amountCents: Number(row.amount), zones: row.zones ?? [] } : null;
  }

  private async zonesAt(point: SQL): Promise<string[]> {
    const rows = await withoutOrgScope(() => this.database.db.execute<{ code: string }>(sql`SELECT code FROM zones WHERE active AND ST_Covers(geometry, ${point}) ORDER BY code`));
    return [...rows].map((r) => r.code);
  }
}
