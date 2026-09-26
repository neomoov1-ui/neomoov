/**
 * Agents IA (section 5.16) : règles pures de l'infrastructure des agents. Coût d'une exécution en micro-dollars selon
 * le barème des réglages, plafond quotidien de dépense, décision d'exécution d'une action financière selon le mode et
 * les plafonds, minimisation des contenus transmis au modèle (numéros de carte masqués, contenus des utilisateurs
 * balisés comme des données), échéances et périodes des rapports, contrôle des lignes d'un relevé (agent comptabilité).
 */
import type { AgentMode } from '../enums.js';
import { isCredit, type StatementLineKind } from '../settlement/settlement.js';

/** Niveaux d'effort de `output_config.effort` (réglés par agent en base). */
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

/** Jetons d'une exécution (toutes les requêtes au modèle cumulées). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Prix d'un modèle en micro-dollars par million de jetons (réglage `agents.llm_pricing`). */
export interface LlmModelPrice {
  inputMicrosPerMTok: number;
  outputMicrosPerMTok: number;
  cacheReadMicrosPerMTok: number;
  cacheWriteMicrosPerMTok: number;
}

export type LlmPricing = Record<string, LlmModelPrice>;

export const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

/** Prix du modèle qui a servi la requête ; à défaut, l'entrée `default` du barème ; sinon null (coût inconnu). */
export function priceFor(pricing: LlmPricing, model: string): LlmModelPrice | null {
  return pricing[model] ?? pricing['default'] ?? null;
}

/** Coût d'une exécution en micro-dollars, arrondi au micro-dollar supérieur ; 0 sans prix connu. */
export function llmCostMicros(usage: LlmUsage, price: LlmModelPrice | null): number {
  if (!price) return 0;
  const total = usage.inputTokens * price.inputMicrosPerMTok
    + usage.outputTokens * price.outputMicrosPerMTok
    + usage.cacheReadInputTokens * price.cacheReadMicrosPerMTok
    + usage.cacheCreationInputTokens * price.cacheWriteMicrosPerMTok;
  return Math.ceil(total / 1_000_000);
}

/**
 * Plafond de dépense du jour : le plus bas du plafond global (`agents.daily_budget_micros`) et de celui de l'agent
 * (`thresholds.dailyBudgetMicros`) ; null quand aucun n'est fixé (pas de plafond).
 */
export function effectiveDailyCap(globalCapMicros: number | null, agentCapMicros: number | null): number | null {
  const caps = [globalCapMicros, agentCapMicros].filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c >= 0);
  return caps.length ? Math.min(...caps) : null;
}

/** Plafond atteint : la dépense du jour de l'agent ou de l'ensemble des agents l'égale ou le dépasse. */
export function dailyBudgetExceeded(spent: { agentMicros: number; allAgentsMicros: number }, caps: { globalCapMicros: number | null; agentCapMicros: number | null }): boolean {
  if (caps.globalCapMicros !== null && spent.allAgentsMicros >= caps.globalCapMicros) return true;
  return caps.agentCapMicros !== null && spent.agentMicros >= caps.agentCapMicros;
}

/** Qui agit : un agent dans son mode, ou un humain (personnel) qui appelle l'outil directement. */
export type ActingMode = AgentMode | 'human';

export type FinancialDecision =
  | { action: 'execute' }
  | { action: 'approval' }
  | { action: 'refuse'; reason: 'over_tool_cap' | 'manual_mode' };

/**
 * Action financière (remboursement, crédit) proposée par un agent : refusée au-delà du plafond de l'outil (5 000 cents,
 * escalade humaine), exécutée par un humain ou par un agent en mode `auto` dans son seuil automatique, sinon proposée
 * dans la file d'approbation. En mode `manual`, l'agent n'agit pas.
 */
export function financialDecision(input: { mode: ActingMode; amountCents: number; toolCapCents: number; autoCapCents: number }): FinancialDecision {
  if (input.amountCents > input.toolCapCents) return { action: 'refuse', reason: 'over_tool_cap' };
  if (input.mode === 'human') return { action: 'execute' };
  if (input.mode === 'manual') return { action: 'refuse', reason: 'manual_mode' };
  if (input.mode === 'auto' && input.amountCents <= input.autoCapCents) return { action: 'execute' };
  return { action: 'approval' };
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD_LIKE = /\b\d(?:[ -]?\d){12,18}\b/g;
const SIN_LIKE = /\b\d{3}[ -]\d{3}[ -]\d{3}\b/g;

/**
 * Minimisation (5.16) : masque les numéros de carte (13 à 19 chiffres valides selon Luhn, espaces ou tirets admis) et
 * les numéros d'assurance sociale (3-3-3 chiffres valides) avant tout envoi au modèle ou toute journalisation.
 */
export function redactSensitive(text: string): string {
  return text
    .replace(CARD_LIKE, (match) => (luhnValid(match.replace(/\D/g, '')) ? '[numéro de carte masqué]' : match))
    .replace(SIN_LIKE, (match) => (luhnValid(match.replace(/\D/g, '')) ? '[NAS masqué]' : match));
}

/**
 * Contenu d'un utilisateur (message, document) transmis au modèle : masqué, puis balisé comme une donnée. Les balises
 * qu'il contiendrait sont neutralisées, pour qu'il ne puisse pas sortir du bloc et se faire passer pour une consigne.
 */
export function asUntrustedData(source: string, text: string): string {
  const cleaned = redactSensitive(text).replace(/<\s*\/?\s*donnees_utilisateur[^>]*>/gi, '[balise retirée]');
  return `<donnees_utilisateur source="${source.replace(/[^a-z0-9_-]/gi, '')}">\n${cleaned}\n</donnees_utilisateur>`;
}

/** Heure locale d'un instant dans un fuseau : date AAAA-MM-JJ, jour de la semaine (0 = dimanche), heure. */
export function localClock(instant: Date, timeZone: string): { date: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), hour: Number(get('hour')) };
}

