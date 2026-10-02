/**
 * Neomoov Booster (phase 1, agent G) : alertes sonores et visuelles de la journée. Réglages par chauffeur (heures
 * habituelles, rappels, son et couleur par type), périodes et zones de gain de la plateforme (`booster.peak_periods`,
 * `booster.peak_zones`, défauts documentés), passe chaque minute (file `booster`) qui envoie par `NotificationsOutbox`
 * les alertes dues (push, canal Android, son et couleur par type) et marque ce qui est parti (une fois par jour).
 */
import { schema } from '@neomoov/db';
import {
  ALERT_SOUNDS, DEFAULT_ALERT_SETTINGS, dueAlerts, localMoment, parseAlertSettings, parseGainWindows, pruneMarkers, type AlertSound, type AlertType, type DriverAlertSettings,
  type DriverAlertSettingsUpdate, type DriverAlertSettingsView, type GainWindow,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { DriverProfileService } from '../drivers/driver-profile.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { InspectionsService } from './inspections.service.js';

/** Défauts documentés (docs/booster.md) ; les mêmes que les données de départ, pour une base sans ces réglages. */
export const DEFAULT_PEAK_PERIODS: GainWindow[] = [
  { label: { fr: 'Aéroport, départs du matin', en: 'Airport, morning departures' }, days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00' },
  { label: { fr: 'Soirées du vendredi et du samedi', en: 'Friday and Saturday evenings' }, days: [5, 6], from: '17:00', to: '02:00' },
];
export const DEFAULT_PEAK_ZONES: GainWindow[] = [
  { label: { fr: 'Aéroport Montréal-Trudeau', en: 'Montréal-Trudeau airport' }, days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', zone: 'yul' },
  { label: { fr: 'Centre-ville', en: 'Downtown' }, days: [5, 6], from: '17:00', to: '02:00', zone: 'centre-ville' },
];

/** Canal Android et fichier sonore de l'application chauffeur pour chaque son ; `none` : canal silencieux, vibration seulement. */
export function pushStyle(sound: AlertSound): { channelId: string; sound: string } {
  if (sound === 'default') return { channelId: 'default', sound: 'default' };
  if (sound === 'none') return { channelId: 'booster-silent', sound: 'none' };
  return { channelId: `booster-${sound}`, sound: `booster_${sound}.wav` };
}

/** Fusion sans clé explicitement indéfinie (propriétés facultatives exactes). */
function merge<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined } | undefined): T {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  return out;
}

export interface AlertsTickReport {
  drivers: number;
  sent: number;
}

@Injectable()
export class AlertsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly profiles: DriverProfileService,
    private readonly outbox: NotificationsOutbox,
    private readonly inspections: InspectionsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async windows(): Promise<{ peakPeriods: GainWindow[]; peakZones: GainWindow[]; tolerance: number }> {
    const [periods, zones, tolerance] = await Promise.all([
      this.settings.get<unknown>('booster.peak_periods', DEFAULT_PEAK_PERIODS),
      this.settings.get<unknown>('booster.peak_zones', DEFAULT_PEAK_ZONES),
      this.settings.number('booster.alert_tolerance_minutes', 5),
    ]);
    return { peakPeriods: parseGainWindows(periods), peakZones: parseGainWindows(zones), tolerance };
  }

  private settingsOf(row: typeof schema.driverAlertSettings.$inferSelect | undefined): DriverAlertSettings {
    if (!row) return DEFAULT_ALERT_SETTINGS;
    return parseAlertSettings({ sessionStart: row.sessionStart, sessionEnd: row.sessionEnd, timeZone: row.timeZone, reminders: row.reminders, styles: row.styles });
  }

  private async view(driverId: string): Promise<DriverAlertSettingsView> {
    const [row] = await this.db.select().from(schema.driverAlertSettings).where(eq(schema.driverAlertSettings.driverId, driverId)).limit(1);
    const windows = await this.windows();
    return { ...this.settingsOf(row), peakPeriods: windows.peakPeriods, peakZones: windows.peakZones, sounds: [...ALERT_SOUNDS], updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  async get(userId: string): Promise<DriverAlertSettingsView> {
    return this.view((await this.profiles.requireDriver(userId)).id);
  }

  /** Fusion des réglages (une ligne par chauffeur, créée à la première modification). */
  async update(userId: string, body: DriverAlertSettingsUpdate): Promise<DriverAlertSettingsView> {
    const driver = await this.profiles.requireDriver(userId);
    const [existing] = await this.db.select().from(schema.driverAlertSettings).where(eq(schema.driverAlertSettings.driverId, driver.id)).limit(1);
    const current = this.settingsOf(existing);
    const next: DriverAlertSettings = {
      sessionStart: body.sessionStart ?? current.sessionStart,
      sessionEnd: body.sessionEnd ?? current.sessionEnd,
      timeZone: body.timeZone ?? current.timeZone,
      reminders: merge(current.reminders, body.reminders),
      styles: merge(current.styles, body.styles),
    };
    await this.db
      .insert(schema.driverAlertSettings)
      .values({ driverId: driver.id, sessionStart: next.sessionStart, sessionEnd: next.sessionEnd, timeZone: next.timeZone, reminders: next.reminders, styles: next.styles })
      .onConflictDoUpdate({ target: schema.driverAlertSettings.driverId, set: { sessionStart: next.sessionStart, sessionEnd: next.sessionEnd, timeZone: next.timeZone, reminders: next.reminders, styles: next.styles } });
    return this.view(driver.id);
  }

  /** Test du son et de la couleur d'un type : une notification push immédiate au chauffeur. */
  async test(userId: string, type: AlertType): Promise<{ queued: true }> {
    const driver = await this.profiles.requireDriver(userId);
    const [row] = await this.db.select().from(schema.driverAlertSettings).where(eq(schema.driverAlertSettings.driverId, driver.id)).limit(1);
    const style = this.settingsOf(row).styles[type];
    await this.outbox.queue({ recipientUserId: driver.userId, template: 'booster.alert_test', channel: 'push', organizationId: driver.organizationId, data: { alertType: type, color: style.color, ...pushStyle(style.sound) } });
    return { queued: true };
  }

  /**
   * Passe de la file `booster` : chaque chauffeur qui a des réglages (ligne) reçoit les alertes dues à cet instant,
   * une fois par jour chacune. La vérification sommaire n'est rappelée que sans rapport archivé du jour.
   */
  async tick(now = new Date()): Promise<AlertsTickReport> {
    const rows = await this.db
      .select({ settings: schema.driverAlertSettings, driver: { id: schema.drivers.id, userId: schema.drivers.userId, organizationId: schema.drivers.organizationId, status: schema.drivers.status } })
      .from(schema.driverAlertSettings)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverAlertSettings.driverId))
      .where(inArray(schema.drivers.status, ['active', 'restricted']));
    const windows = await this.windows();
    let sent = 0;
    for (const { settings: row, driver } of rows) {
      const settings = this.settingsOf(row);
      const sentMarkers = new Set(Array.isArray(row.sentMarkers) ? row.sentMarkers : []);
      let due = dueAlerts({ now, settings, peakPeriods: windows.peakPeriods, peakZones: windows.peakZones, hasInspectionToday: false, toleranceMinutes: windows.tolerance, sent: sentMarkers });
      if (due.some((d) => d.type === 'inspection')) {
        const local = localMoment(now, settings.timeZone);
        if (await this.inspections.hasArchivedOn(driver.id, local.date)) due = due.filter((d) => d.type !== 'inspection');
      }
      if (!due.length) continue;
      await this.outbox.queue(due.map((alert) => ({
        recipientUserId: driver.userId, template: `booster.${alert.type}`, channel: 'push' as const, organizationId: driver.organizationId,
        data: { alertType: alert.type, color: alert.style.color, ...pushStyle(alert.style.sound), ...(alert.window ? { labelFr: alert.window.label.fr, labelEn: alert.window.label.en, from: alert.window.from, to: alert.window.to, ...(alert.window.zone ? { zone: alert.window.zone } : {}) } : {}) },
      })));
      const local = localMoment(now, settings.timeZone);
      const yesterday = localMoment(new Date(now.getTime() - 86_400_000), settings.timeZone).date;
      const markers = pruneMarkers([...sentMarkers, ...due.map((d) => d.marker)], local.date, yesterday);
      await this.db.update(schema.driverAlertSettings).set({ sentMarkers: markers }).where(eq(schema.driverAlertSettings.driverId, driver.id));
      sent += due.length;
    }
    if (sent) this.logger.info({ drivers: rows.length, sent }, 'alertes Booster envoyées');
    return { drivers: rows.length, sent };
  }
}
