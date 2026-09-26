/**
 * Incidents ouverts à la main par le personnel et registre des incidents de confidentialité (Loi 25, articles 3.5 à
 * 3.8) : création, inscription au registre avec un numéro `IC-AAAA-NNN`, mise à jour de la fiche, export du registre.
 * Le journal d'audit reçoit les rubriques modifiées et les dates des avis, jamais le texte libre de la fiche : il peut
 * décrire des renseignements personnels, et le journal est en ajout seul. Procédure : `docs/runbooks/incident-confidentialite.md`.
 */
import { schema } from '@neomoov/db';
import {
  localDate, privacyBreachFieldsSchema, privacyBreachFollowUps, privacyBreachReference, type AdminIncident, type ManualIncidentType, type PrivacyBreachFields,
  type PrivacyBreachView,
} from '@neomoov/domain';
import type { IncidentSeverity } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER, currentCorrelationId } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { csvDocument, csvLine } from '../ledgers/csv.js';
import { SafetyHoldService } from '../rides/safety-hold.service.js';
import { AdminDirectoryService } from './admin-directory.service.js';

/** Inscription conservée dans `incidents.privacy_breach` : rubriques saisies, numéro, dates et auteurs. */
interface StoredPrivacyBreach extends PrivacyBreachFields {
  reference: string;
  recordedAt: string;
  recordedByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
}

export interface ManualIncidentInput {
  type: ManualIncidentType;
  severity: IncidentSeverity;
  description: string;
  rideId?: string | undefined;
  privacyBreach?: PrivacyBreachFields | undefined;
}

type Executor = Pick<Database['db'], 'execute'>;

const FIELD_KEYS = Object.keys(privacyBreachFieldsSchema.shape) as Array<keyof PrivacyBreachFields>;
/** Rubriques reprises en clair dans le journal d'audit : décisions et dates, sans texte libre. */
const AUDITED_VALUES = ['seriousHarm', 'caiNotifiedOn', 'personsNotifiedOn', 'publicNotice', 'discoveredAt'] as const;
const SEPARATOR = ';';

