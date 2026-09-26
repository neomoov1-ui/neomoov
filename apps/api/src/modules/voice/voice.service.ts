/**
 * Agent vocal (prompt 13, tâche 10) : outils appelés par l'assistant Vapi pendant l'appel (prix, réservation, état,
 * annulation, transfert à un humain) et journal des appels. L'appelant est reconnu par son numéro (compte client) ;
 * sinon la réservation se fait sur une fiche minimale, payée au chauffeur, confirmée par texto. Chaque résultat est un
 * objet court que l'assistant reformule à voix haute, dans la langue de l'appelant.
 */
import { schema } from '@neomoov/db';
import { maskPhone, type Language, type QuotesResponse } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { MAPS_PROVIDER, type MapsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QuotesService } from '../pricing/quotes.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { RidesService } from '../rides/rides.service.js';

/** Message du serveur Vapi (sous-ensemble utilisé). */
export interface VapiMessage {
  type: string;
  call?: { id?: string; customer?: { number?: string } };
  toolCallList?: Array<{ id: string; function?: { name?: string; arguments?: Record<string, unknown> | string } }>;
  summary?: string;
  endedReason?: string;
  cost?: number;
  durationSeconds?: number;
}

export interface Caller {
  phone: string | null;
  userId: string | null;
  firstName: string | null;
  language: Language;
}

type ToolResult = Record<string, unknown> & { ok: boolean };

const OPEN_STATES = ['requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress'] as const;

