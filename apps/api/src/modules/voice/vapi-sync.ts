/**
 * Synchronisation des assistants Neomoov chez Vapi (script `vapi:setup`) : chaque assistant est retrouvé par son nom
 * puis mis à jour, ou créé ; le numéro importé de Twilio reçoit l'assistant d'accueil pour les appels entrants.
 * Rejouable : relancer le script réapplique la configuration sans doublon. Aucun secret dans le rapport.
 */
import type { VapiAdminClient, VapiPhoneNumberSummary } from '../../adapters/real/vapi-admin.js';
import { INBOUND_ASSISTANT_NAME, SOS_ASSISTANT_NAME, inboundAssistant, sosAssistant, type AssistantBuildOptions } from './vapi-assistants.js';

export interface VapiSyncReport {
  inbound: { id: string; action: 'created' | 'updated' };
  sos: { id: string; action: 'created' | 'updated' };
  phoneNumber: { id: string; number: string | null; action: 'assigned' | 'already' } | null;
  /** Numéros vus chez Vapi quand aucun ne correspond (aide au diagnostic : identifiants et numéros, pas de secret). */
  candidates: Array<{ id: string; number: string | null }>;
}

export interface VapiSyncInput extends AssistantBuildOptions {
  /** `VAPI_PHONE_NUMBER_ID` s'il est connu. */
  phoneNumberId: string | null;
  /** `TWILIO_FROM_NUMBER` : retrouve le numéro importé quand l'identifiant n'est pas encore dans `.env`. */
  fromNumber: string | null;
}

async function upsert(client: VapiAdminClient, name: string, body: Record<string, unknown>, existing: Array<{ id: string; name?: string | null }>) {
  const found = existing.find((a) => a.name === name);
  if (found) {
    await client.updateAssistant(found.id, body);
    return { id: found.id, action: 'updated' as const };
  }
  const created = await client.createAssistant(body);
  return { id: created.id, action: 'created' as const };
}

/** Numéro importé visé : par identifiant, sinon par le numéro de Twilio (formats `+1…` comparés sans espaces). */
export function pickPhoneNumber(numbers: VapiPhoneNumberSummary[], input: Pick<VapiSyncInput, 'phoneNumberId' | 'fromNumber'>): VapiPhoneNumberSummary | null {
  if (input.phoneNumberId) return numbers.find((n) => n.id === input.phoneNumberId) ?? null;
  const wanted = input.fromNumber?.replace(/[^\d+]/g, '');
  if (!wanted) return null;
  return numbers.find((n) => (n.number ?? '').replace(/[^\d+]/g, '') === wanted) ?? null;
}

export async function syncVapi(client: VapiAdminClient, input: VapiSyncInput): Promise<VapiSyncReport> {
  const existing = await client.listAssistants();
  const inbound = await upsert(client, INBOUND_ASSISTANT_NAME, inboundAssistant(input), existing);
  const sos = await upsert(client, SOS_ASSISTANT_NAME, sosAssistant(input), existing);
  const numbers = await client.listPhoneNumbers();
  const target = pickPhoneNumber(numbers, input);
  let phoneNumber: VapiSyncReport['phoneNumber'] = null;
  if (target) {
    if (target.assistantId === inbound.id) {
      phoneNumber = { id: target.id, number: target.number ?? null, action: 'already' };
    } else {
      await client.updatePhoneNumber(target.id, { assistantId: inbound.id, name: 'Neomoov' });
      phoneNumber = { id: target.id, number: target.number ?? null, action: 'assigned' };
    }
  }
  return { inbound, sos, phoneNumber, candidates: target ? [] : numbers.map((n) => ({ id: n.id, number: n.number ?? null })) };
}