export function shiftLocalDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ReportKind = 'daily' | 'weekly';

export interface ReportPeriod {
  kind: ReportKind;
  from: string;
  to: string;
  /** Référence unique de l'exécution (idempotence de la planification) : `daily:<jour couvert>`, `weekly:<lundi couvert>`. */
  ref: string;
}

/** Période couverte : la veille (quotidien), la semaine précédente du lundi au dimanche (hebdomadaire). */
export function reportPeriod(kind: ReportKind, now: Date, timeZone: string): ReportPeriod {
  const { date, weekday } = localClock(now, timeZone);
  if (kind === 'daily') {
    const day = shiftLocalDate(date, -1);
    return { kind, from: day, to: day, ref: `daily:${day}` };
  }
  const thisMonday = shiftLocalDate(date, -((weekday + 6) % 7));
  const from = shiftLocalDate(thisMonday, -7);
  return { kind, from, to: shiftLocalDate(thisMonday, -1), ref: `weekly:${from}` };
}

/**
 * Rapports dus à cet instant (heure de Montréal) : le quotidien à partir de l'heure d'envoi, l'hebdomadaire le lundi
 * (jour réglable) à partir de la même heure. La passe est rejouable : la référence unique de la période évite le doublon
 * et rattrape un envoi manqué pendant un arrêt.
 */
export function reportsDue(now: Date, timeZone: string, schedule: { hour: number; weeklyWeekday: number }): ReportPeriod[] {
  const { weekday, hour } = localClock(now, timeZone);
  if (hour < schedule.hour) return [];
  const due = [reportPeriod('daily', now, timeZone)];
  if (weekday === schedule.weeklyWeekday) due.push(reportPeriod('weekly', now, timeZone));
  return due;
}

// Cohérence d'un document avec le profil du chauffeur (agent recrutement) -------------------------------------------------

export interface ExtractedDocumentFields {
  documentType: string;
  fullName: string | null;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  legible: boolean;
}

export interface DeclaredDocument {
  type: string;
  number: string | null;
  expiresOn: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface IdentityComparison {
  typeMatches: boolean;
  /** null : rien à comparer (nom, numéro ou échéance absents d'un côté). */
  nameMatches: boolean | null;
  numberMatches: boolean | null;
  expiryMatches: boolean | null;
  expired: boolean;
  legible: boolean;
  issues: string[];
}

const nameTokens = (value: string): string[] =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
const alnum = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Compare les champs extraits d'un document à ce que le chauffeur a déclaré : type, nom (chaque mot du prénom et du
 * nom présent, accents et casse ignorés), numéro (lettres et chiffres seulement), échéance, validité à la date du jour.
 */
export function compareDocumentIdentity(extracted: ExtractedDocumentFields, declared: DeclaredDocument, today: string): IdentityComparison {
  const issues: string[] = [];
  const typeMatches = extracted.documentType === declared.type;
  if (!typeMatches) issues.push(`Type lu ${extracted.documentType}, type déclaré ${declared.type}`);
  const declaredName = nameTokens(`${declared.firstName ?? ''} ${declared.lastName ?? ''}`);
  let nameMatches: boolean | null = null;
  if (extracted.fullName && declaredName.length) {
    const read = new Set(nameTokens(extracted.fullName));
    nameMatches = declaredName.every((t) => read.has(t));
    if (!nameMatches) issues.push('Le nom du document ne correspond pas au profil');
  }
  let numberMatches: boolean | null = null;
  if (extracted.number && declared.number) {
    numberMatches = alnum(extracted.number) === alnum(declared.number);
    if (!numberMatches) issues.push('Le numéro lu diffère du numéro déclaré');
  }
  let expiryMatches: boolean | null = null;
  if (extracted.expiresOn && declared.expiresOn) {
    expiryMatches = extracted.expiresOn === declared.expiresOn;
    if (!expiryMatches) issues.push(`Échéance lue ${extracted.expiresOn}, déclarée ${declared.expiresOn}`);
  }
  const expiry = extracted.expiresOn ?? declared.expiresOn;
  const expired = expiry !== null && expiry < today;
  if (expired) issues.push(`Document échu le ${expiry}`);
  if (!extracted.legible) issues.push('Document peu lisible');
  return { typeMatches, nameMatches, numberMatches, expiryMatches, expired, legible: extracted.legible, issues };
}

