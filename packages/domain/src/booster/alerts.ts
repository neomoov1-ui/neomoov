/**
 * Neomoov Booster (phase 1, agent G) : alertes sonores et visuelles de la journée du chauffeur. Réglages par chauffeur
 * (heures habituelles de session, rappels activés, son et couleur par type) et calcul pur des alertes dues à un instant
 * donné, dans le fuseau du chauffeur. Les périodes et zones de gain viennent des réglages de la plateforme
 * (`booster.peak_periods`, `booster.peak_zones`), jamais d'un chiffre codé ici.
 */
import { z } from 'zod';

export const ALERT_TYPES = ['inspection', 'session_info', 'session_start', 'session_end', 'peak_period', 'peak_zone'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Sons disponibles dans l'application chauffeur (fichiers embarqués) ; `none` : vibration seulement. */
export const ALERT_SOUNDS = ['check', 'session', 'peak', 'default', 'none'] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number];

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure HH:MM attendue');
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur #RRGGBB attendue');

export const alertStyleSchema = z.object({ sound: z.enum(ALERT_SOUNDS), color: colorSchema });
export type AlertStyle = z.infer<typeof alertStyleSchema>;

export const alertRemindersSchema = z.object({
  inspection: z.boolean(),
  session_info: z.boolean(),
  session_start: z.boolean(),
  session_end: z.boolean(),
  peak_period: z.boolean(),
  peak_zone: z.boolean(),
});
export type AlertReminders = z.infer<typeof alertRemindersSchema>;

export const alertStylesSchema = z.object({
  inspection: alertStyleSchema,
  session_info: alertStyleSchema,
  session_start: alertStyleSchema,
  session_end: alertStyleSchema,
  peak_period: alertStyleSchema,
  peak_zone: alertStyleSchema,
});
export type AlertStyles = z.infer<typeof alertStylesSchema>;

export const driverAlertSettingsSchema = z.object({
  sessionStart: timeOfDaySchema,
  sessionEnd: timeOfDaySchema,
  timeZone: z.string().min(1).max(40),
  reminders: alertRemindersSchema,
  styles: alertStylesSchema,
});
export type DriverAlertSettings = z.infer<typeof driverAlertSettingsSchema>;

/** Défauts documentés (docs/booster.md) : session de 7 h à 17 h, tous les rappels, un son et une couleur par famille. */
export const DEFAULT_ALERT_SETTINGS: DriverAlertSettings = {
  sessionStart: '07:00',
  sessionEnd: '17:00',
  timeZone: 'America/Toronto',
  reminders: { inspection: true, session_info: true, session_start: true, session_end: true, peak_period: true, peak_zone: true },
  styles: {
    inspection: { sound: 'check', color: '#D97706' },
    session_info: { sound: 'session', color: '#1485E0' },
    session_start: { sound: 'session', color: '#1485E0' },
    session_end: { sound: 'session', color: '#0B1F3A' },
    peak_period: { sound: 'peak', color: '#16A34A' },
    peak_zone: { sound: 'peak', color: '#16A34A' },
  },
};

/** Fenêtre de gain : jours (0 dimanche à 6 samedi), heure de début et de fin (une fin plus petite passe minuit), zone facultative. */
export const gainWindowSchema = z.object({
  label: z.object({ fr: z.string().min(1).max(80), en: z.string().min(1).max(80) }),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: timeOfDaySchema,
  to: timeOfDaySchema,
  zone: z.string().max(40).optional(),
});
export type GainWindow = z.infer<typeof gainWindowSchema>;

/** Réglages lus en base (JSON), ramenés aux défauts si illisibles. */
export function parseAlertSettings(value: unknown): DriverAlertSettings {
  const parsed = driverAlertSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ALERT_SETTINGS;
}

export function parseGainWindows(value: unknown): GainWindow[] {
  const parsed = z.array(gainWindowSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export interface LocalMoment {
  /** Date civile `AAAA-MM-JJ`. */
  date: string;
  /** 0 dimanche à 6 samedi. */
  weekday: number;
  minutes: number;
}

/** Date, jour de semaine et minute de la journée d'un instant, dans un fuseau ; un fuseau inconnu retombe sur Montréal. */
export function localMoment(instant: Date, timeZone: string): LocalMoment {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  } catch {
    return localMoment(instant, 'America/Toronto');
  }
  const get = (type: string): string => parts.find((p) => p.type === type)!.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minutes: Number(get('hour')) % 24 * 60 + Number(get('minute')) };
}

export interface DueAlert {
  type: AlertType;
  /** Marque d'idempotence (type, date, fenêtre) : une alerte marquée n'est pas renvoyée. */
  marker: string;
  style: AlertStyle;
  /** Fenêtre de gain concernée (période ou zone). */
  window: GainWindow | null;
}

export interface AlertContext {
  now: Date;
  settings: DriverAlertSettings;
  peakPeriods: readonly GainWindow[];
  peakZones: readonly GainWindow[];
  /** Une inspection archivée existe déjà pour la journée locale. */
  hasInspectionToday: boolean;
  /** Minutes pendant lesquelles une alerte reste due après son heure (battement de la file). */
  toleranceMinutes: number;
  /** Marques déjà envoyées (`type:date[:index]`). */
  sent: ReadonlySet<string>;
}

/**
 * Alertes dues à l'instant `now` : à l'heure habituelle de début, la vérification sommaire (si aucune inspection du jour)
 * et les informations de début de session ; à l'heure de fin, le rapport de performance ; au début de chaque fenêtre de
 * gain (période ou zone) dont le jour correspond. Chaque alerte est due dans [heure, heure + tolérance) et une seule fois
 * par jour (marques).
 */
export function dueAlerts(ctx: AlertContext): DueAlert[] {
  const local = localMoment(ctx.now, ctx.settings.timeZone);
  const due = (time: string): boolean => {
    const delta = local.minutes - minutesOfDay(time);
    return delta >= 0 && delta < ctx.toleranceMinutes;
  };
  const out: DueAlert[] = [];
  const push = (type: AlertType, marker: string, window: GainWindow | null) => {
    if (!ctx.settings.reminders[type] || ctx.sent.has(marker)) return;
    out.push({ type, marker, style: ctx.settings.styles[type], window });
  };
  if (due(ctx.settings.sessionStart)) {
    if (!ctx.hasInspectionToday) push('inspection', `inspection:${local.date}`, null);
    push('session_info', `session_info:${local.date}`, null);
    push('session_start', `session_start:${local.date}`, null);
  }
  if (due(ctx.settings.sessionEnd)) push('session_end', `session_end:${local.date}`, null);
  ctx.peakPeriods.forEach((window, index) => {
    if (window.days.includes(local.weekday) && due(window.from)) push('peak_period', `peak_period:${local.date}:${index}`, window);
  });
  ctx.peakZones.forEach((window, index) => {
    if (window.days.includes(local.weekday) && due(window.from)) push('peak_zone', `peak_zone:${local.date}:${index}`, window);
  });
  return out;
}

/** Marques à garder : celles de la journée locale courante et de la veille (fenêtres qui passent minuit). */
export function pruneMarkers(markers: readonly string[], today: string, yesterday: string): string[] {
  return markers.filter((m) => m.includes(`:${today}`) || m.includes(`:${yesterday}`));
}
