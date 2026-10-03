/**
 * Calendrier de diffusion : semaine planifiée (du lundi au dimanche, heure de Montréal), créneaux par espace (réglage
 * `marketing.slots`, défauts ci-dessous), attribution des créneaux aux contenus, échéances de mesure (J+1, J+7) et
 * délais de nouvelle tentative d'une publication en échec.
 */
import { localClock, shiftLocalDate } from '../agents/agents.js';
import { CONTENT_SPACES, type ContentSpace } from './spaces.js';

/** Créneau hebdomadaire : jour (1 = lundi … 7 = dimanche) et heure locale `HH:MM`. */
export interface Slot {
  day: number;
  time: string;
}
export type SlotsBySpace = Readonly<Partial<Record<ContentSpace, readonly Slot[]>>>;

/** Créneaux par défaut (documentés dans docs/marketing/connecteurs.md) ; le réglage `marketing.slots` les remplace. */
export const DEFAULT_SLOTS: Readonly<Record<ContentSpace, readonly Slot[]>> = {
  site_blog: [{ day: 2, time: '10:00' }, { day: 4, time: '10:00' }],
  academy: [{ day: 3, time: '10:00' }, { day: 5, time: '10:00' }],
  google_business: [{ day: 1, time: '11:00' }, { day: 4, time: '11:00' }],
  facebook: [{ day: 1, time: '12:00' }, { day: 3, time: '12:00' }, { day: 5, time: '17:00' }],
  instagram: [{ day: 2, time: '12:00' }, { day: 4, time: '12:00' }, { day: 6, time: '11:00' }],
  linkedin: [{ day: 2, time: '08:30' }, { day: 4, time: '08:30' }],
  tiktok: [{ day: 3, time: '18:00' }, { day: 6, time: '18:00' }],
  youtube: [{ day: 5, time: '16:00' }],
  x: [{ day: 1, time: '09:00' }, { day: 3, time: '09:00' }, { day: 5, time: '09:00' }],
  snapchat: [{ day: 5, time: '19:00' }, { day: 7, time: '19:00' }],
  newsletter: [{ day: 4, time: '10:00' }],
  telegram: [{ day: 2, time: '17:30' }, { day: 4, time: '17:30' }],
  whatsapp_channel: [{ day: 1, time: '18:00' }, { day: 4, time: '18:00' }],
};

const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Créneaux valides d'un réglage libre (jour 1 à 7, heure `HH:MM`) ; les espaces absents ou vides reçoivent les défauts. */
export function parseSlots(raw: unknown): Record<ContentSpace, readonly Slot[]> {
  const out = { ...DEFAULT_SLOTS } as Record<ContentSpace, readonly Slot[]>;
  if (!raw || typeof raw !== 'object') return out;
  for (const space of CONTENT_SPACES) {
    const value = (raw as Record<string, unknown>)[space];
    if (!Array.isArray(value)) continue;
    const slots = value.filter((s): s is Slot => Boolean(s) && typeof s === 'object' && Number.isInteger((s as Slot).day) && (s as Slot).day >= 1 && (s as Slot).day <= 7 && typeof (s as Slot).time === 'string' && SLOT_TIME.test((s as Slot).time));
    if (slots.length) out[space] = slots;
  }
  return out;
}

/** Lundi de la semaine qui contient cette date locale. */
export function weekStartOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftLocalDate(date, -((weekday + 6) % 7));
}

/** Lundi de la semaine suivante (le calendrier du vendredi couvre la semaine d'après). */
export function nextWeekStart(now: Date, timeZone: string): string {
  return shiftLocalDate(weekStartOf(localClock(now, timeZone).date), 7);
}

/** Décalage (ms) entre l'heure locale du fuseau et l'heure UTC à cet instant. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instant UTC d'une date et d'une heure locales dans un fuseau (heure avancée ou normale selon la date). */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

/** Instant d'un créneau dans la semaine qui commence au lundi `weekStart`. */
export function slotInstant(weekStart: string, slot: Slot, timeZone: string): Date {
  return zonedInstant(shiftLocalDate(weekStart, slot.day - 1), slot.time, timeZone);
}

