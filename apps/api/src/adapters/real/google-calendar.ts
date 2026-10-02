/**
 * Agenda du fondateur par l'API Google Calendar v3 (phase 1 « entreprise autonome ») : un client OAuth « application
 * installée » et un jeton de rafraîchissement obtenu une fois (docs/sales/prospection.md), échangé contre un jeton
 * d'accès à chaque appel (mis en cache jusqu'à son expiration). Aucun SDK : appels REST avec délai d'attente.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CalendarEventInput, CalendarProvider } from '../types.js';

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Identifiant de l'agenda (courriel du fondateur ou `primary`). */
  calendarId: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google-calendar';
  readonly #config: GoogleCalendarConfig;
  #accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    config: GoogleCalendarConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {
    this.#config = config;
  }

  toJSON() {
    return { name: this.name, configured: true, calendarId: this.#config.calendarId };
  }

  private async accessToken(): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now() + 30_000) return this.#accessToken.value;
    const form = new URLSearchParams({ client_id: this.#config.clientId, client_secret: this.#config.clientSecret, refresh_token: this.#config.refreshToken, grant_type: 'refresh_token' });
    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(this.timeoutMs) });
    const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !json.access_token) throw new AppError('CALENDAR_AUTH_FAILED', `Google Calendar : jeton refusé (${json.error ?? `HTTP ${response.status}`})`, HttpStatus.BAD_GATEWAY);
    this.#accessToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3_600) * 1_000 };
    return json.access_token;
  }

  async createEvent(input: CalendarEventInput): Promise<{ eventId: string; htmlLink: string | null }> {
    const token = await this.accessToken();
    const timeZone = input.timeZone ?? 'America/Toronto';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.#config.calendarId)}/events?sendUpdates=all`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.startsAt.toISOString(), timeZone },
        end: { dateTime: input.endsAt.toISOString(), timeZone },
        ...(input.attendees?.length ? { attendees: input.attendees.map((a) => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) })) } : {}),
        reminders: { useDefault: true },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = (await response.json().catch(() => ({}))) as { id?: string; htmlLink?: string; error?: { message?: string } };
    if (!response.ok || !json.id) throw new AppError('CALENDAR_EVENT_FAILED', `Google Calendar : ${json.error?.message ?? `HTTP ${response.status}`}`, HttpStatus.BAD_GATEWAY);
    return { eventId: json.id, htmlLink: json.htmlLink ?? null };
  }
}