@Injectable()
export class AdminIncidentsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly safety: SafetyHoldService,
    private readonly directory: AdminDirectoryService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Incident ouvert par le personnel (`reportedByKind` : operator). Un incident de confidentialité est inscrit au registre
   * dans la même transaction. Une plainte grave rattachée à une course bloque le chauffeur à titre préventif, comme
   * celle que reçoit l'agent relation client (5.11) : la décision reste humaine.
   */
  async create(input: ManualIncidentInput, actor: UserActor): Promise<AdminIncident> {
    if (input.rideId) {
      const [ride] = await this.db.select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.id, input.rideId)).limit(1);
      if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
    }
    const now = new Date();
    const { id, reference } = await this.db.transaction(async (tx) => {
      const entry = input.privacyBreach ? await this.newEntry(tx, input.privacyBreach, actor, now) : null;
      const [row] = await tx
        .insert(schema.incidents)
        .values({ rideId: input.rideId ?? null, type: input.type, severity: input.severity, reportedByUserId: actor.userId, reportedByKind: 'operator', description: input.description, privacyBreach: entry })
        .returning({ id: schema.incidents.id });
      return { id: row!.id, reference: entry?.reference ?? null };
    });
    this.audit.record({ action: 'admin.incident_created', entity: 'incidents', entityId: id, after: { type: input.type, severity: input.severity, rideId: input.rideId ?? null, privacyReference: reference } });
    if (input.rideId) await this.safety.holdForIncident(id).catch((error: unknown) => this.logger.error({ err: error, incidentId: id }, 'Blocage préventif impossible'));
    return this.directory.incident(id);
  }

  /** Fiche du registre d'un incident. */
  async privacyBreach(incidentId: string): Promise<PrivacyBreachView> {
    const [row] = await this.db.select({ privacyBreach: schema.incidents.privacyBreach }).from(schema.incidents).where(eq(schema.incidents.id, incidentId)).limit(1);
    if (!row) throw AppError.notFound('INCIDENT_NOT_FOUND', 'Incident introuvable');
    if (!row.privacyBreach) throw AppError.notFound('PRIVACY_BREACH_NOT_FOUND', 'Cet incident n\'est pas inscrit au registre des incidents de confidentialité');
    return this.view(incidentId, row.privacyBreach);
  }

  /**
   * Inscrit un incident existant au registre (numéro attribué) ou remplace sa fiche (numéro et date d'inscription
   * conservés). Une inscription ne se retire pas : le registre se garde au moins cinq ans ; une erreur se corrige.
   */
  async savePrivacyBreach(incidentId: string, input: PrivacyBreachFields, actor: UserActor): Promise<PrivacyBreachView> {
    const now = new Date();
    const { before, after } = await this.db.transaction(async (tx) => {
      const [row] = await tx.select({ privacyBreach: schema.incidents.privacyBreach }).from(schema.incidents).where(eq(schema.incidents.id, incidentId)).limit(1).for('update');
      if (!row) throw AppError.notFound('INCIDENT_NOT_FOUND', 'Incident introuvable');
      const previous = row.privacyBreach ? this.stored(incidentId, row.privacyBreach) : null;
      const next: StoredPrivacyBreach = previous
        ? { ...input, reference: previous.reference, recordedAt: previous.recordedAt, recordedByUserId: previous.recordedByUserId, updatedAt: now.toISOString(), updatedByUserId: actor.userId }
        : await this.newEntry(tx, input, actor, now);
      await tx.update(schema.incidents).set({ privacyBreach: next }).where(eq(schema.incidents.id, incidentId));
      return { before: previous, after: next };
    });
    const filled = (value: unknown) => value !== null && value !== false && !(Array.isArray(value) && value.length === 0);
    const changed = before ? FIELD_KEYS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])) : FIELD_KEYS.filter((key) => filled(after[key]));
    const pick = (entry: StoredPrivacyBreach) => Object.fromEntries(AUDITED_VALUES.map((key) => [key, entry[key]]));
    this.audit.record({
      action: before ? 'admin.privacy_breach_updated' : 'admin.privacy_breach_recorded',
      entity: 'incidents',
      entityId: incidentId,
      ...(before ? { before: pick(before) } : {}),
      after: { reference: after.reference, fields: changed, ...pick(after) },
    });
    return this.view(incidentId, after);
  }

  /**
   * Registre complet en CSV (point-virgule, une ligne par incident, du plus récent au plus ancien) : copie à remettre à
   * la CAI sur demande. Le téléchargement est journalisé.
   */
  async registerCsv(actor: UserActor): Promise<string> {
    const rows = await this.db
      .select({ id: schema.incidents.id, type: schema.incidents.type, severity: schema.incidents.severity, status: schema.incidents.status, privacyBreach: schema.incidents.privacyBreach })
      .from(schema.incidents)
      .where(isNotNull(schema.incidents.privacyBreach))
      .orderBy(desc(schema.incidents.createdAt))
      .limit(10_000);
    const header = [
      'reference', 'incident_id', 'type', 'severity', 'status', 'recorded_at', 'occurred_from', 'occurred_to', 'discovered_at', 'reported_by', 'data_categories', 'data_description',
      'circumstances', 'persons_affected', 'persons_affected_quebec', 'containment', 'sensitivity', 'consequences', 'misuse_likelihood', 'serious_harm', 'privacy_officer_consulted',
      'cai_notified_on', 'cai_reference', 'persons_notified_on', 'persons_notification_means', 'public_notice', 'public_notice_reason', 'other_notices', 'measures', 'follow_up_review',
      'follow_ups', 'updated_at',
    ];
    const lines = rows.map((r) => {
      const e = this.view(r.id, r.privacyBreach);
      return csvLine([
        e.reference, r.id, r.type, r.severity, r.status, e.recordedAt, e.occurredFrom, e.occurredTo, e.discoveredAt, e.reportedBy, e.dataCategories.join(','), e.dataDescription,
        e.circumstances, e.personsAffected, e.personsAffectedQuebec, e.containment, e.sensitivity, e.consequences, e.misuseLikelihood, e.seriousHarm, e.privacyOfficerConsulted,
        e.caiNotifiedOn, e.caiReference, e.personsNotifiedOn, e.personsNotificationMeans, e.publicNotice ? 'oui' : 'non', e.publicNoticeReason, e.otherNotices, e.measures, e.followUpReview,
        e.followUps.join(','), e.updatedAt,
      ], SEPARATOR);
    });
    await this.audit.write([{ action: 'admin.privacy_register_exported', entity: 'incidents', entityId: null, after: { rows: rows.length, format: 'csv' } }], { actor, ip: null, correlationId: currentCorrelationId() ?? null });
    return csvDocument([csvLine(header, SEPARATOR), ...lines]);
  }

  /** Nouvelle inscription : numéro suivant de l'année (heure de Montréal), attribué sous verrou pour éviter un doublon. */
  private async newEntry(tx: Executor, input: PrivacyBreachFields, actor: UserActor, now: Date): Promise<StoredPrivacyBreach> {
    const year = Number(localDate(now, await this.settings.string('service.time_zone', 'America/Toronto')).date.slice(0, 4));
    const prefix = `IC-${year}-`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('incidents.privacy_breach.reference'))`);
    const [last] = await tx.execute<{ n: number | string | null }>(sql`
      SELECT MAX(split_part(privacy_breach->>'reference', '-', 3)::int) AS n FROM incidents
      WHERE privacy_breach->>'reference' ~ ${`^${prefix}[0-9]+$`}`);
    const at = now.toISOString();
    return { ...input, reference: privacyBreachReference(year, Number(last?.n ?? 0) + 1), recordedAt: at, recordedByUserId: actor.userId, updatedAt: at, updatedByUserId: actor.userId };
  }

  /** Inscription relue : les rubriques sont revalidées (une valeur absente prend sa valeur par défaut). */
  private stored(incidentId: string, raw: unknown): StoredPrivacyBreach {
    const value = (raw ?? {}) as Partial<StoredPrivacyBreach>;
    const fields = privacyBreachFieldsSchema.safeParse(value);
    if (!fields.success || typeof value.reference !== 'string' || typeof value.recordedAt !== 'string') {
      this.logger.error({ incidentId }, 'Inscription au registre des incidents de confidentialité illisible');
      throw new AppError('PRIVACY_BREACH_UNREADABLE', 'Inscription au registre illisible', 500);
    }
    return {
      ...fields.data, reference: value.reference, recordedAt: value.recordedAt, recordedByUserId: value.recordedByUserId ?? '',
      updatedAt: value.updatedAt ?? value.recordedAt, updatedByUserId: value.updatedByUserId ?? value.recordedByUserId ?? '',
    };
  }

  private view(incidentId: string, raw: unknown): PrivacyBreachView {
    const entry = this.stored(incidentId, raw);
    const fields = Object.fromEntries(FIELD_KEYS.map((key) => [key, entry[key]])) as PrivacyBreachFields;
    return { ...fields, incidentId, reference: entry.reference, recordedAt: entry.recordedAt, updatedAt: entry.updatedAt, followUps: privacyBreachFollowUps(entry) };
  }
}
