import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MockCrmProvider } from '../src/adapters/mock/crm.mock.js';
import { HUBSPOT_PIPELINES, HUBSPOT_PROPERTIES, assertCrmPropertiesMinimal, companyProperties, contactProperties, dealProperties } from '../src/adapters/real/hubspot-model.js';
import { HubSpotCrmProvider, existingIdOf, pipelineLimitReached } from '../src/adapters/real/hubspot.real.js';
import { realCrm } from '../src/adapters/real/index.js';
import { requireCrmConsent, type CrmConsent, type CrmContactInput } from '../src/adapters/types.js';
import { loadEnv } from '../src/config/env.js';

/** Étape 25 : adaptateurs CRM (simulé et HubSpot sur un faux serveur), modèle de données, minimisation, mise en place. */
const given: CrmConsent = { given: true, at: new Date('2026-09-30T12:00:00Z'), source: 'form' };
const refused: CrmConsent = { given: false, at: null, source: 'form' };
const contact = (platformId = 'lead:1', extra: Partial<CrmContactInput> = {}): CrmContactInput => ({
  platformId, email: 'ana@exemple.ca', phone: '+15145550100', firstName: 'Ana', lastName: 'Roy', language: 'fr', city: 'Laval', entity: 'neomoov', source: 'web', consent: given, leadKind: 'driver', driverStatus: 'candidate', ...extra,
});

interface Route {
  match: RegExp;
  method?: string;
  status?: number;
  body?: unknown | ((request: unknown) => unknown);
  headers?: Record<string, string>;
  once?: boolean;
}

/** Faux HubSpot : enregistre chaque requête et répond selon la première route qui correspond (404 sinon). */
function fakeHubSpot(routes: Route[]) {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | undefined; headers: Record<string, string> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input).replace('https://api.hubapi.com', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method, path, body, headers: { ...(init?.headers as Record<string, string>) } });
    const index = routes.findIndex((r) => r.match.test(path) && (!r.method || r.method === method));
    const route = index >= 0 ? routes[index] : undefined;
    if (route?.once) routes.splice(index, 1);
    const status = route?.status ?? (route ? 200 : 404);
    const payload = route ? (typeof route.body === 'function' ? (route.body as (r: unknown) => unknown)(body) : (route.body ?? {})) : { status: 'error', message: 'resource not found', category: 'OBJECT_NOT_FOUND' };
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...(route?.headers ?? {}) } });
  };
  return { requests, fetchImpl };
}

const PIPELINES = {
  results: [
    { id: 'p1', label: 'Ventes B2B', stages: [{ id: 's1', label: 'Nouveau prospect', metadata: { probability: '0.1' } }, { id: 's5', label: 'Client actif', metadata: { probability: '1.0' } }] },
    { id: 'p2', label: 'Formation chauffeurs', stages: [{ id: 't1', label: 'Candidature reçue', metadata: { probability: '0.1' } }] },
  ],
};

describe('CRM simulé', () => {
  it('refuse sans consentement, est idempotent par identifiant Neomoov, et simule une panne', async () => {
    const crm = new MockCrmProvider();
    await expect(crm.upsertContact(contact('lead:x', { consent: refused }))).rejects.toMatchObject({ code: 'CRM_CONSENT_REQUIRED', status: 422 });
    expect(() => requireCrmConsent(refused)).toThrow(/consentement/);
    expect(crm.contacts.size).toBe(0);
    const first = await crm.upsertContact(contact());
    const again = await crm.upsertContact(contact('lead:1', { firstName: 'Anna' }));
    expect(again).toEqual({ id: first.id, created: false });
    expect(crm.contact('lead:1')?.firstName).toBe('Anna');
    const deal = await crm.upsertDeal({ platformId: 'lead:1', name: 'Candidature', pipeline: 'training', stage: 'candidate', contactExternalId: first.id, entity: 'neomoov', source: 'web', consent: given });
    expect(deal.created).toBe(true);
    await expect(crm.addNote({ body: 'x', consent: given })).rejects.toMatchObject({ code: 'CRM_NOTE_WITHOUT_TARGET' });
    crm.unavailable = true;
    await expect(crm.upsertCompany({ platformId: 'organization:1', name: 'Flotte', accountType: 'organization', entity: 'neomoov', source: 'platform', consent: { ...given, source: 'contract' } })).rejects.toMatchObject({ code: 'CRM_PROVIDER_ERROR', status: 502 });
    crm.reset();
    expect(crm.calls).toHaveLength(0);
  });
});

