/**
 * Heures silencieuses de la boîte unifiée (réglage `inbox.quiet_hours`, 22 h à 7 h par défaut, heure de Montréal) :
 * pendant la fenêtre, seul l'accusé de réception part sur les canaux listés ; la réponse de fond est reportée à la fin
 * de la fenêtre. Fonction pure : la date, le fuseau et le réglage sont des entrées.
 */
export interface QuietHoursSetting {
  from: string;
  to: string;
  /** Canaux concernés ; vide : aucun canal (fenêtre inactive). */
  channels?: readonly string[];
}

export interface QuietHoursWindow {
  active: boolean;
  /** Fin de la fenêtre (instant), quand elle est active. */
  resumeAt: Date | null;
  /** Heure locale de reprise (« 7 h »), pour l'accusé de réception. */
  resumeLabel: string | null;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function minutes(time: string): number | null {
  const m = TIME.exec(time.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minute locale du jour (0 à 1439) d'un instant dans un fuseau. */
export function localMinuteOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  return get('hour') * 60 + get('minute');
}

/** Réglage lu en base, validé : horaires `HH:MM` et liste de canaux ; une valeur illisible rend une fenêtre inactive. */
export function parseQuietHours(value: unknown): QuietHoursSetting | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v['from'] !== 'string' || typeof v['to'] !== 'string' || minutes(v['from']) === null || minutes(v['to']) === null) return null;
  const channels = Array.isArray(v['channels']) ? v['channels'].filter((c): c is string => typeof c === 'string') : [];
  return { from: v['from'], to: v['to'], channels };
}

/**
 * Fenêtre à l'instant `now` pour un canal : active quand l'heure locale est entre `from` et `to` (fenêtre qui traverse
 * minuit admise) et que le canal est listé. `resumeAt` est l'instant de `to` du jour local courant ou du lendemain.
 */
export function quietHoursWindow(now: Date, timeZone: string, setting: QuietHoursSetting | null, channel: string): QuietHoursWindow {
  const inactive: QuietHoursWindow = { active: false, resumeAt: null, resumeLabel: null };
  if (!setting || !(setting.channels ?? []).includes(channel)) return inactive;
  const from = minutes(setting.from);
  const to = minutes(setting.to);
  if (from === null || to === null || from === to) return inactive;
  const current = localMinuteOfDay(now, timeZone);
  const active = from < to ? current >= from && current < to : current >= from || current < to;
  if (!active) return inactive;
  // Minutes jusqu'à la reprise, à partir de l'heure locale courante ; l'heure de reprise est exprimée en heure locale.
  const untilResume = ((to - current) % 1440 + 1440) % 1440;
  const resumeAt = new Date(now.getTime() + untilResume * 60_000);
  resumeAt.setUTCSeconds(0, 0);
  const [h, m] = setting.to.split(':').map(Number) as [number, number];
  return { active: true, resumeAt, resumeLabel: m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h` };
}
