import { describe, expect, it } from 'vitest';
import { VapiAdminClient } from '../src/adapters/real/vapi-admin.js';
import { VapiVoiceProvider } from '../src/adapters/real/vapi.js';
import { INBOUND_ASSISTANT_NAME, SALES_ASSISTANT_NAME, SOS_ASSISTANT_NAME, inboundAssistant, redactAssistant, salesAssistant, sosAssistant, voiceTools } from '../src/modules/voice/vapi-assistants.js';
import { describeMeetingHours } from '../src/modules/sales/outbound-calls.service.js';
import { parseBusinessHours } from '@neomoov/domain';
import { pickPhoneNumber, syncVapi } from '../src/modules/voice/vapi-sync.js';

interface Recorded {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** Faux Vapi : répond selon la méthode et la fin du chemin, enregistre chaque requête. */
function fakeVapi(state: { assistants: Array<{ id: string; name: string }>; numbers: Array<{ id: string; number: string; assistantId?: string | null }> }, options: { reject?: boolean } = {}) {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (options.reject) return json({ message: ['model.model must be one of the following values: claude-sonnet-5'], error: 'Bad Request', statusCode: 400 }, 400);
    if (method === 'GET' && url.includes('/assistant')) return json(state.assistants);
    if (method === 'POST' && url.endsWith('/assistant')) {
      const created = { id: `asst_${state.assistants.length + 1}`, name: String(body?.['name']) };
      state.assistants.push(created);
      return json(created, 201);
    }
    if (method === 'PATCH' && url.includes('/assistant/')) return json({ id: url.split('/').pop(), name: body?.['name'] });
    if (method === 'GET' && url.includes('/phone-number')) return json(state.numbers);
    if (method === 'PATCH' && url.includes('/phone-number/')) {
      const target = state.numbers.find((n) => url.endsWith(n.id));
      if (target) target.assistantId = String(body?.['assistantId']);
      return json(target ?? {});
    }
    return json({ message: ['model.model must be one of the following values: claude-sonnet-5'], error: 'Bad Request', statusCode: 400 }, 400);
  }) as typeof fetch;
  return { calls, impl };
}

const options = { apiBaseUrl: 'https://api.neomoov.net/', webhookSecret: 'secret-webhook-123', phoneNumberId: null, fromNumber: '+1 514 555-0100' };