describe('modèle HubSpot', () => {
  it('refuse toute propriété de trajet, d\'adresse ou de paiement, et ne transmet que les champs permis', () => {
    expect(() => assertCrmPropertiesMinimal({ address: '1 rue X' })).toThrow(/interdites/);
    expect(() => assertCrmPropertiesMinimal({ ride_id: 'r', email: 'a' })).toThrow(/ride_id/);
    expect(() => assertCrmPropertiesMinimal({ pickup_lat: '45' })).toThrow();
    expect(() => assertCrmPropertiesMinimal({ card_last4: '4242' })).toThrow();
    expect(() => assertCrmPropertiesMinimal({ city: 'Laval', email: 'a', neomoov_platform_id: 'x', neomoov_consent_at: 'd' })).not.toThrow();
    const props = contactProperties(contact());
    expect(props).toEqual({
      neomoov_platform_id: 'lead:1', neomoov_entity: 'neomoov', neomoov_source: 'web', neomoov_consent_source: 'form', neomoov_consent_at: '2026-09-30T12:00:00.000Z',
      email: 'ana@exemple.ca', phone: '+15145550100', firstname: 'Ana', lastname: 'Roy', city: 'Laval', neomoov_language: 'fr', neomoov_lead_kind: 'driver', neomoov_driver_status: 'candidate',
    });
    expect(companyProperties({ platformId: 'organization:1', name: 'Flotte Nord', legalName: 'Flotte Nord inc.', accountType: 'organization', organizationType: 'fleet', planCode: null, entity: 'neomoov', source: 'platform', consent: { ...given, source: 'contract' } })).toMatchObject({ name: 'Flotte Nord', neomoov_legal_name: 'Flotte Nord inc.', neomoov_plan: 'none', neomoov_organization_type: 'fleet' });
    expect(dealProperties({ platformId: 'organization:1', name: 'Organisation : Flotte Nord', pipeline: 'b2b', stage: 'active', amountCents: 19_900, entity: 'neomoov', source: 'platform', consent: given }, 'p1', 's5')).toMatchObject({ pipeline: 'p1', dealstage: 's5', amount: '199.00', neomoov_track: 'b2b' });
    // Le modèle lui-même ne contient aucun nom interdit.
    for (const defs of Object.values(HUBSPOT_PROPERTIES)) expect(() => assertCrmPropertiesMinimal(Object.fromEntries(defs.map((d) => [d.name, ''])))).not.toThrow();
    expect(HUBSPOT_PIPELINES.map((p) => p.label)).toEqual(['Ventes B2B', 'Formation chauffeurs']);
  });
});

