/**
 * Synchronisation CRM (étape 25, amendement v1.2 section 9) : prospects, comptes d'affaires et organisations poussés
 * chez le fournisseur (HubSpot, simulé en test) de façon asynchrone (file `crm`) et rejouable. Règles : rien ne part
 * sans consentement (formulaire daté pour un prospect, contrat pour un compte d'affaires ou une organisation) ; jamais
 * de trajet, d'adresse personnelle ni de paiement (les entrées de l'adaptateur n'ont pas ces champs, et le modèle
 * HubSpot refuse toute propriété qui y ressemble) ; `crm_records` garde les identifiants externes, l'état et la
 * dernière erreur de chaque fiche, pour les mises à jour directes et les reprises.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNotNull, lt, ne, notExists, notInArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { CRM_PROVIDER, type CrmConsent, type CrmLeadKind, type CrmPipeline, type CrmProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';

export const CRM_ENTITY_TYPES = ['lead', 'business_account', 'organization'] as const;
export type CrmEntityType = (typeof CRM_ENTITY_TYPES)[number];
export type CrmObjectType = 'contact' | 'company' | 'deal' | 'note';
export type CrmRecordStatus = 'pending' | 'synced' | 'error' | 'skipped';

export interface CrmSyncOutcome {
  entityType: CrmEntityType;
  entityId: string;
  status: 'synced' | 'skipped';
  /** Motif d'un saut : `no_consent`, `discarded`, `platform` (organisation racine), `closed`. */
  reason?: string;
  objects: Partial<Record<CrmObjectType, string>>;
}

export interface CrmRecordView {
  objectType: CrmObjectType;
  externalId: string | null;
  status: CrmRecordStatus;
  attempts: number;
  error: string | null;
  lastSyncedAt: Date | null;
}

/** Échecs successifs au-delà desquels la passe de reprise n'insiste plus (une personne regarde le journal). */
export const CRM_MAX_ATTEMPTS = 10;
const ENTITY = 'neomoov';
const LEAD_DEAL_LABEL: Record<CrmLeadKind, string> = { driver: 'Candidature chauffeur', business: 'Entreprise', partner: 'Partenaire', training: 'Préinscription Formation chauffeurs' };

const personName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ') || 'Sans nom';
/** Objet qui porte l'état de l'entité dans `crm_records` (le premier créé). */
const primaryObject = (entityType: CrmEntityType): CrmObjectType => (entityType === 'lead' ? 'contact' : 'company');

