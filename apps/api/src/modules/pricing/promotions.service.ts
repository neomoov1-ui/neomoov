/**
 * Promotions (section 5.9, prompt 08) : les règles sont des données (table `promotions`) évaluées par le moteur du
 * domaine (`evaluatePromotion`) au devis, avec l'usage réel (`promotion_uses`). L'usage est réservé à la création de
 * la course (budget compris) et libéré si elle n'aboutit pas ; la remise promise au devis est gardée à la fin de course
 * (prix fixe garanti) et la compensation du chauffeur est à 100 % du tarif normal.
 */
import { schema } from '@neomoov/db';
import {
  applyPromotion, evaluatePromotion, pickAutoPromotion, type Promotion, type PromotionConditions, type PromotionContext, type PromotionRecord, type PromotionRefusal,
  type PromotionUsage, type PromotionValidation,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute' | 'delete'>;

export interface LoadedPromotion {
  id: string;
  name: string;
  record: PromotionRecord;
  usage: PromotionUsage;
}

/** Contexte commun à toutes les catégories d'un devis ; la catégorie est ajoutée par `contextFor`. */
export interface QuoteContextBase {
  now: Date;
  distanceMeters: number;
  originZone: string | null;
  destinationZone: string | null;
  pickupAt: Date;
  timeZone: string;
  clientCompletedRides: number;
}

const REFUSAL_MESSAGES: Record<PromotionRefusal, string> = {
  inactive: 'Cette promotion n\'est plus active',
  not_started: 'Cette promotion n\'a pas encore commencé',
  expired: 'Cette promotion est expirée',
  budget_exhausted: 'Cette promotion est épuisée',
  global_limit: 'Cette promotion a atteint sa limite',
  client_limit: 'Vous avez déjà utilisé cette promotion',
  max_clients: 'Cette promotion est complète',
  first_ride_only: 'Promotion réservée à la première course',
  wrong_rank: 'Promotion réservée à une autre course de votre historique',
  distance: 'Trajet trop long pour cette promotion',
  category: 'Catégorie non admissible pour cette promotion',
  zone: 'Zone non admissible pour cette promotion',
  time_window: 'Horaire non admissible pour cette promotion',
};

@Injectable()
export class PromotionsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly events: DomainEventsService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** Course qui n'aboutit pas (annulée par le client, absence, aucun chauffeur) : l'usage de la promotion est rendu. */
  onModuleInit() {
    const release = (rideId: string) => {
      this.release(rideId).catch((error: unknown) => this.logger.error({ err: error, rideId }, 'Usage de promotion non libéré'));
    };
    this.events.on('ride.cancelled_by_client', (p) => release(p.rideId));
    this.events.on('ride.no_show', (p) => release(p.rideId));
    this.events.on('ride.no_driver', (p) => release(p.rideId));
  }

  private get db() {
    return this.database.db;
  }

  private toRecord(row: typeof schema.promotions.$inferSelect): PromotionRecord {
    return {
      code: row.code, type: row.type, value: row.value, maxDiscountCents: row.maxDiscountCents ?? null, conditions: (row.conditions ?? {}) as PromotionConditions, waivesFees: row.waivesFees,
      globalLimit: row.globalLimit ?? null, perClientLimit: row.perClientLimit, budgetCents: row.budgetCents ?? null, spentCents: row.spentCents, validFrom: row.validFrom, validTo: row.validTo ?? null, active: row.active,
    };
  }

  /** Usage réservé ou consommé : une ligne par course non annulée (les courses abandonnées libèrent leur ligne). */
  private async usageOf(promotionIds: string[], clientId: string | null): Promise<Map<string, PromotionUsage>> {
    const usage = new Map<string, PromotionUsage>(promotionIds.map((id) => [id, { globalUses: 0, clientUses: 0, distinctClients: 0 }]));
    if (!promotionIds.length) return usage;
    const rows = await this.db.execute<{ promotion_id: string; total: number; mine: number; clients: number }>(sql`
      SELECT promotion_id, count(*)::int AS total, count(*) FILTER (WHERE client_id = ${clientId ?? '00000000-0000-4000-8000-000000000000'}::uuid)::int AS mine, count(DISTINCT client_id)::int AS clients
      FROM promotion_uses WHERE promotion_id IN ${promotionIds} GROUP BY promotion_id`);
    for (const r of rows) usage.set(r.promotion_id, { globalUses: Number(r.total), clientUses: Number(r.mine), distinctClients: Number(r.clients) });
    return usage;
  }

  /** Promotion saisie (code) et promotions automatiques actives, avec leur usage pour ce client. */
  async candidates(code: string | null | undefined, clientId: string | null): Promise<{ coded: LoadedPromotion | null; auto: LoadedPromotion[] }> {
    const rows = await this.db.select().from(schema.promotions).where(eq(schema.promotions.active, true));
    const normalized = code?.trim().toUpperCase() || null;
    const codedRow = normalized ? rows.find((r) => r.code === normalized) : undefined;
    if (normalized && !codedRow) throw new AppError('PROMO_CODE_UNKNOWN', 'Code promo inconnu ou expiré', 400, { code: normalized });
    // Les promotions automatiques sont évaluées dans l'ordre des données (création), sans code, et seulement pour un
    // client connu (le rang de sa course compte) : jamais pour un devis public ou fait par le personnel.
    const autoRows = !clientId ? [] : rows.filter((r) => (r.conditions as PromotionConditions | null)?.autoApply && r.code !== normalized).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const usage = await this.usageOf([...(codedRow ? [codedRow.id] : []), ...autoRows.map((r) => r.id)], clientId);
    const load = (row: typeof schema.promotions.$inferSelect): LoadedPromotion => ({ id: row.id, name: row.name, record: this.toRecord(row), usage: usage.get(row.id)! });
    return { coded: codedRow ? load(codedRow) : null, auto: autoRows.map(load) };
  }

  contextFor(base: QuoteContextBase, category: string, usage: PromotionUsage): PromotionContext {
    return { now: base.now, category, distanceMeters: base.distanceMeters, originZone: base.originZone, destinationZone: base.destinationZone, pickupLocal: localTime(base.pickupAt, base.timeZone), clientCompletedRides: base.clientCompletedRides, usage };
  }

  /**
   * Promotion appliquée à une catégorie : le code saisi s'il est admissible, sinon une promotion automatique. Un code
   * refusé pour une raison propre à la catégorie (catégorie, rien d'autre) n'empêche pas les autres catégories ; tout
   * autre refus fait échouer le devis avec son motif, pour que le client comprenne pourquoi son code ne s'applique pas.
   */
  choose(candidates: { coded: LoadedPromotion | null; auto: LoadedPromotion[] }, base: QuoteContextBase, category: string): Promotion | null {
    if (candidates.coded) {
      const evaluation = evaluatePromotion(candidates.coded.record, this.contextFor(base, category, candidates.coded.usage));
      if (evaluation.ok) return evaluation.promotion;
      if (evaluation.reason !== 'category') throw new AppError('PROMOTION_NOT_APPLICABLE', REFUSAL_MESSAGES[evaluation.reason], 400, { code: candidates.coded.record.code, reason: evaluation.reason });
    }
    const byCode = new Map(candidates.auto.map((c) => [c.record.code, c]));
    const picked = pickAutoPromotion(candidates.auto.map((c) => c.record), (record) => this.contextFor(base, category, byCode.get(record.code)!.usage));
    return picked?.promotion ?? null;
  }

  /** `POST /v1/promotions/validate` : le code, et sa remise sur le devis indiqué (devis du client, non expiré). */
  async validate(input: { code: string; quoteId?: string | undefined }, userId: string, timeZone: string): Promise<PromotionValidation> {
    const [client] = await this.db.select({ id: schema.clients.id, rideCount: schema.clients.rideCount }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    const actor = { userId, clientId: client?.id ?? null, clientCompletedRides: client?.rideCount ?? 0, timeZone };
    const normalized = input.code.trim().toUpperCase();
    const refused = (reason: PromotionValidation['reason'], name: string | null = null): PromotionValidation => ({ code: normalized, valid: false, reason, name, discountCents: null });
    let candidates: { coded: LoadedPromotion | null; auto: LoadedPromotion[] };
    try {
      candidates = await this.candidates(normalized, actor.clientId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'PROMO_CODE_UNKNOWN') return refused('unknown_code');
      throw error;
    }
    const coded = candidates.coded!;
    if (!input.quoteId) {
      // Sans devis : conditions générales seulement (validité, budget, limites, rang du client).
      const { categories, zones, timeWindow, maxDistanceMeters, ...general } = coded.record.conditions;
      const evaluation = evaluatePromotion({ ...coded.record, conditions: general }, {
        now: new Date(), category: '', distanceMeters: 0, originZone: null, destinationZone: null, pickupLocal: localTime(new Date(), actor.timeZone), clientCompletedRides: actor.clientCompletedRides, usage: coded.usage,
      });
      return evaluation.ok ? { code: normalized, valid: true, reason: null, name: coded.name, discountCents: null } : refused(evaluation.reason, coded.name);
    }
    const [quote] = await this.db.select().from(schema.quotes).where(eq(schema.quotes.id, input.quoteId)).limit(1);
    if (!quote || (quote.createdByUserId !== actor.userId && quote.clientId !== actor.clientId)) throw AppError.notFound('QUOTE_NOT_FOUND', 'Devis introuvable');
    const pickupAt = quote.requestedAt ?? new Date();
    const context = this.contextFor(
      { now: new Date(), distanceMeters: quote.distanceMeters, originZone: quote.originZoneCode ?? null, destinationZone: quote.destinationZoneCode ?? null, pickupAt, timeZone: actor.timeZone, clientCompletedRides: actor.clientCompletedRides },
      quote.category,
      coded.usage,
    );
    const evaluation = evaluatePromotion(coded.record, context);
    if (!evaluation.ok) return refused(evaluation.reason, coded.name);
    const discount = applyPromotion(evaluation.promotion, { category: quote.category, distanceMeters: quote.distanceMeters, durationSeconds: quote.durationSeconds, pickupAt, clientCompletedRides: actor.clientCompletedRides }, quote.fareCents);
    return { code: normalized, valid: true, reason: null, name: coded.name, discountCents: discount };
  }

  /**
   * Réservation de l'usage à la création de la course (même transaction) : ligne `promotion_uses`, course reliée à la
   * promotion, dépense du budget. Compensation du chauffeur : 100 % de la remise (il garde son tarif normal).
   */
  async reserve(tx: Executor, input: { rideId: string; clientId: string | null; promotionCode: string | null; discountCents: number }): Promise<void> {
    if (!input.promotionCode || !input.clientId || input.discountCents <= 0) return;
    const [promotion] = await tx.select({ id: schema.promotions.id }).from(schema.promotions).where(eq(schema.promotions.code, input.promotionCode)).limit(1);
    if (!promotion) return;
    const inserted = await tx
      .insert(schema.promotionUses)
      .values({ promotionId: promotion.id, clientId: input.clientId, rideId: input.rideId, discountCents: input.discountCents, driverCompensationCents: input.discountCents })
      .onConflictDoNothing()
      .returning({ id: schema.promotionUses.id });
    if (!inserted.length) return;
    await tx.update(schema.rides).set({ promotionId: promotion.id }).where(eq(schema.rides.id, input.rideId));
    await tx.update(schema.promotions).set({ spentCents: sql`${schema.promotions.spentCents} + ${input.discountCents}` }).where(eq(schema.promotions.id, promotion.id));
  }

  /** Course abandonnée (annulée, sans chauffeur, devis expiré) : l'usage et la dépense sont rendus. */
  async release(rideId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const removed = await tx.delete(schema.promotionUses).where(eq(schema.promotionUses.rideId, rideId)).returning({ promotionId: schema.promotionUses.promotionId, discount: schema.promotionUses.discountCents });
      for (const use of removed) {
        await tx.update(schema.promotions).set({ spentCents: sql`GREATEST(0, ${schema.promotions.spentCents} - ${use.discount})` }).where(eq(schema.promotions.id, use.promotionId));
      }
      if (removed.length) await tx.update(schema.rides).set({ promotionId: null }).where(and(eq(schema.rides.id, rideId)));
      return removed.length > 0;
    });
  }
}

/** Jour de la semaine (0 dimanche) et minute du jour à l'heure locale du service. */
export function localTime(at: Date, timeZone: string): { dayOfWeek: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { dayOfWeek: days.indexOf(get('weekday')), minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')) };
}
