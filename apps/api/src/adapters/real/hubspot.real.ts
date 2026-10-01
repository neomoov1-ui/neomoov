/**
 * Adaptateur HubSpot réel (étape 25, étude 06) : API REST v3 (et v4 pour les associations), jeton d'application privée
 * `HUBSPOT_ACCESS_TOKEN`, sans SDK. Idempotence par la propriété unique `neomoov_platform_id` (batch upsert) ; un
 * contact qui existe déjà par son courriel (Tidio, saisie à la main) est mis à jour plutôt que dupliqué. Limite de la
 * formule gratuite respectée (100 appels par 10 secondes : lissage côté client, nouvel essai sur 429). `setup()` crée
 * ou met à jour le modèle de données (`pnpm --filter @neomoov/api crm:setup`), rejouable sans effet de bord. Le jeton
 * ne quitte jamais l'objet (champ privé, `toJSON` sans secret).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from '../../common/app-error.js';
import { requireCrmConsent, type CrmCompanyInput, type CrmContactInput, type CrmDealInput, type CrmNoteInput, type CrmPipeline, type CrmProvider, type CrmUpsertResult } from '../types.js';
import {
  HUBSPOT_PIPELINES, HUBSPOT_PROPERTIES, HUBSPOT_PROPERTY_GROUP, HUBSPOT_SINGLE_PIPELINE_LABEL, companyProperties, contactProperties, dealProperties, pipelineDefinition, stageDefinition,
  type HubSpotObjectType, type HubSpotPropertyDefinition, type HubSpotStageDefinition,
} from './hubspot-model.js';

const API = 'https://api.hubapi.com';
const WINDOW_MS = 10_000;
/** Marge sous la limite de 100 appels par 10 secondes des formules gratuite et Starter. */
const MAX_CALLS_PER_WINDOW = 90;
const PIPELINE_CACHE_MS = 600_000;
const ID_PROPERTY = 'neomoov_platform_id';
/** Associations définies par HubSpot : note vers contact, entreprise, transaction. */
const NOTE_ASSOCIATIONS: Record<HubSpotObjectType, number> = { contacts: 202, companies: 190, deals: 214 };

interface HubSpotErrorBody {
  status?: string;
  message?: string;
  category?: string;
  errors?: Array<{ message?: string }>;
}

interface PipelineStage {
  id: string;
  label: string;
  metadata?: { probability?: string };
}

interface Pipeline {
  id: string;
  label: string;
  stages: PipelineStage[];
}

interface ExistingProperty {
  label?: string;
  description?: string;
  type?: string;
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
}

export type HubSpotSetupAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'planned';

export interface HubSpotSetupReport {
  kind: 'group' | 'property' | 'pipeline' | 'stage';
  objectType: string;
  name: string;
  action: HubSpotSetupAction;
  detail?: string;
}

const normalize = (label: string) => label.trim().toLocaleLowerCase('fr-CA');

interface ErrorDetails {
  status?: number;
  messages?: string[];
}

const detailsOf = (error: unknown): ErrorDetails => (error instanceof AppError && error.details && typeof error.details === 'object' ? (error.details as ErrorDetails) : {});
const isNotFound = (error: unknown) => detailsOf(error).status === 404;

/** Identifiant d'une fiche existante annoncé par HubSpot (« Contact already exists. Existing ID: 123 »). */
export function existingIdOf(error: unknown): string | null {
  for (const message of detailsOf(error).messages ?? []) {
    const match = /Existing ID:\s*(\d+)/i.exec(message);
    if (match) return match[1]!;
  }
  return null;
}

/** Création de pipeline refusée par la formule (un seul pipeline en gratuit, deux en Starter). */
export function pipelineLimitReached(error: unknown): boolean {
  const { status, messages } = detailsOf(error);
  const text = (messages ?? []).join(' ');
  return status === 402 || status === 403 || (status === 400 && /limit|maximum|exceed|allow|quota|upgrade/i.test(text));
}

