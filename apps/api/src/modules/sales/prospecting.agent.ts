/**
 * Agent de prospection B2B (`b2b_prospecting`, phase 1 « entreprise autonome ») : du lundi au vendredi (réglage
 * `sales.prospecting_days`) à partir de 9 h, enchaînement fixe : sources déclarées (Google Places par catégorie et zone,
 * plafond quotidien `sales.daily_new_prospects` ; demandes d'entreprises et de partenaires du site ; prospects importés
 * par fichier CSV déjà en base), qualification par le modèle (sortie structurée : segment, taille, intérêt, retenu ou
 * écarté, nom de l'organisation pour une demande du site), fiche HubSpot par le service CRM, séquence approuvée par le
 * canal professionnel (file des notifications). Jamais un particulier ; retrait respecté sans exception.
 */
import { asUntrustedData, localClock, PROSPECT_INTERESTS, PROSPECT_SEGMENTS, PROSPECT_SIZES, redactSensitive, type ProspectSegment } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { z } from 'zod';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { AgentRunnerService, type AgentExecution, type AgentRunContext } from '../agents/agent-runner.service.js';
import { AgentToolsService } from '../agents/agent-tools.service.js';
import { ProspectsService } from './prospects.service.js';

export const B2B_PROSPECTING = 'b2b_prospecting';

/** Qualification d'un lot de candidats par le modèle (bornée après lecture). */
export const prospectQualificationSchema = z.object({
  items: z.array(z.object({
    ref: z.string().describe('Référence du candidat telle que fournie (prospect:<id> ou lead:<id>)'),
    organizationName: z.string().nullable().describe('Nom de l\'organisation (obligatoire pour une demande du site, sinon null)'),
    segment: z.enum(PROSPECT_SEGMENTS),
    size: z.enum(PROSPECT_SIZES),
    interest: z.enum(PROSPECT_INTERESTS),
    qualified: z.boolean().describe('Faux : particulier, hors zone, établissement fermé ou sans besoin de transport de personnes'),
    reason: z.string().describe('Motif court, factuel'),
  })),
});

export interface ProspectingSources {
  places: { categories: string[]; zones: string[] } | null;
  csv: boolean;
  webLeads: boolean;
}

export interface ProspectingSummary {
  searches: number;
  candidates: number;
  created: number;
  leads: number;
  qualified: number;
  rejected: number;
  sequencesStarted: number;
  pendingApprovals: number;
  capReached: boolean;
}

const DEFAULT_SOURCES: ProspectingSources = { places: { categories: ['hôtel', 'agence de voyages', 'salle de réception', 'clinique privée', 'école privée', 'siège social'], zones: ['Montréal, QC', 'Laval, QC', 'Longueuil, QC'] }, csv: true, webLeads: true };
const BATCH = 20;

function parseSources(raw: unknown): ProspectingSources {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { places?: unknown; csv?: unknown; webLeads?: unknown };
  const places = r.places && typeof r.places === 'object' ? (r.places as { categories?: unknown; zones?: unknown }) : null;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 12) : []);
  const categories = strings(places?.categories);
  const zones = strings(places?.zones);
  return { places: r.places === false || !categories.length || !zones.length ? (r.places === undefined ? DEFAULT_SOURCES.places : null) : { categories, zones }, csv: r.csv !== false, webLeads: r.webLeads !== false };
}