describe('adaptateur HubSpot (faux serveur)', () => {
  it('crée ou met à jour par l\'identifiant Neomoov, met à jour un contact existant par courriel, n\'expose jamais le jeton', async () => {
    const created = fakeHubSpot([{ match: /\/crm\/v3\/objects\/contacts\/batch\/upsert$/, method: 'POST', body: { results: [{ id: '101', new: true }] } }]);
    const provider = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: created.fetchImpl, portalId: '12345' });
    expect(await provider.upsertContact(contact())).toEqual({ id: '101', created: true });
    expect(created.requests[0]).toMatchObject({ method: 'POST', path: '/crm/v3/objects/contacts/batch/upsert' });
    expect(created.requests[0]!.headers['authorization']).toBe('Bearer pat-test-secret');
    expect(created.requests[0]!.body).toMatchObject({ inputs: [{ idProperty: 'neomoov_platform_id', id: 'lead:1', properties: { email: 'ana@exemple.ca', neomoov_lead_kind: 'driver' } }] });
    // Un contact porte déjà ce courriel : HubSpot refuse la création, l'adaptateur met la fiche existante à jour.
    const conflict = fakeHubSpot([
      { match: /batch\/upsert$/, method: 'POST', status: 409, body: { status: 'error', message: 'Contact already exists. Existing ID: 777', category: 'CONFLICT' } },
      { match: /\/crm\/v3\/objects\/contacts\/777$/, method: 'PATCH', body: { id: '777' } },
    ]);
    const second = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: conflict.fetchImpl });
    expect(await second.upsertContact(contact())).toEqual({ id: '777', created: false });
    expect(conflict.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /crm/v3/objects/contacts/batch/upsert', 'PATCH /crm/v3/objects/contacts/777']);
    // Identifiant déjà connu : mise à jour directe, sans passer par l'upsert.
    const known = fakeHubSpot([{ match: /\/crm\/v3\/objects\/contacts\/555$/, method: 'PATCH', body: { id: '555' } }]);
    const third = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: known.fetchImpl });
    expect(await third.upsertContact(contact('lead:1', { externalId: '555' }))).toEqual({ id: '555', created: false });
    expect(known.requests).toHaveLength(1);
    await expect(third.upsertContact(contact('lead:2', { consent: refused }))).rejects.toMatchObject({ code: 'CRM_CONSENT_REQUIRED' });
    expect(known.requests).toHaveLength(1);
    expect(JSON.stringify(provider)).not.toContain('pat-test-secret');
    expect(inspect(provider, { depth: 5, showHidden: true })).not.toContain('pat-test-secret');
    expect(JSON.parse(JSON.stringify(provider))).toEqual({ name: 'hubspot', configured: true, portalId: '12345' });
    expect(existingIdOf(new Error('x'))).toBeNull();
  });

  it('place la transaction dans le bon pipeline et la bonne étape, l\'associe au contact, et exige crm:setup si l\'étape manque', async () => {
    const server = fakeHubSpot([
      { match: /\/crm\/v3\/pipelines\/deals$/, method: 'GET', body: PIPELINES },
      { match: /\/crm\/v3\/objects\/deals\/batch\/upsert$/, method: 'POST', body: { results: [{ id: 'd1', new: true }] } },
      { match: /\/crm\/v4\/objects\/deals\/d1\/associations\/default\//, method: 'PUT', body: {} },
      { match: /\/crm\/v3\/objects\/notes$/, method: 'POST', body: { id: 'n1' } },
    ]);
    const provider = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: server.fetchImpl });
    const deal = await provider.upsertDeal({ platformId: 'lead:1', name: 'Entreprise : Ana Roy', pipeline: 'b2b', stage: 'new', contactExternalId: '101', entity: 'neomoov', source: 'web', consent: given });
    expect(deal).toEqual({ id: 'd1', created: true });
    const upsert = server.requests.find((r) => r.path.endsWith('/deals/batch/upsert'))!;
    expect(upsert.body).toMatchObject({ inputs: [{ id: 'lead:1', properties: { pipeline: 'p1', dealstage: 's1', neomoov_track: 'b2b', dealname: 'Entreprise : Ana Roy' } }] });
    expect(server.requests.some((r) => r.method === 'PUT' && r.path === '/crm/v4/objects/deals/d1/associations/default/contacts/101')).toBe(true);
    // Les pipelines sont lus une fois (cache) ; une étape absente est une erreur claire, après relecture.
    const before = server.requests.filter((r) => r.path === '/crm/v3/pipelines/deals').length;
    await expect(provider.upsertDeal({ platformId: 'lead:2', name: 'x', pipeline: 'b2b', stage: 'trial', entity: 'neomoov', source: 'web', consent: given })).rejects.toMatchObject({ code: 'CRM_PIPELINE_MISSING' });
    expect(server.requests.filter((r) => r.path === '/crm/v3/pipelines/deals').length).toBe(before + 1);
    expect(await provider.addNote({ body: 'Bonjour', contactExternalId: '101', dealExternalId: 'd1', consent: given })).toEqual({ id: 'n1' });
    const note = server.requests.find((r) => r.path.endsWith('/notes'))!;
    expect(note.body).toMatchObject({ properties: { hs_note_body: 'Bonjour' }, associations: [{ to: { id: '101' }, types: [{ associationTypeId: 202 }] }, { to: { id: 'd1' }, types: [{ associationTypeId: 214 }] }] });
    // Formule gratuite : un seul pipeline « Neomoov » qui porte les étapes des deux parcours.
    const single = fakeHubSpot([
      { match: /\/crm\/v3\/pipelines\/deals$/, method: 'GET', body: { results: [{ id: 'default', label: 'Neomoov', stages: [{ id: 'c1', label: 'Candidature reçue', metadata: { probability: '0.1' } }] }] } },
    ]);
    const free = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: single.fetchImpl });
    expect(await free.resolveStage('training', 'candidate')).toEqual({ pipelineId: 'default', stageId: 'c1' });
  });

  it('réessaie après un 429, et rend les erreurs du fournisseur en 502 typé', async () => {
    const server = fakeHubSpot([
      { match: /batch\/upsert$/, method: 'POST', status: 429, body: { message: 'rate limit' }, headers: { 'retry-after': '1' }, once: true },
      { match: /batch\/upsert$/, method: 'POST', body: { results: [{ id: '9', new: false }] } },
    ]);
    const provider = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: server.fetchImpl });
    expect(await provider.upsertCompany({ platformId: 'organization:1', name: 'Flotte', accountType: 'organization', entity: 'neomoov', source: 'platform', consent: { ...given, source: 'contract' } })).toEqual({ id: '9', created: false });
    expect(server.requests).toHaveLength(2);
    const down = fakeHubSpot([{ match: /batch\/upsert$/, method: 'POST', status: 500, body: { message: 'internal error', category: 'INTERNAL' } }]);
    const broken = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: down.fetchImpl });
    await expect(broken.upsertContact(contact())).rejects.toMatchObject({ code: 'CRM_PROVIDER_ERROR', status: 502, details: { status: 500, category: 'INTERNAL' } });
    expect(pipelineLimitReached({ code: 'x' })).toBe(false);
  }, 15_000);

  it('crm:setup crée ce qui manque, complète les options, laisse le reste, et vit avec un seul pipeline (formule gratuite)', async () => {
    const entityDef = HUBSPOT_PROPERTIES.contacts.find((d) => d.name === 'neomoov_entity')!;
    const planDef = HUBSPOT_PROPERTIES.companies.find((d) => d.name === 'neomoov_plan')!;
    const server = fakeHubSpot([
      { match: /\/crm\/v3\/properties\/contacts\/groups\/neomoov$/, method: 'GET', body: { name: 'neomoov' } },
      { match: /\/crm\/v3\/properties\/[a-z]+\/groups$/, method: 'POST', body: {} },
      { match: /\/crm\/v3\/properties\/contacts\/neomoov_entity$/, method: 'GET', body: { label: entityDef.label, description: entityDef.description, type: 'enumeration', options: [{ label: 'Neomoov', value: 'neomoov' }] } },
      { match: /\/crm\/v3\/properties\/companies\/neomoov_plan$/, method: 'GET', body: { label: planDef.label, description: planDef.description, type: 'enumeration', options: planDef.options } },
      { match: /\/crm\/v3\/properties\/deals\/neomoov_source$/, method: 'GET', body: { label: 'Autre libellé', description: 'x', type: 'string' } },
      { match: /\/crm\/v3\/properties\/contacts\/neomoov_language$/, method: 'GET', body: { label: 'Langue', type: 'string' } },
      { match: /\/crm\/v3\/properties\/[a-z]+\/[a-z_]+$/, method: 'PATCH', body: {} },
      { match: /\/crm\/v3\/properties\/[a-z]+$/, method: 'POST', body: {} },
      { match: /\/crm\/v3\/pipelines\/deals$/, method: 'GET', body: { results: [{ id: 'default', label: 'Sales Pipeline', stages: [{ id: 'a', label: 'Appointment scheduled', metadata: { probability: '0.2' } }] }] } },
      { match: /\/crm\/v3\/pipelines\/deals$/, method: 'POST', status: 403, body: { message: 'Your account has reached its pipeline limit', category: 'FORBIDDEN' } },
      { match: /\/crm\/v3\/pipelines\/deals\/default$/, method: 'PATCH', body: {} },
      { match: /\/crm\/v3\/pipelines\/deals\/default\/stages$/, method: 'POST', body: (b: unknown) => ({ id: `st-${(b as { label: string }).label}`, label: (b as { label: string }).label, metadata: (b as { metadata: unknown }).metadata }) },
    ]);
    const provider = new HubSpotCrmProvider('pat-test-secret', { fetchImpl: server.fetchImpl });
    const report = await provider.setup();
    const of = (kind: string, name: string, objectType?: string) => report.find((l) => l.kind === kind && l.name === name && (!objectType || l.objectType === objectType))!;
    expect(of('group', 'neomoov').action).toBe('unchanged');
    expect(report.filter((l) => l.kind === 'group' && l.action === 'created')).toHaveLength(2);
    expect(of('property', 'neomoov_entity')).toMatchObject({ action: 'updated', detail: expect.stringContaining('groupe_nsk') });
    expect(of('property', 'neomoov_plan').action).toBe('unchanged');
    expect(of('property', 'neomoov_source', 'deals').action).toBe('updated');
    expect(of('property', 'neomoov_source', 'contacts').action).toBe('created');
    expect(of('property', 'neomoov_language').action).toBe('skipped');
    const patched = server.requests.find((r) => r.method === 'PATCH' && r.path.endsWith('/contacts/neomoov_entity'))!;
    expect((patched.body as { options: Array<{ value: string }> }).options.map((o) => o.value)).toEqual(['neomoov', 'groupe_nsk']);
    const createdProperties = report.filter((l) => l.kind === 'property' && l.action === 'created').length;
    expect(createdProperties).toBe(Object.values(HUBSPOT_PROPERTIES).reduce((n, defs) => n + defs.length, 0) - 4);
    // Un seul pipeline permis : renommé « Neomoov », il reçoit les étapes des deux parcours ; rien n'est détruit.
    expect(report.filter((l) => l.kind === 'pipeline' && l.action === 'skipped').map((l) => l.name)).toEqual(['Ventes B2B', 'Formation chauffeurs']);
    expect(server.requests.find((r) => r.method === 'PATCH' && r.path === '/crm/v3/pipelines/deals/default')!.body).toEqual({ label: 'Neomoov' });
    expect(report.filter((l) => l.kind === 'stage' && l.action === 'created')).toHaveLength(12);
    // Simulation : seules des lectures, et un plan.
    const dry = fakeHubSpot([{ match: /\/crm\/v3\/pipelines\/deals$/, method: 'GET', body: PIPELINES }]);
    const planned = await new HubSpotCrmProvider('pat-test-secret', { fetchImpl: dry.fetchImpl }).setup({ dryRun: true });
    expect(dry.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(planned.filter((l) => l.action === 'planned').length).toBeGreaterThan(20);
    expect(planned.filter((l) => l.kind === 'pipeline').map((l) => l.action)).toEqual(['unchanged', 'unchanged']);
  });

  it('realCrm exige le jeton et ne l\'expose pas', () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', CRM_PROVIDER: 'real' }, { dotenv: false });
    expect(() => realCrm(env)).toThrow(/HUBSPOT_ACCESS_TOKEN/);
    const provider = realCrm(loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', CRM_PROVIDER: 'real', HUBSPOT_ACCESS_TOKEN: 'pat-na1-secret', HUBSPOT_PORTAL_ID: '42' }, { dotenv: false }));
    expect(provider.name).toBe('hubspot');
    expect(JSON.stringify(provider)).not.toContain('pat-na1-secret');
    expect((provider as unknown as Record<string, unknown>)['onModuleInit']).toBeUndefined();
  });
});