// Contrôle des relevés (agent comptabilité) -----------------------------------------------------------------------------

export interface StatementCheckLine {
  id: string;
  kind: string;
  amountCents: number;
  rideId: string | null;
}

export interface StatementCheckRide {
  id: string;
  publicNumber: string;
  finalPriceCents: number | null;
  paymentChannel: 'platform' | 'direct';
}

export interface StatementCheckInput {
  creditsCents: number;
  debitsCents: number;
  netCents: number;
  lines: StatementCheckLine[];
  /** Courses terminées du chauffeur dans la période du relevé. */
  rides: StatementCheckRide[];
  /** Montant au-delà duquel une ligne est hors bornes (réglage `agents.accounting_max_line_cents`). */
  maxLineCents: number;
}

export const STATEMENT_ANOMALY_KINDS = ['totals_mismatch', 'ride_without_line', 'line_without_ride', 'amount_out_of_bounds', 'duplicate_line', 'fare_above_price', 'other'] as const;
export type StatementAnomalyKind = (typeof STATEMENT_ANOMALY_KINDS)[number];

export interface StatementAnomaly {
  kind: StatementAnomalyKind;
  lineIds: string[];
  rideId: string | null;
  amountCents: number;
  detail: string;
}

/**
 * Contrôles déterministes d'un relevé : totaux recalculés, course terminée sans ligne, ligne d'une course hors période,
 * montant hors bornes, ligne en double, tarif supérieur au prix de la course. L'agent explique ; ces contrôles décident.
 */
export function checkStatement(input: StatementCheckInput): StatementAnomaly[] {
  const anomalies: StatementAnomaly[] = [];
  let credits = 0;
  let debits = 0;
  for (const line of input.lines) {
    if (isCredit(line.kind as StatementLineKind)) credits += line.amountCents;
    else debits += line.amountCents;
  }
  if (credits !== input.creditsCents || debits !== input.debitsCents || credits - debits !== input.netCents) {
    anomalies.push({ kind: 'totals_mismatch', lineIds: [], rideId: null, amountCents: Math.abs(credits - debits - input.netCents), detail: `Lignes : crédits ${credits}, débits ${debits} ; relevé : crédits ${input.creditsCents}, débits ${input.debitsCents}, net ${input.netCents}` });
  }
  const rides = new Map(input.rides.map((r) => [r.id, r]));
  const seen = new Map<string, string>();
  for (const line of input.lines) {
    if (line.amountCents > input.maxLineCents) anomalies.push({ kind: 'amount_out_of_bounds', lineIds: [line.id], rideId: line.rideId, amountCents: line.amountCents, detail: `Ligne ${line.kind} de ${line.amountCents} cents, au-delà de ${input.maxLineCents}` });
    if (!line.rideId) continue;
    const ride = rides.get(line.rideId);
    if (!ride) {
      anomalies.push({ kind: 'line_without_ride', lineIds: [line.id], rideId: line.rideId, amountCents: line.amountCents, detail: `Ligne ${line.kind} d'une course absente des courses terminées de la période` });
      continue;
    }
    const key = `${line.kind}|${line.rideId}`;
    const first = seen.get(key);
    if (first) anomalies.push({ kind: 'duplicate_line', lineIds: [first, line.id], rideId: line.rideId, amountCents: line.amountCents, detail: `Ligne ${line.kind} en double pour la course ${ride.publicNumber}` });
    else seen.set(key, line.id);
    if (line.kind === 'ride_fare_platform' && ride.finalPriceCents !== null && line.amountCents > ride.finalPriceCents) {
      anomalies.push({ kind: 'fare_above_price', lineIds: [line.id], rideId: ride.id, amountCents: line.amountCents - ride.finalPriceCents, detail: `Tarif de ${line.amountCents} cents supérieur au prix final de la course ${ride.publicNumber} (${ride.finalPriceCents})` });
    }
  }
  const expected = (ride: StatementCheckRide) => (ride.paymentChannel === 'platform' ? 'ride_fare_platform' : 'service_fee_direct');
  for (const ride of input.rides) {
    if (!ride.finalPriceCents) continue;
    if (!input.lines.some((l) => l.rideId === ride.id && l.kind === expected(ride))) {
      anomalies.push({ kind: 'ride_without_line', lineIds: [], rideId: ride.id, amountCents: ride.finalPriceCents, detail: `Course ${ride.publicNumber} terminée sans ligne ${expected(ride)}` });
    }
  }
  return anomalies;
}