/**
 * Créneaux candidats d'un espace pour une semaine : ses créneaux (triés) et, la première semaine seulement (`withFreeDays`),
 * les jours libres de la semaine à l'heure du premier créneau (débordement quand les contenus dépassent les créneaux).
 */
export function slotCandidates(space: ContentSpace, weekStart: string, slots: SlotsBySpace, timeZone: string, withFreeDays: boolean): Date[] {
  const list = [...(slots[space]?.length ? slots[space]! : DEFAULT_SLOTS[space])].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  const out = list.map((slot) => slotInstant(weekStart, slot, timeZone));
  if (withFreeDays) {
    const usedDays = new Set(list.map((s) => s.day));
    for (let day = 1; day <= 7; day += 1) if (!usedDays.has(day)) out.push(slotInstant(weekStart, { day, time: list[0]!.time }, timeZone));
  }
  return out;
}

/**
 * Attribue un créneau à chaque contenu, par espace, dans l'ordre des candidats de la semaine, puis des semaines
 * suivantes. Un instant déjà passé (`notBefore`) est sauté : le contenu prend le premier créneau futur de son espace.
 */
export function assignSlots<T extends { space: ContentSpace }>(items: readonly T[], weekStart: string, slots: SlotsBySpace, timeZone: string, notBefore?: Date): Date[] {
  // Semaine de départ : celle demandée, sauf si elle est déjà entièrement passée (repli sur la semaine de `notBefore`).
  const base = notBefore && notBefore > slotInstant(weekStart, { day: 7, time: '23:59' }, timeZone) ? weekStartOf(localClock(notBefore, timeZone).date) : weekStart;
  const perSpace = new Map<ContentSpace, { queue: Date[]; week: number }>();
  return items.map((item) => {
    let state = perSpace.get(item.space);
    if (!state) {
      state = { queue: [], week: 0 };
      perSpace.set(item.space, state);
    }
    // Une semaine de candidats à la fois (jours libres compris la première semaine) ; les instants passés sont écartés.
    while (!state.queue.length) {
      state.queue = slotCandidates(item.space, shiftLocalDate(base, 7 * state.week), slots, timeZone, state.week === 0).filter((d) => !notBefore || d > notBefore);
      state.week += 1;
    }
    return state.queue.shift()!;
  });
}

/** Prochaine mesure (J+1, J+7 par défaut) après `count` mesures déjà faites ; null quand elles sont toutes faites. */
export function nextMeasureAt(publishedAt: Date, measureDays: readonly number[], count: number): Date | null {
  const day = measureDays[count];
  return day === undefined ? null : new Date(publishedAt.getTime() + day * 86_400_000);
}

/** Délai avant la prochaine tentative de publication : 5 min, 30 min, puis 2 h. */
export function retryDelayMs(attempt: number): number {
  if (attempt <= 1) return 5 * 60_000;
  if (attempt === 2) return 30 * 60_000;
  return 2 * 3_600_000;
}

/** Mesures agrégées gardées sur un contenu (dernière valeur et historique). */
export interface ContentMetricsRecord {
  reach: number;
  interactions: number;
  clicks: number;
  measuredAt: string | null;
  history: Array<{ at: string; day: number; reach: number; interactions: number; clicks: number }>;
}

export const EMPTY_METRICS: ContentMetricsRecord = { reach: 0, interactions: 0, clicks: 0, measuredAt: null, history: [] };

/** Mesures après une nouvelle lecture (`day` : jour de mesure, J+1 ou J+7), historique borné à 12 lectures. */
export function recordMeasure(previous: Partial<ContentMetricsRecord> | null | undefined, reading: { reach: number; interactions: number; clicks: number }, at: Date, day: number): ContentMetricsRecord {
  const history = [...(previous?.history ?? []), { at: at.toISOString(), day, ...reading }].slice(-12);
  return { ...reading, measuredAt: at.toISOString(), history };
}