@Injectable()
export class CrmSyncService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(CRM_PROVIDER) private readonly crm: CrmProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  get providerName(): string {
    return this.crm.name;
  }

  /** Synchronise une entité ; une erreur du fournisseur est consignée dans `crm_records` puis relancée (la file réessaie). */
  async sync(entityType: CrmEntityType, entityId: string, now = new Date()): Promise<CrmSyncOutcome> {
    try {
      const outcome = await this.syncEntity(entityType, entityId, now);
      if (outcome.status === 'synced') await this.audit.recordSystem({ action: 'crm.synced', entity: 'crm_records', entityId, after: { entityType, provider: this.crm.name, objects: outcome.objects } });
      return outcome;
    } catch (error) {
      await this.markError(entityType, entityId, error, now);
      throw error;
    }
  }

  private syncEntity(entityType: CrmEntityType, entityId: string, now: Date): Promise<CrmSyncOutcome> {
    switch (entityType) {
      case 'lead':
        return this.syncLead(entityId, now);
      case 'business_account':
        return this.syncBusinessAccount(entityId, now);
      case 'organization':
        return this.syncOrganization(entityId, now);
      default:
        throw new AppError('CRM_UNKNOWN_ENTITY', `Entité inconnue : ${String(entityType)}`, 500);
    }
  }

  /** Prospect : contact, transaction dans le parcours du formulaire, note avec le message libre (une seule fois). */
  private async syncLead(id: string, now: Date): Promise<CrmSyncOutcome> {
    const [lead] = await this.db.select().from(schema.leads).where(eq(schema.leads.id, id)).limit(1);
    if (!lead) throw AppError.notFound('LEAD_NOT_FOUND', 'Prospect introuvable');
    if (!lead.consentAt) return this.skip('lead', id, 'no_consent', now);
    if (lead.status === 'discarded') return this.skip('lead', id, 'discarded', now);
    const consent: CrmConsent = { given: true, at: lead.consentAt, source: 'form' };
    const kind = (Object.keys(LEAD_DEAL_LABEL).includes(lead.kind) ? lead.kind : 'driver') as CrmLeadKind;
    const known = await this.externalIds('lead', id);
    const platformId = `lead:${id}`;
    const contact = await this.crm.upsertContact({
      platformId, externalId: known.contact ?? null, email: lead.email, phone: lead.phone, firstName: lead.firstName, lastName: lead.lastName,
      language: lead.language === 'en' ? 'en' : 'fr', city: lead.city, entity: ENTITY, source: lead.source, consent, leadKind: kind,
      driverStatus: kind === 'driver' ? 'candidate' : null, trainingStatus: kind === 'training' ? 'preregistered' : null,
      affiliationProgram: kind === 'partner' ? 'partner' : kind === 'business' ? 'business' : null,
    });
    await this.record('lead', id, 'contact', { externalId: contact.id, status: 'synced', now });
    const pipeline: CrmPipeline = kind === 'business' || kind === 'partner' ? 'b2b' : 'training';
    const stage = kind === 'training' ? 'preregistered' : kind === 'driver' ? 'candidate' : 'new';
    const deal = await this.crm.upsertDeal({
      platformId, externalId: known.deal ?? null, name: `${LEAD_DEAL_LABEL[kind]} : ${personName(lead.firstName, lead.lastName)}`, pipeline, stage,
      contactExternalId: contact.id, entity: ENTITY, source: lead.source, consent,
    });
    await this.record('lead', id, 'deal', { externalId: deal.id, status: 'synced', now });
    const objects: CrmSyncOutcome['objects'] = { contact: contact.id, deal: deal.id };
    // Le message libre devient une note, une seule fois (jamais réécrite : l'équipe a pu la compléter chez HubSpot).
    const message = lead.message?.trim();
    if (message && !known.note) {
      const note = await this.crm.addNote({ body: message.slice(0, 2000), occurredAt: lead.createdAt, contactExternalId: contact.id, dealExternalId: deal.id, consent });
      await this.record('lead', id, 'note', { externalId: note.id, status: 'synced', now });
      objects.note = note.id;
    }
    return { entityType: 'lead', entityId: id, status: 'synced', objects };
  }

  /** Compte d'affaires (client entreprise sous contrat) : entreprise, contact de facturation, transaction gagnée. */
  private async syncBusinessAccount(id: string, now: Date): Promise<CrmSyncOutcome> {
    const [account] = await this.db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, id)).limit(1);
    if (!account) throw AppError.notFound('BUSINESS_ACCOUNT_NOT_FOUND', 'Compte d\'affaires introuvable');
    if (account.status === 'closed' || account.status === 'ended') return this.skip('business_account', id, 'closed', now);
    const consent: CrmConsent = { given: true, at: account.createdAt, source: 'contract' };
    const known = await this.externalIds('business_account', id);
    const platformId = `business_account:${id}`;
    const company = await this.crm.upsertCompany({ platformId, externalId: known.company ?? null, name: account.name, legalName: account.legalName, accountType: 'business_account', entity: ENTITY, source: 'platform', consent });
    await this.record('business_account', id, 'company', { externalId: company.id, status: 'synced', now });
    // Contact de facturation : le courriel professionnel du compte ; la plateforme ne connaît pas de nom.
    const contact = await this.crm.upsertContact({ platformId, externalId: known.contact ?? null, email: account.billingEmail, phone: null, firstName: null, lastName: null, language: null, entity: ENTITY, source: 'platform', consent, affiliationProgram: 'business' });
    await this.record('business_account', id, 'contact', { externalId: contact.id, status: 'synced', now });
    const deal = await this.crm.upsertDeal({
      platformId, externalId: known.deal ?? null, name: `Compte d'affaires : ${account.name}`, pipeline: 'b2b', stage: 'active',
      contactExternalId: contact.id, companyExternalId: company.id, entity: ENTITY, source: 'platform', consent,
    });
    await this.record('business_account', id, 'deal', { externalId: deal.id, status: 'synced', now });
    return { entityType: 'business_account', entityId: id, status: 'synced', objects: { company: company.id, contact: contact.id, deal: deal.id } };
  }

  /** Organisation cliente (jamais la racine Neomoov) : entreprise et transaction « Ventes B2B » selon son état. */
  private async syncOrganization(id: string, now: Date): Promise<CrmSyncOutcome> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    if (!org.parentId) return this.skip('organization', id, 'platform', now);
    if (org.status === 'closed') return this.skip('organization', id, 'closed', now);
    const consent: CrmConsent = { given: true, at: org.createdAt, source: 'contract' };
    const known = await this.externalIds('organization', id);
    const platformId = `organization:${id}`;
    const company = await this.crm.upsertCompany({
      platformId, externalId: known.company ?? null, name: org.name, legalName: org.legalName, accountType: 'organization', organizationType: org.type, planCode: org.planCode,
      entity: ENTITY, source: 'platform', consent,
    });
    await this.record('organization', id, 'company', { externalId: company.id, status: 'synced', now });
    const stage = org.status === 'trial' ? 'trial' : org.planCode ? 'active' : 'contacted';
    const deal = await this.crm.upsertDeal({ platformId, externalId: known.deal ?? null, name: `Organisation : ${org.name}`, pipeline: 'b2b', stage, companyExternalId: company.id, entity: ENTITY, source: 'platform', consent });
    await this.record('organization', id, 'deal', { externalId: deal.id, status: 'synced', now });
    return { entityType: 'organization', entityId: id, status: 'synced', objects: { company: company.id, deal: deal.id } };
  }

  private async skip(entityType: CrmEntityType, entityId: string, reason: string, now: Date): Promise<CrmSyncOutcome> {
    await this.record(entityType, entityId, primaryObject(entityType), { status: 'skipped', error: reason, now });
    return { entityType, entityId, status: 'skipped', reason, objects: {} };
  }

  /** Identifiants externes déjà connus, par objet (mise à jour directe, note jamais dupliquée). */
  private async externalIds(entityType: CrmEntityType, entityId: string): Promise<Partial<Record<CrmObjectType, string>>> {
    const rows = await this.db
      .select({ objectType: schema.crmRecords.objectType, externalId: schema.crmRecords.externalId })
      .from(schema.crmRecords)
      .where(and(eq(schema.crmRecords.provider, this.crm.name), eq(schema.crmRecords.entityType, entityType), eq(schema.crmRecords.entityId, entityId)));
    return Object.fromEntries(rows.filter((r) => r.externalId).map((r) => [r.objectType, r.externalId!])) as Partial<Record<CrmObjectType, string>>;
  }

  private async record(entityType: CrmEntityType, entityId: string, objectType: CrmObjectType, patch: { externalId?: string | null; status: CrmRecordStatus; error?: string | null; now: Date }): Promise<void> {
    const synced = patch.status === 'synced';
    await this.db
      .insert(schema.crmRecords)
      .values({ entityType, entityId, provider: this.crm.name, objectType, externalId: patch.externalId ?? null, status: patch.status, error: patch.error ?? null, attempts: 0, lastSyncedAt: synced ? patch.now : null })
      .onConflictDoUpdate({
        target: [schema.crmRecords.provider, schema.crmRecords.entityType, schema.crmRecords.entityId, schema.crmRecords.objectType],
        set: {
          ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
          status: patch.status,
          error: patch.error ?? null,
          ...(synced ? { lastSyncedAt: patch.now, attempts: 0 } : {}),
          updatedAt: patch.now,
        },
      });
  }

  /** L'objet principal de l'entité passe en erreur (identifiant externe conservé) ; la passe de reprise le retrouvera. */
  private async markError(entityType: CrmEntityType, entityId: string, error: unknown, now: Date): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    try {
      await this.db
        .insert(schema.crmRecords)
        .values({ entityType, entityId, provider: this.crm.name, objectType: primaryObject(entityType), status: 'error', error: message, attempts: 1 })
        .onConflictDoUpdate({
          target: [schema.crmRecords.provider, schema.crmRecords.entityType, schema.crmRecords.entityId, schema.crmRecords.objectType],
          set: { status: 'error', error: message, attempts: sql`${schema.crmRecords.attempts} + 1`, updatedAt: now },
        });
    } catch (recordError) {
      this.logger.error({ err: recordError, entityType, entityId }, 'Erreur CRM non consignée');
    }
  }

  /** Entités en erreur à reprendre (passe de la file), les plus anciennes d'abord, tant que la limite d'échecs n'est pas atteinte. */
  async pendingRetries(limit = 50): Promise<Array<{ entityType: CrmEntityType; entityId: string }>> {
    const rows = await this.db
      .select({ entityType: schema.crmRecords.entityType, entityId: schema.crmRecords.entityId })
      .from(schema.crmRecords)
      .where(and(eq(schema.crmRecords.provider, this.crm.name), eq(schema.crmRecords.status, 'error'), lt(schema.crmRecords.attempts, CRM_MAX_ATTEMPTS)))
      .orderBy(asc(schema.crmRecords.updatedAt))
      .limit(limit);
    return rows.map((r) => ({ entityType: r.entityType as CrmEntityType, entityId: r.entityId }));
  }

  /** Prospects récents avec consentement jamais présentés au CRM (événement perdu) : rattrapage par la passe. */
  async unsyncedLeads(since: Date, limit = 50): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(
        and(
          gte(schema.leads.createdAt, since),
          isNotNull(schema.leads.consentAt),
          ne(schema.leads.status, 'discarded'),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(schema.crmRecords)
              .where(and(eq(schema.crmRecords.provider, this.crm.name), eq(schema.crmRecords.entityType, 'lead'), eq(schema.crmRecords.entityId, schema.leads.id))),
          ),
        ),
      )
      .orderBy(asc(schema.leads.createdAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Comptes d'affaires récents jamais présentés au CRM : aucune route ne les crée encore (saisie en base, reprise de
   * données), l'événement `business_account.created` peut donc manquer ; la passe les rattrape.
   */
  async unsyncedBusinessAccounts(since: Date, limit = 50): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.businessAccounts.id })
      .from(schema.businessAccounts)
      .where(
        and(
          gte(schema.businessAccounts.createdAt, since),
          notInArray(schema.businessAccounts.status, ['closed', 'ended']),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(schema.crmRecords)
              .where(and(eq(schema.crmRecords.provider, this.crm.name), eq(schema.crmRecords.entityType, 'business_account'), eq(schema.crmRecords.entityId, schema.businessAccounts.id))),
          ),
        ),
      )
      .orderBy(asc(schema.businessAccounts.createdAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /** Fiches connues d'une entité chez le fournisseur courant (My Hub, tests). */
  async records(entityType: CrmEntityType, entityId: string): Promise<CrmRecordView[]> {
    const rows = await this.db
      .select()
      .from(schema.crmRecords)
      .where(and(eq(schema.crmRecords.provider, this.crm.name), eq(schema.crmRecords.entityType, entityType), eq(schema.crmRecords.entityId, entityId)))
      .orderBy(asc(schema.crmRecords.createdAt));
    return rows.map((r) => ({ objectType: r.objectType as CrmObjectType, externalId: r.externalId, status: r.status as CrmRecordStatus, attempts: r.attempts, error: r.error, lastSyncedAt: r.lastSyncedAt }));
  }
}