export class HubSpotCrmProvider implements CrmProvider {
  readonly name = 'hubspot';
  readonly portalId: string | null;
  // Champs privés JavaScript : jamais énumérés, ni par le journal ni par util.inspect.
  readonly #token: string;
  readonly #fetch: typeof fetch;
  private readonly callTimes: number[] = [];
  private pipelines: { loadedAt: number; list: Pipeline[] } | null = null;

  constructor(token: string, options: { portalId?: string | null; fetchImpl?: typeof fetch } = {}) {
    this.#token = token;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.portalId = options.portalId ?? null;
  }

  toJSON() {
    return { name: this.name, configured: true, portalId: this.portalId };
  }

  /** Lissage sous la limite de HubSpot : au plus `MAX_CALLS_PER_WINDOW` appels par fenêtre de 10 secondes. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    while (this.callTimes.length && this.callTimes[0]! <= now - WINDOW_MS) this.callTimes.shift();
    if (this.callTimes.length >= MAX_CALLS_PER_WINDOW) {
      await sleep(this.callTimes[0]! + WINDOW_MS - now);
      return this.throttle();
    }
    this.callTimes.push(Date.now());
  }

  private async call<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown, attempt = 1): Promise<T> {
    await this.throttle();
    const res = await this.#fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json', accept: 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000 * attempt);
      return this.call<T>(method, path, body, attempt + 1);
    }
    const text = await res.text();
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      const error = json as HubSpotErrorBody;
      const messages = [error.message, ...(error.errors ?? []).map((e) => e.message)].filter((m): m is string => typeof m === 'string' && m.length > 0);
      throw new AppError('CRM_PROVIDER_ERROR', `HubSpot ${res.status}${messages[0] ? ` : ${messages[0].slice(0, 300)}` : ''}`, 502, { status: res.status, category: error.category ?? null, messages });
    }
    return json as T;
  }

  /** Mise à jour directe si l'identifiant HubSpot est connu, sinon création ou mise à jour par l'identifiant Neomoov. */
  private async upsert(objectType: HubSpotObjectType, platformId: string, externalId: string | null | undefined, properties: Record<string, string>): Promise<CrmUpsertResult> {
    if (externalId) {
      try {
        await this.call('PATCH', `/crm/v3/objects/${objectType}/${encodeURIComponent(externalId)}`, { properties });
        return { id: externalId, created: false };
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    try {
      const res = await this.call<{ results?: Array<{ id: string; new?: boolean }> }>('POST', `/crm/v3/objects/${objectType}/batch/upsert`, { inputs: [{ idProperty: ID_PROPERTY, id: platformId, properties }] });
      const first = res.results?.[0];
      if (!first?.id) throw new AppError('CRM_PROVIDER_ERROR', 'HubSpot : réponse sans identifiant', 502);
      return { id: first.id, created: first.new === true };
    } catch (error) {
      const existing = existingIdOf(error);
      if (!existing) throw error;
      // Une fiche porte déjà ce courriel (créée par Tidio ou à la main) : mise à jour, avec l'identifiant Neomoov.
      await this.call('PATCH', `/crm/v3/objects/${objectType}/${existing}`, { properties });
      return { id: existing, created: false };
    }
  }

  async upsertContact(input: CrmContactInput): Promise<CrmUpsertResult> {
    requireCrmConsent(input.consent);
    return this.upsert('contacts', input.platformId, input.externalId, contactProperties(input));
  }

  async upsertCompany(input: CrmCompanyInput): Promise<CrmUpsertResult> {
    requireCrmConsent(input.consent);
    return this.upsert('companies', input.platformId, input.externalId, companyProperties(input));
  }

  async upsertDeal(input: CrmDealInput): Promise<CrmUpsertResult> {
    requireCrmConsent(input.consent);
    const { pipelineId, stageId } = await this.resolveStage(input.pipeline, input.stage);
    const result = await this.upsert('deals', input.platformId, input.externalId, dealProperties(input, pipelineId, stageId));
    await this.associate('deals', result.id, 'contacts', input.contactExternalId);
    await this.associate('deals', result.id, 'companies', input.companyExternalId);
    return result;
  }

  /** Association par défaut (v4), rejouable : associer deux fois ne fait rien. */
  private async associate(from: HubSpotObjectType, fromId: string, to: HubSpotObjectType, toId: string | null | undefined): Promise<void> {
    if (!toId) return;
    await this.call('PUT', `/crm/v4/objects/${from}/${encodeURIComponent(fromId)}/associations/default/${to}/${encodeURIComponent(toId)}`);
  }

  async addNote(input: CrmNoteInput): Promise<{ id: string }> {
    requireCrmConsent(input.consent);
    const targets: Array<[HubSpotObjectType, string | null | undefined]> = [['contacts', input.contactExternalId], ['companies', input.companyExternalId], ['deals', input.dealExternalId]];
    const associations = targets.filter((t): t is [HubSpotObjectType, string] => Boolean(t[1])).map(([type, id]) => ({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_ASSOCIATIONS[type] }] }));
    if (!associations.length) throw new AppError('CRM_NOTE_WITHOUT_TARGET', 'Une note doit viser un contact, une entreprise ou une transaction', 500);
    const note = await this.call<{ id: string }>('POST', '/crm/v3/objects/notes', {
      properties: { hs_timestamp: (input.occurredAt ?? new Date()).toISOString(), hs_note_body: input.body.slice(0, 60_000) },
      associations,
    });
    return { id: note.id };
  }