function money(cents: number, language: Language): string {
  return new Intl.NumberFormat(language === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

@Injectable()
export class VoiceService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly quotes: QuotesService,
    private readonly rides: RidesService,
    private readonly outbox: NotificationsOutbox,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Traite un message du serveur Vapi : outils, rapport de fin d'appel ; les autres types sont simplement reçus. */
  async handle(message: VapiMessage): Promise<unknown> {
    if (message.type === 'tool-calls') {
      const caller = await this.caller(message.call?.customer?.number ?? null);
      const results = [];
      for (const call of message.toolCallList ?? []) {
        const args = typeof call.function?.arguments === 'string' ? (JSON.parse(call.function.arguments || '{}') as Record<string, unknown>) : (call.function?.arguments ?? {});
        const result = await this.runTool(call.function?.name ?? '', args, caller).catch((error: unknown) => this.failure(error, caller.language));
        results.push({ toolCallId: call.id, result: JSON.stringify(result) });
      }
      return { results };
    }
    if (message.type === 'end-of-call-report') await this.logCall(message);
    return { received: true };
  }

  async caller(phone: string | null): Promise<Caller> {
    if (!phone) return { phone: null, userId: null, firstName: null, language: 'fr' };
    const [user] = await this.db
      .select({ id: schema.users.id, firstName: schema.users.firstName, language: schema.users.language })
      .from(schema.users)
      .where(and(eq(schema.users.phone, phone), eq(schema.users.status, 'active')))
      .limit(1);
    return { phone, userId: user?.id ?? null, firstName: user?.firstName ?? null, language: user?.language === 'en' ? 'en' : 'fr' };
  }

  /** Outils de l'assistant ; le préfixe `voice.` du prompt 13 est accepté. */
  async runTool(name: string, args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
    switch (name.replace(/^voice\./, '')) {
      case 'quote':
        return this.quote(args, caller);
      case 'createRide':
        return this.createRide(args, caller);
      case 'rideStatus':
        return this.rideStatus(caller);
      case 'cancelRide':
        return this.cancelRide(args, caller);
      case 'transfer':
      case 'transferToHuman':
        return { ok: true, destination: await this.settings.string('voice.transfer_number', '+15145550100'), reason: typeof args['reason'] === 'string' ? args['reason'] : null };
      default:
        return { ok: false, reason: 'unknown_tool', message: `Outil inconnu : ${name}` };
    }
  }

  private failure(error: unknown, language: Language): ToolResult {
    const code = error instanceof AppError ? error.code : 'ERROR';
    const message = error instanceof AppError ? error.message : language === 'en' ? 'Something went wrong, a team member will call you back.' : 'Un incident est survenu, un membre de l\'équipe vous rappellera.';
    if (!(error instanceof AppError)) this.logger.error({ err: error }, 'Outil de l\'agent vocal en échec');
    return { ok: false, reason: code, message };
  }

  private text(args: Record<string, unknown>, key: string): string | null {
    const v = args[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  private async quote(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
    const pickup = this.text(args, 'pickupAddress');
    const dropoff = this.text(args, 'dropoffAddress');
    const pickupTime = this.text(args, 'pickupTime');
    if (!pickup || !dropoff || !pickupTime || Number.isNaN(Date.parse(pickupTime))) {
      return { ok: false, reason: 'missing_details', message: caller.language === 'en' ? 'I need the pickup address, the destination and the pickup time.' : 'Il me faut l\'adresse de départ, la destination et l\'heure de prise en charge.' };
    }
    const [origin, destination] = await Promise.all([this.maps.geocode(pickup), this.maps.geocode(dropoff)]);
    const category = this.text(args, 'category') ?? 'neo_premium';
    const response: QuotesResponse = await this.quotes.createQuotes(
      {
        category: category as never, stops: [], requestedAt: new Date(pickupTime).toISOString(), options: {} as never,
        origin: { address: origin.formattedAddress, coordinates: { lat: origin.lat, lng: origin.lng } },
        destination: { address: destination.formattedAddress, coordinates: { lat: destination.lat, lng: destination.lng } },
      },
      { userId: caller.userId, language: caller.language },
    );
    const q = response.quotes[0];
    if (!q) return { ok: false, reason: 'no_quote', message: caller.language === 'en' ? 'No vehicle is available for this trip.' : 'Aucun véhicule n\'est proposé pour ce trajet.' };
    return {
      ok: true, quoteId: q.id, category: q.category, totalCents: q.totalCents, total: money(q.totalCents, caller.language), pickupAt: new Date(pickupTime).toISOString(),
      pickupAddress: origin.formattedAddress, dropoffAddress: destination.formattedAddress, validUntil: q.validUntil,
    };
  }

  private async createRide(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
    const quoteId = this.text(args, 'quoteId');
    if (!quoteId) return { ok: false, reason: 'missing_quote', message: caller.language === 'en' ? 'Let me first give you a price.' : 'Je vous donne d\'abord le prix.' };
    if (!caller.phone) return { ok: false, reason: 'hidden_number', message: caller.language === 'en' ? 'Your number is hidden: I will transfer you to a team member.' : 'Votre numéro est masqué : je vous transfère à un membre de l\'équipe.' };
    const name = this.text(args, 'name') ?? caller.firstName;
    if (!caller.userId && !name) return { ok: false, reason: 'missing_name', message: caller.language === 'en' ? 'What name should the driver ask for?' : 'À quel nom le chauffeur doit-il se présenter ?' };
    const ride = await this.rides.createForVoiceCaller({
      quoteId, clientUserId: caller.userId, guest: caller.userId ? null : { name: name!, phone: caller.phone, language: caller.language }, specialRequests: this.text(args, 'notes'),
    });
    const [row] = await this.db.select({ publicNumber: schema.rides.publicNumber }).from(schema.rides).where(eq(schema.rides.id, ride.id)).limit(1);
    const publicNumber = row?.publicNumber ?? null;
    // Confirmation écrite par texto, compte ou non (l'appelant est au téléphone).
    await this.outbox.queue({
      recipientUserId: null, recipientAddress: caller.phone, channel: 'sms', language: caller.language, template: 'ride.voice_confirmation',
      data: { rideId: ride.id, publicNumber, requestedAt: ride.requestedAt, totalCents: ride.quote.totalCents },
    });
    return { ok: true, publicNumber, pickupAt: ride.requestedAt, total: money(ride.quote.totalCents, caller.language), payment: caller.language === 'en' ? 'Paid to the driver at the end of the ride.' : 'Payé au chauffeur à la fin de la course.' };
  }

  /** Courses de l'appelant qui ne sont ni terminées ni annulées (compte ou fiche minimale). */
  private async openRides(caller: Caller) {
    if (!caller.phone && !caller.userId) return [];
    const [client] = caller.userId ? await this.db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, caller.userId)).limit(1) : [];
    const owner = client ? eq(schema.rides.clientId, client.id) : eq(schema.rides.guestPhone, caller.phone!);
    return this.db
      .select({ id: schema.rides.id, publicNumber: schema.rides.publicNumber, state: schema.rides.state, requestedAt: schema.rides.requestedAt, driverId: schema.rides.driverId })
      .from(schema.rides)
      .where(and(client && caller.phone ? or(owner, eq(schema.rides.guestPhone, caller.phone)) : owner, inArray(schema.rides.state, [...OPEN_STATES])))
      .orderBy(desc(schema.rides.requestedAt))
      .limit(3);
  }

  private async rideStatus(caller: Caller): Promise<ToolResult> {
    const rides = await this.openRides(caller);
    if (!rides.length) return { ok: true, rides: [], message: caller.language === 'en' ? 'You have no upcoming ride.' : 'Vous n\'avez aucune course à venir.' };
    const out = [];
    for (const r of rides) {
      const [driver] = r.driverId
        ? await this.db
          .select({ firstName: schema.users.firstName, make: schema.vehicles.make, model: schema.vehicles.model, colour: schema.vehicles.colour })
          .from(schema.drivers)
          .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
          .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.currentVehicleId))
          .where(eq(schema.drivers.id, r.driverId))
          .limit(1)
        : [];
      out.push({ publicNumber: r.publicNumber, state: r.state, pickupAt: r.requestedAt?.toISOString() ?? null, driver: driver ? { firstName: driver.firstName, vehicle: [driver.make, driver.model, driver.colour].filter(Boolean).join(' ') } : null });
    }
    return { ok: true, rides: out };
  }

  private async cancelRide(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
    const rides = await this.openRides(caller);
    const wanted = this.text(args, 'publicNumber');
    const ride = wanted ? rides.find((r) => r.publicNumber === wanted) : rides.length === 1 ? rides[0] : undefined;
    if (!ride) return { ok: false, reason: rides.length ? 'which_ride' : 'no_ride', rides: rides.map((r) => r.publicNumber), message: caller.language === 'en' ? 'Which ride should I cancel?' : 'Quelle course dois-je annuler ?' };
    const result = await this.rides.cancelForVoiceCaller(ride.id, { clientUserId: caller.userId }, 'Annulation par téléphone (agent vocal)');
    return { ok: true, publicNumber: ride.publicNumber, feeCents: result.feeCents, fee: money(result.feeCents, caller.language) };
  }

  /** Journal de l'appel : exécution de l'agent `voice_call_center` (numéro masqué, résumé, durée, coût). */
  private async logCall(message: VapiMessage): Promise<void> {
    const callId = message.call?.id ?? null;
    if (callId) {
      const [already] = await this.db.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'voice_call_center'), eq(schema.agentRuns.triggerRef, callId))).limit(1);
      if (already) return;
    }
    const durationMs = typeof message.durationSeconds === 'number' ? Math.round(message.durationSeconds * 1000) : null;
    await this.db.insert(schema.agentRuns).values({
      agentCode: 'voice_call_center', trigger: 'call', triggerRef: callId,
      input: { caller: maskPhone(message.call?.customer?.number ?? null) },
      output: { summary: message.summary ?? null, endedReason: message.endedReason ?? null },
      costMicros: typeof message.cost === 'number' ? Math.round(message.cost * 1_000_000) : 0, durationMs, status: 'succeeded', finishedAt: new Date(),
    });
  }
}