describe('agent vocal Vapi : définition des assistants et mise en place', () => {
  it('assistant d\'accueil : cinq outils, webhook avec secret en en-tête, transcription bilingue, aucun enregistrement', () => {
    const body = inboundAssistant(options);
    expect(body['name']).toBe(INBOUND_ASSISTANT_NAME);
    const model = body['model'] as { provider: string; tools: Array<{ type: string; function: { name: string } }> };
    expect(model.provider).toBe('anthropic');
    expect(model.tools.map((t) => t.function.name)).toEqual(['quote', 'createRide', 'rideStatus', 'cancelRide', 'transferToHuman']);
    expect(model.tools.at(-1)).toMatchObject({ type: 'transferCall' });
    expect(model.tools.at(-1)).not.toHaveProperty('destinations');
    expect(body['server']).toEqual({ url: 'https://api.neomoov.net/v1/webhooks/vapi', timeoutSeconds: 20, headers: { 'x-vapi-secret': 'secret-webhook-123' } });
    expect(body['serverMessages']).toEqual(['tool-calls', 'end-of-call-report', 'transfer-destination-request']);
    expect(body['transcriber']).toEqual({ provider: 'deepgram', model: 'nova-3', language: 'multi' });
    expect(body['artifactPlan']).toEqual({ recordingEnabled: false });
    expect(String((model as unknown as { messages: Array<{ content: string }> }).messages[0]!.content)).toContain('2 heures');

    // Transfert fixe : la destination est dans l'outil.
    const fixed = voiceTools({ staticTransferNumber: '+15145550142' }).at(-1) as { destinations: Array<{ number: string }> };
    expect(fixed.destinations[0]!.number).toBe('+15145550142');

    // Le secret n'apparaît jamais dans l'affichage de simulation.
    const shown = JSON.stringify(redactAssistant(body));
    expect(shown).not.toContain('secret-webhook-123');
    expect(shown).toContain('"x-vapi-secret":"***"');
    expect(JSON.stringify(body)).toContain('secret-webhook-123');
  });

  it('assistant SOS : premier message avec le numéro public de la course, sans outil, message vocal', () => {
    const body = sosAssistant({ ...options, webhookSecret: null });
    expect(body['name']).toBe(SOS_ASSISTANT_NAME);
    expect(String(body['firstMessage'])).toContain('{{publicNumber}}');
    expect(body['voicemailMessage']).toBe(body['firstMessage']);
    expect((body['model'] as Record<string, unknown>)['tools']).toBeUndefined();
    expect(body['server']).toEqual({ url: 'https://api.neomoov.net/v1/webhooks/vapi', timeoutSeconds: 20 });
    expect(body['maxDurationSeconds']).toBe(180);
  });

  it('assistant commercial : script validé, variables de l\'appel, rapport de fin d\'appel avec données structurées', () => {
    const body = salesAssistant({ ...options, webhookSecret: null });
    expect(body['name']).toBe(SALES_ASSISTANT_NAME);
    expect(String(body['firstMessage'])).toContain('{{organizationName}}');
    const system = JSON.stringify(body['model']);
    for (const v of ['{{meetingHost}}', '{{meetingHours}}', '{{language}}', '{{recording}}', '{{contactName}}']) expect(system).toContain(v);
    expect((body['model'] as Record<string, unknown>)['tools']).toBeUndefined();
    expect(body['serverMessages']).toEqual(['end-of-call-report']);
    const plan = body['analysisPlan'] as { structuredDataPlan: { enabled: boolean; schema: { properties: Record<string, unknown>; required: string[] } } };
    expect(plan.structuredDataPlan.enabled).toBe(true);
    expect(Object.keys(plan.structuredDataPlan.schema.properties)).toEqual(['result', 'meetingAt', 'callbackAt', 'recordingConsent']);
    expect(plan.structuredDataPlan.schema.required).toEqual(['result']);
    // Plages des rendez-vous dites à voix haute (décision du fondateur : lundi au samedi, 9 h à 17 h).
    expect(describeMeetingHours(parseBusinessHours({ days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00' }))).toBe('du lundi au samedi, de 9 h à 17 h');
    expect(describeMeetingHours(parseBusinessHours({ days: [2, 4], from: '09:30', to: '12:00' }))).toBe('les mardi, jeudi, de 9 h 30 à 12 h');
    expect(describeMeetingHours(parseBusinessHours({ days: [6, 0], from: '10:00', to: '14:00' }))).toBe('du samedi au dimanche, de 10 h à 14 h');
  });

  it('mise en place rejouable : création puis mise à jour par nom, numéro importé retrouvé par le numéro Twilio', async () => {
    const state = { assistants: [] as Array<{ id: string; name: string }>, numbers: [{ id: 'pn_1', number: '+15145550100', assistantId: null }, { id: 'pn_2', number: '+13677639063' }] };
    const { calls, impl } = fakeVapi(state);
    const client = new VapiAdminClient('cle-privee', impl);
    expect(JSON.stringify(client)).not.toContain('cle-privee');

    const first = await syncVapi(client, options);
    expect(first).toEqual({ inbound: { id: 'asst_1', action: 'created' }, sos: { id: 'asst_2', action: 'created' }, sales: { id: 'asst_3', action: 'created' }, phoneNumber: { id: 'pn_1', number: '+15145550100', action: 'assigned' }, candidates: [] });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3);
    expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/phone-number/pn_1'))?.body).toEqual({ assistantId: 'asst_1', name: 'Neomoov' });
    expect(calls.every((c) => c.url.startsWith('https://api.vapi.ai/'))).toBe(true);

    const second = await syncVapi(client, options);
    expect(second).toEqual({ inbound: { id: 'asst_1', action: 'updated' }, sos: { id: 'asst_2', action: 'updated' }, sales: { id: 'asst_3', action: 'updated' }, phoneNumber: { id: 'pn_1', number: '+15145550100', action: 'already' }, candidates: [] });
    expect(state.assistants).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'PATCH' && c.url.includes('/assistant/'))).toHaveLength(3);

    // Identifiant connu : il prime sur le numéro ; inconnu : rien n'est rattaché, les candidats sont listés.
    expect(pickPhoneNumber(state.numbers, { phoneNumberId: 'pn_2', fromNumber: '+15145550100' })?.id).toBe('pn_2');
    const none = await syncVapi(client, { ...options, fromNumber: '+15145550199' });
    expect(none.phoneNumber).toBeNull();
    expect(none.candidates).toEqual([{ id: 'pn_1', number: '+15145550100' }, { id: 'pn_2', number: '+13677639063' }]);
  });

  it('refus de Vapi : erreur typée avec le message de validation ; appel sortant avec variables de l\'assistant', async () => {
    const { impl } = fakeVapi({ assistants: [], numbers: [] }, { reject: true });
    const client = new VapiAdminClient('cle-privee', impl);
    await expect(client.createAssistant({ name: 'x' })).rejects.toMatchObject({ code: 'VAPI_REQUEST_FAILED', details: { status: 400, message: 'model.model must be one of the following values: claude-sonnet-5' } });

    const sent: Array<Record<string, unknown>> = [];
    const voice = new VapiVoiceProvider('cle', 'secret', 'pn_1', (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'call_1' }), { status: 201 });
    }) as typeof fetch);
    expect(await voice.startOutboundCall({ to: '+15145550199', assistantId: 'asst_2', metadata: { rideId: 'r1', incidentId: 'i1' }, variables: { publicNumber: 'NM-0001', incidentId: 'i1' } })).toEqual({ callId: 'call_1' });
    expect(sent[0]).toEqual({ assistantId: 'asst_2', phoneNumberId: 'pn_1', customer: { number: '+15145550199' }, metadata: { rideId: 'r1', incidentId: 'i1' }, assistantOverrides: { variableValues: { publicNumber: 'NM-0001', incidentId: 'i1' } } });
  });
});