  private async pipelineList(force = false): Promise<Pipeline[]> {
    if (!force && this.pipelines && Date.now() - this.pipelines.loadedAt < PIPELINE_CACHE_MS) return this.pipelines.list;
    const res = await this.call<{ results?: Pipeline[] }>('GET', '/crm/v3/pipelines/deals');
    this.pipelines = { loadedAt: Date.now(), list: (res.results ?? []).map((p) => ({ id: p.id, label: p.label, stages: p.stages ?? [] })) };
    return this.pipelines.list;
  }

  /**
   * Pipeline et étape HubSpot d'un parcours : le pipeline qui porte le libellé du parcours, sinon (formule gratuite,
   * pipeline unique) le pipeline qui contient l'étape. Sans correspondance, le modèle n'est pas en place : `crm:setup`.
   */
  async resolveStage(pipeline: CrmPipeline, stage: string): Promise<{ pipelineId: string; stageId: string }> {
    const def = pipelineDefinition(pipeline);
    const stageDef = stageDefinition(pipeline, stage);
    const find = (list: Pipeline[]) => {
      const own = list.find((p) => normalize(p.label) === normalize(def.label));
      const candidates = own ? [own, ...list.filter((p) => p !== own)] : list;
      for (const p of candidates) {
        const found = p.stages.find((s) => normalize(s.label) === normalize(stageDef.label));
        if (found) return { pipelineId: p.id, stageId: found.id };
      }
      return null;
    };
    const cached = find(await this.pipelineList());
    if (cached) return cached;
    const fresh = find(await this.pipelineList(true));
    if (fresh) return fresh;
    throw new AppError('CRM_PIPELINE_MISSING', `Étape « ${stageDef.label} » du pipeline « ${def.label} » absente chez HubSpot : lancer pnpm --filter @neomoov/api crm:setup`, 500);
  }

  // --- Mise en place du modèle de données (crm:setup) ---

  /** Crée ou met à jour groupe, propriétés et pipelines ; `dryRun` ne fait que lire et annonce ce qui serait fait. */
  async setup(options: { dryRun?: boolean } = {}): Promise<HubSpotSetupReport[]> {
    const dryRun = options.dryRun === true;
    const report: HubSpotSetupReport[] = [];
    for (const objectType of ['contacts', 'companies', 'deals'] as const) {
      report.push(await this.ensureGroup(objectType, dryRun));
      for (const def of HUBSPOT_PROPERTIES[objectType]) report.push(await this.ensureProperty(objectType, def, dryRun));
    }
    report.push(...(await this.ensurePipelines(dryRun)));
    this.pipelines = null;
    return report;
  }