@Injectable()
export class ProspectingAgent {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly prospects: ProspectsService,
  ) {}

  /** La passe est due : jour de prospection et heure atteinte (heure de Montréal). */
  async due(now: Date): Promise<boolean> {
    const [tz, days, hour] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.get<unknown>('sales.prospecting_days', [1, 2, 3, 4, 5]), this.settings.number('sales.prospecting_hour', 9)]);
    const clock = localClock(now, tz);
    const allowed = Array.isArray(days) ? days.filter((d): d is number => typeof d === 'number') : [1, 2, 3, 4, 5];
    return allowed.includes(clock.weekday) && clock.hour >= hour;
  }

  /** Passe de prospection (une par jour de Montréal, référence = date ; `ref` null : passe demandée dans My Hub). */
  async run(now = new Date(), options: { ref?: string | null } = {}): Promise<AgentExecution<ProspectingSummary>> {
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const date = localClock(now, tz).date;
    const ref = options.ref === undefined ? date : options.ref;
    return this.runner.execute(B2B_PROSPECTING, { name: 'prospecting.daily', ref, input: { date } }, (ctx) => this.body(ctx, now, tz));
  }

  private async body(ctx: AgentRunContext, now: Date, tz: string): Promise<ProspectingSummary> {
    const summary: ProspectingSummary = { searches: 0, candidates: 0, created: 0, leads: 0, qualified: 0, rejected: 0, sequencesStarted: 0, pendingApprovals: 0, capReached: false };
    const sources = parseSources(await this.settings.get<unknown>('sales.sources', DEFAULT_SOURCES));
    const cap = await this.settings.number('sales.daily_new_prospects', 20);
    let budget = cap - (await this.prospects.createdTodayFromPlaces(now, tz));

    // 1. Sources ouvertes : établissements par catégorie et zone, dans la limite du plafond quotidien.
    if (sources.places) {
      search: for (const category of sources.places.categories) {
        for (const zone of sources.places.zones) {
          if (budget <= 0) {
            summary.capReached = true;
            break search;
          }
          const found = await this.tools.call(ctx, 'searchProspects', { category, zone, limit: Math.min(10, budget) });
          summary.searches += 1;
          if (!found.ok) continue;
          const candidates = ((found.data as { candidates?: Array<Record<string, unknown>> }).candidates ?? []);
          summary.candidates += candidates.length;
          for (const c of candidates) {
            if (budget <= 0) break;
            const created = await this.tools.call(ctx, 'createProspect', {
              organizationName: String(c['name'] ?? '').slice(0, 200), segment: this.segmentFor(category), source: 'google_places', sourceRef: String(c['placeId'] ?? ''), website: typeof c['website'] === 'string' ? c['website'].slice(0, 300) : undefined,
              city: typeof c['city'] === 'string' ? c['city'].slice(0, 80) : undefined, phone: typeof c['phone'] === 'string' ? c['phone'] : undefined, consentBasis: 'published_address',
              rating: typeof c['rating'] === 'number' ? c['rating'] : null, reviewCount: typeof c['reviewCount'] === 'number' ? c['reviewCount'] : null, language: 'fr',
            });
            if (created.ok && (created.data as { created?: boolean }).created) {
              summary.created += 1;
              budget -= 1;
            }
          }
        }
      }
    }

    // 2. Qualification par le modèle : prospects « nouveaux » (sources ouvertes, fichiers CSV) et demandes du site.
    const toQualify = await this.prospects.toQualify(60);
    const leads = sources.webLeads ? await this.tools.call(ctx, 'listLeadProspects', { limit: 20 }) : null;
    const leadItems = leads?.ok ? ((leads.data as { leads?: Array<Record<string, unknown>> }).leads ?? []) : [];
    summary.leads = leadItems.length;
    const candidates = [
      ...toQualify.map((p) => ({ ref: `prospect:${p.id}`, organizationName: p.organizationName, segment: p.segment, source: p.source, city: p.city, website: p.website, contactName: p.contactName, contactRole: p.contactRole, hasEmail: Boolean(p.email), hasPhone: Boolean(p.phone), rating: p.rating === null ? null : Number(p.rating), reviewCount: p.reviewCount, notes: p.notes?.slice(0, 300) ?? null })),
      ...leadItems.map((l) => ({ ref: `lead:${String(l['leadId'])}`, organizationName: null, segment: 'other', source: 'web_lead', city: l['city'] ?? null, website: null, contactName: l['contactName'] ?? null, contactRole: null, hasEmail: Boolean(l['hasBusinessEmail']), hasPhone: Boolean(l['hasPhone']), rating: null, reviewCount: null, notes: typeof l['message'] === 'string' ? l['message'] : null })),
    ];
    const leadById = new Map(leadItems.map((l) => [String(l['leadId']), l]));
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const output = await ctx.structured('prospect_qualification', prospectQualificationSchema, [{
        role: 'user',
        content: [
          `Tâche : qualifier ces ${batch.length} candidats pour une offre de transport de personnes à prix fixe (comptes entreprises, hôtels, agences, événements, cliniques, écoles) à Montréal et sa région. Date : ${localClock(now, tz).date}.`,
          'Règles : jamais un particulier ; écarter les établissements fermés, hors de la région de Montréal ou sans besoin plausible de déplacements de personnes ; pour une demande du site (lead), donner le nom de l\'organisation tel qu\'il apparaît dans le message, sinon null.',
          asUntrustedData('candidats', JSON.stringify(batch)),
        ].join('\n'),
      }]);
      for (const item of output.items.slice(0, batch.length)) {
        const reason = redactSensitive(item.reason).slice(0, 300) || 'Sans motif';
        let prospectId: string | null = null;
        if (item.ref.startsWith('prospect:')) prospectId = item.ref.slice('prospect:'.length);
        else if (item.ref.startsWith('lead:')) {
          const leadId = item.ref.slice('lead:'.length);
          const lead = leadById.get(leadId);
          if (!lead) continue;
          if (!item.qualified) {
            summary.rejected += 1;
            continue;
          }
          const name = item.organizationName?.trim() || `Demande ${String(lead['kind'])} de ${String(lead['contactName'] ?? 'contact du site')}`;
          const created = await this.tools.call(ctx, 'createProspect', { organizationName: name.slice(0, 200), segment: item.segment, source: 'web_lead', sourceRef: leadId, leadId, contactName: typeof lead['contactName'] === 'string' ? lead['contactName'] : undefined, city: typeof lead['city'] === 'string' ? lead['city'] : undefined, language: lead['language'] === 'en' ? 'en' : 'fr', consentBasis: 'form' });
          if (!created.ok) continue;
          prospectId = String((created.data as { prospectId: string }).prospectId);
        }
        if (!prospectId) continue;
        const qualified = await this.tools.call(ctx, 'qualifyProspect', { prospectId, segment: item.segment, size: item.size, interest: item.interest, qualified: item.qualified, reason });
        if (!qualified.ok) continue;
        if (!item.qualified) {
          summary.rejected += 1;
          continue;
        }
        summary.qualified += 1;
        const started = await this.tools.call(ctx, 'startSequence', { prospectId, justification: `Prospect qualifié (${item.segment}, intérêt ${item.interest}) : ${reason}` });
        if (started.status === 'pending_approval') summary.pendingApprovals += 1;
        else if (started.ok) summary.sequencesStarted += 1;
      }
    }
    this.logger.info({ runId: ctx.runId, ...summary }, 'Passe de prospection B2B');
    return summary;
  }

  /** Segment déduit de la catégorie cherchée (le modèle le confirme à la qualification). */
  private segmentFor(category: string): ProspectSegment {
    const c = category.toLowerCase();
    if (/h[oô]tel|auberge|motel/.test(c)) return 'hotel';
    if (/agence|voyage|tourisme/.test(c)) return 'agency';
    if (/[ée]v[ée]nement|r[ée]ception|congr[eè]s|salle/.test(c)) return 'event';
    if (/clinique|m[ée]dical|dent/.test(c)) return 'clinic';
    if (/[ée]cole|coll[eè]ge|universit/.test(c)) return 'school';
    if (/si[eè]ge|entreprise|bureau|corporat/.test(c)) return 'business';
    return 'other';
  }
}