  private async ensureGroup(objectType: HubSpotObjectType, dryRun: boolean): Promise<HubSpotSetupReport> {
    const base = { kind: 'group' as const, objectType, name: HUBSPOT_PROPERTY_GROUP.name };
    try {
      await this.call('GET', `/crm/v3/properties/${objectType}/groups/${HUBSPOT_PROPERTY_GROUP.name}`);
      return { ...base, action: 'unchanged' };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (dryRun) return { ...base, action: 'planned', detail: 'à créer' };
    await this.call('POST', `/crm/v3/properties/${objectType}/groups`, { name: HUBSPOT_PROPERTY_GROUP.name, label: HUBSPOT_PROPERTY_GROUP.label, displayOrder: -1 });
    return { ...base, action: 'created' };
  }

  private async ensureProperty(objectType: HubSpotObjectType, def: HubSpotPropertyDefinition, dryRun: boolean): Promise<HubSpotSetupReport> {
    const base = { kind: 'property' as const, objectType, name: def.name };
    let existing: ExistingProperty | null = null;
    try {
      existing = await this.call<ExistingProperty>('GET', `/crm/v3/properties/${objectType}/${def.name}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!existing) {
      if (dryRun) return { ...base, action: 'planned', detail: `à créer (${def.label})` };
      await this.call('POST', `/crm/v3/properties/${objectType}`, {
        name: def.name, label: def.label, description: def.description, groupName: HUBSPOT_PROPERTY_GROUP.name, type: def.type, fieldType: def.fieldType,
        ...(def.options ? { options: def.options.map((o, i) => ({ label: o.label, value: o.value, displayOrder: i, hidden: false })) } : {}),
        ...(def.hasUniqueValue ? { hasUniqueValue: true } : {}),
      });
      return { ...base, action: 'created', detail: def.label };
    }
    if (existing.type && existing.type !== def.type) return { ...base, action: 'skipped', detail: `type « ${existing.type} » chez HubSpot, « ${def.type} » attendu : à corriger à la main` };
    const existingOptions = (existing.options ?? []).filter((o) => !o.hidden);
    const missingOptions = (def.options ?? []).filter((o) => !existingOptions.some((e) => e.value === o.value));
    const sameText = existing.label === def.label && (existing.description ?? '') === def.description;
    if (sameText && !missingOptions.length) return { ...base, action: 'unchanged' };
    const detail = missingOptions.length ? `options ajoutées : ${missingOptions.map((o) => o.value).join(', ')}` : 'libellé mis à jour';
    if (dryRun) return { ...base, action: 'planned', detail };
    // Les options existantes (y compris celles ajoutées à la main dans HubSpot) sont conservées ; les nôtres s'ajoutent.
    const options = def.options ? [...existingOptions.map((o) => ({ label: o.label, value: o.value })), ...missingOptions].map((o, i) => ({ ...o, displayOrder: i, hidden: false })) : undefined;
    await this.call('PATCH', `/crm/v3/properties/${objectType}/${def.name}`, { label: def.label, description: def.description, ...(options ? { options } : {}) });
    return { ...base, action: 'updated', detail };
  }

  private async ensurePipelines(dryRun: boolean): Promise<HubSpotSetupReport[]> {
    const report: HubSpotSetupReport[] = [];
    let list = await this.pipelineList(true);
    for (const def of HUBSPOT_PIPELINES) {
      const existing = list.find((p) => normalize(p.label) === normalize(def.label));
      if (existing) {
        report.push({ kind: 'pipeline', objectType: 'deals', name: def.label, action: 'unchanged' });
        report.push(...(await this.ensureStages(existing, def.stages, dryRun)));
        continue;
      }
      // Formule gratuite : un seul pipeline, déjà renommé « Neomoov » par un passage précédent ; ses étapes suffisent.
      const single = list.find((p) => normalize(p.label) === normalize(HUBSPOT_SINGLE_PIPELINE_LABEL));
      if (single && def.stages.every((s) => single.stages.some((st) => normalize(st.label) === normalize(s.label)))) {
        report.push({ kind: 'pipeline', objectType: 'deals', name: def.label, action: 'unchanged', detail: `parcours porté par le pipeline unique « ${single.label} »` });
        report.push(...(await this.ensureStages(single, def.stages, dryRun)));
        continue;
      }
      if (dryRun) {
        report.push({ kind: 'pipeline', objectType: 'deals', name: def.label, action: 'planned', detail: `à créer avec ${def.stages.length} étapes` });
        continue;
      }
      try {
        await this.call('POST', '/crm/v3/pipelines/deals', { label: def.label, displayOrder: list.length, stages: def.stages.map((s, i) => ({ label: s.label, displayOrder: i, metadata: { probability: String(s.probability) } })) });
        report.push({ kind: 'pipeline', objectType: 'deals', name: def.label, action: 'created', detail: `${def.stages.length} étapes` });
      } catch (error) {
        if (!pipelineLimitReached(error)) throw error;
        // Formule gratuite (un seul pipeline) : les deux parcours vivent dans le pipeline existant, renommé « Neomoov ».
        const target = single ?? list[0];
        if (!target) throw error;
        report.push({ kind: 'pipeline', objectType: 'deals', name: def.label, action: 'skipped', detail: `limite de pipelines de la formule HubSpot : étapes ajoutées au pipeline « ${target.label} »` });
        if (normalize(target.label) !== normalize(HUBSPOT_SINGLE_PIPELINE_LABEL)) {
          await this.call('PATCH', `/crm/v3/pipelines/deals/${target.id}`, { label: HUBSPOT_SINGLE_PIPELINE_LABEL });
          report.push({ kind: 'pipeline', objectType: 'deals', name: target.label, action: 'updated', detail: `renommé « ${HUBSPOT_SINGLE_PIPELINE_LABEL} »` });
          target.label = HUBSPOT_SINGLE_PIPELINE_LABEL;
        }
        report.push(...(await this.ensureStages(target, def.stages, false)));
      }
      list = await this.pipelineList(true);
    }
    return report;
  }

  private async ensureStages(pipeline: Pipeline, stages: HubSpotStageDefinition[], dryRun: boolean): Promise<HubSpotSetupReport[]> {
    const report: HubSpotSetupReport[] = [];
    let order = pipeline.stages.length;
    for (const s of stages) {
      const name = `${pipeline.label} / ${s.label}`;
      const existing = pipeline.stages.find((st) => normalize(st.label) === normalize(s.label));
      if (!existing) {
        if (dryRun) {
          report.push({ kind: 'stage', objectType: 'deals', name, action: 'planned', detail: 'à créer' });
          continue;
        }
        const created = await this.call<PipelineStage>('POST', `/crm/v3/pipelines/deals/${pipeline.id}/stages`, { label: s.label, displayOrder: order++, metadata: { probability: String(s.probability) } });
        pipeline.stages.push({ id: created.id, label: created.label ?? s.label, metadata: created.metadata ?? { probability: String(s.probability) } });
        report.push({ kind: 'stage', objectType: 'deals', name, action: 'created' });
        continue;
      }
      const probability = Number(existing.metadata?.probability);
      if (Number.isFinite(probability) && Math.abs(probability - s.probability) < 1e-9) {
        report.push({ kind: 'stage', objectType: 'deals', name, action: 'unchanged' });
        continue;
      }
      if (dryRun) {
        report.push({ kind: 'stage', objectType: 'deals', name, action: 'planned', detail: `probabilité à corriger (${s.probability})` });
        continue;
      }
      await this.call('PATCH', `/crm/v3/pipelines/deals/${pipeline.id}/stages/${existing.id}`, { label: existing.label, metadata: { probability: String(s.probability) } });
      existing.metadata = { probability: String(s.probability) };
      report.push({ kind: 'stage', objectType: 'deals', name, action: 'updated', detail: `probabilité ${s.probability}` });
    }
    return report;
  }
}
