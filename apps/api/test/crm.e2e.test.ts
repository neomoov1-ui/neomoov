import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockCrmProvider } from '../src/adapters/mock/crm.mock.js';
import { CRM_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { CrmJobsService } from '../src/modules/crm/crm-jobs.service.js';
import { CrmSyncService } from '../src/modules/crm/crm-sync.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, startTestApp, testEmail, testPhone, type StaffSession } from './helpers.js';

/**
 * Étape 25 : synchronisation CRM (fournisseur simulé) : prospect avec consentement (contact, transaction, note),
 * sans consentement rien ne part, compte d'affaires en entreprise, organisation créée puis abonnée, panne du
 * fournisseur puis reprise par la passe, journal d'audit.
 */
const tag = () => Math.random().toString(36).slice(2, 10);

describe('CRM (intégration, fournisseur simulé)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let crm: MockCrmProvider;
  let jobs: CrmJobsService;
  let sync: CrmSyncService;
  let publicKey: Record<string, string>;
  let rootId = '';
  const startedAt = new Date();
  const leadIds: string[] = [];
  const accountIds: string[] = [];
  const orgIds: string[] = [];
  const server = () => app!.getHttpServer();

  const waitFor = async <T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string): Promise<T> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const value = await read();
      if (ok(value)) return value;
      if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const synced = (records: Array<{ objectType: string; status: string }>, ...objects: string[]) => objects.every((o) => records.some((r) => r.objectType === o && r.status === 'synced'));

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    crm = app.get<MockCrmProvider>(CRM_PROVIDER);
    jobs = app.get(CrmJobsService);
    sync = app.get(CrmSyncService);
    // En test, rien n'est automatique : ce fichier porte le traitement de la file `crm` (mode mémoire).
    jobs.register();
    admin = await createStaffAndLogin(app, ['admin']);
    const key = await request(server()).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'Site de test CRM', scopes: ['public:write'] }).expect(201);
    publicKey = { Authorization: `Bearer ${key.body.key}` };
    const [root] = await db(app).select({ id: schema.organizations.id }).from(schema.organizations).where(sql`${schema.organizations.parentId} IS NULL`).limit(1);
    rootId = root!.id;
  });

  afterAll(async () => {
    if (app) {
      const database = db(app);
      // Les lignes du fournisseur simulé n'ont de sens que dans ce processus : retirées (y compris celles du rattrapage).
      await database.delete(schema.crmRecords).where(and(eq(schema.crmRecords.provider, 'mock'), gte(schema.crmRecords.createdAt, startedAt)));
      if (leadIds.length) await database.delete(schema.leads).where(inArray(schema.leads.id, leadIds));
      if (accountIds.length) await database.delete(schema.businessAccounts).where(inArray(schema.businessAccounts.id, accountIds));
      if (orgIds.length) await database.delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const postLead = async (body: Record<string, unknown>) => {
    const res = await request(server()).post('/v1/public/leads').set(publicKey).send({ firstName: 'Ana', lastName: 'Prospect', phone: testPhone(), language: 'fr', antiBotToken: 'ok', consent: true, ...body });
    if (res.status !== 201) throw new Error(`Prospect refusé : ${res.status} ${JSON.stringify(res.body)}`);
    leadIds.push(res.body.id as string);
    return res.body.id as string;
  };

  it('prospect avec consentement : contact, transaction dans le bon parcours et note chez le fournisseur ; identifiants gardés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const email = testEmail('prospect');
    const id = await postLead({ kind: 'driver', email, city: 'Laval', message: 'Je conduis depuis 10 ans.' });
    const records = await waitFor(() => sync.records('lead', id), (r) => synced(r, 'contact', 'deal', 'note'), 'prospect synchronisé');
    const contact = crm.contact(`lead:${id}`)!;
    expect(contact).toMatchObject({ email, firstName: 'Ana', lastName: 'Prospect', city: 'Laval', language: 'fr', leadKind: 'driver', driverStatus: 'candidate', entity: 'neomoov', consent: { given: true, source: 'form' } });
    expect(contact.consent.at).toBeInstanceOf(Date);
    const deal = crm.deal(`lead:${id}`)!;
    expect(deal).toMatchObject({ pipeline: 'training', stage: 'candidate', contactExternalId: contact.id, name: 'Candidature chauffeur : Ana Prospect' });
    expect(crm.notes.find((n) => n.contactExternalId === contact.id)).toMatchObject({ body: 'Je conduis depuis 10 ans.', dealExternalId: deal.id });
    expect(records.find((r) => r.objectType === 'contact')).toMatchObject({ externalId: contact.id, status: 'synced', attempts: 0, error: null });
    expect(records.find((r) => r.objectType === 'deal')?.externalId).toBe(deal.id);
    // Aucune donnée interdite n'a été transmise (ni adresse ni trajet ni paiement : l'entrée n'a pas ces champs).
    expect(Object.keys(contact)).not.toEqual(expect.arrayContaining(['address', 'rideId', 'paymentMethod']));
    // Journal d'audit (en ajout seul) : une entrée système par synchronisation.
    const audit = await waitFor(
      () => db(app!).select({ action: schema.auditLog.action }).from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, 'crm.synced'))),
      (rows) => rows.length >= 1, 'audit',
    );
    expect(audit).toHaveLength(1);

    // Préinscription Formation chauffeurs et demande d'entreprise : chacune dans son parcours.
    const training = await postLead({ kind: 'training', email: testEmail('formation') });
    await waitFor(() => sync.records('lead', training), (r) => synced(r, 'deal'), 'formation');
    expect(crm.deal(`lead:${training}`)).toMatchObject({ pipeline: 'training', stage: 'preregistered' });
    expect(crm.contact(`lead:${training}`)).toMatchObject({ leadKind: 'training', trainingStatus: 'preregistered' });
    const business = await postLead({ kind: 'business', email: testEmail('entreprise'), firstName: 'Marc' });
    await waitFor(() => sync.records('lead', business), (r) => synced(r, 'deal'), 'entreprise');
    expect(crm.deal(`lead:${business}`)).toMatchObject({ pipeline: 'b2b', stage: 'new', name: 'Entreprise : Marc Prospect' });
    expect(crm.contact(`lead:${business}`)).toMatchObject({ affiliationProgram: 'business' });
    // Rejouer la synchronisation met la fiche à jour sans la dupliquer, et n'ajoute pas une seconde note.
    const notesBefore = crm.notes.length;
    const again = await sync.sync('lead', id);
    expect(again).toMatchObject({ status: 'synced', objects: { contact: contact.id, deal: deal.id } });
    expect(crm.notes).toHaveLength(notesBefore);
    expect(crm.contacts.size).toBe(3);
  });

  it('sans consentement, rien ne part (ni un prospect écarté)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const calls = crm.calls.length;
    const [noConsent] = await db(app).insert(schema.leads).values({ kind: 'business', firstName: 'Sans', lastName: 'Consentement', phone: testPhone(), email: testEmail('import'), language: 'fr', source: 'import', consentAt: null }).returning({ id: schema.leads.id });
    leadIds.push(noConsent!.id);
    expect(await sync.sync('lead', noConsent!.id)).toMatchObject({ status: 'skipped', reason: 'no_consent', objects: {} });
    expect(crm.contact(`lead:${noConsent!.id}`)).toBeUndefined();
    expect(crm.calls).toHaveLength(calls);
    expect(await sync.records('lead', noConsent!.id)).toEqual([expect.objectContaining({ objectType: 'contact', status: 'skipped', error: 'no_consent', externalId: null })]);
    const [discarded] = await db(app).insert(schema.leads).values({ kind: 'driver', firstName: 'Écarté', phone: testPhone(), language: 'fr', source: 'web', consentAt: new Date(), status: 'discarded' }).returning({ id: schema.leads.id });
    leadIds.push(discarded!.id);
    expect(await sync.sync('lead', discarded!.id)).toMatchObject({ status: 'skipped', reason: 'discarded' });
    expect(crm.calls).toHaveLength(calls);
    // Le formulaire public exige toujours le consentement (rien n'arrive en base sans lui).
    const res = await request(server()).post('/v1/public/leads').set(publicKey).send({ kind: 'driver', firstName: 'X', phone: testPhone(), antiBotToken: 'ok', consent: false });
    expect(res.status).toBe(400);
  });

  it('compte d\'affaires : entreprise, contact de facturation et transaction gagnée, sous contrat', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const billingEmail = testEmail('facturation');
    const [account] = await db(app).insert(schema.businessAccounts).values({ name: `Entreprise Test ${tag()}`, legalName: 'Entreprise Test inc.', billingEmail }).returning({ id: schema.businessAccounts.id, name: schema.businessAccounts.name });
    accountIds.push(account!.id);
    await app.get(DomainEventsService).emitAndWait('business_account.created', { businessAccountId: account!.id });
    const records = await waitFor(() => sync.records('business_account', account!.id), (r) => synced(r, 'company', 'contact', 'deal'), 'compte d\'affaires');
    expect(records).toHaveLength(3);
    const company = crm.company(`business_account:${account!.id}`)!;
    expect(company).toMatchObject({ name: account!.name, legalName: 'Entreprise Test inc.', accountType: 'business_account', consent: { given: true, source: 'contract' } });
    expect(crm.contact(`business_account:${account!.id}`)).toMatchObject({ email: billingEmail, firstName: null, affiliationProgram: 'business' });
    expect(crm.deal(`business_account:${account!.id}`)).toMatchObject({ pipeline: 'b2b', stage: 'active', companyExternalId: company.id });
  });

  it('organisation créée : entreprise et transaction « Ventes B2B » ; abonnée : client actif ; jamais la racine', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const created = await request(server()).post('/v1/admin/organizations').set(bearer(admin.tokens)).send({ parentId: rootId, code: `crm-${tag()}`, name: 'Flotte CRM', type: 'fleet' }).expect(201);
    const orgId = created.body.id as string;
    orgIds.push(orgId);
    await waitFor(() => sync.records('organization', orgId), (r) => synced(r, 'company', 'deal'), 'organisation');
    expect(crm.company(`organization:${orgId}`)).toMatchObject({ name: 'Flotte CRM', accountType: 'organization', organizationType: 'fleet', planCode: null, consent: { source: 'contract' } });
    expect(crm.deal(`organization:${orgId}`)).toMatchObject({ pipeline: 'b2b', stage: 'contacted' });
    await db(app).update(schema.organizations).set({ planCode: 'pro', status: 'active' }).where(eq(schema.organizations.id, orgId));
    await app.get(DomainEventsService).emitAndWait('organization.subscribed', { organizationId: orgId, planCode: 'pro' });
    await waitFor(() => Promise.resolve(crm.deal(`organization:${orgId}`)), (d) => d?.stage === 'active', 'abonnement');
    expect(crm.company(`organization:${orgId}`)).toMatchObject({ planCode: 'pro' });
    expect(await sync.sync('organization', rootId)).toMatchObject({ status: 'skipped', reason: 'platform' });
    expect(crm.company(`organization:${rootId}`)).toBeUndefined();
  });

  it('panne du fournisseur : erreur consignée, relance par la passe de reprise', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [lead] = await db(app).insert(schema.leads).values({ kind: 'partner', firstName: 'Panne', phone: testPhone(), email: testEmail('panne'), language: 'en', source: 'web', consentAt: new Date() }).returning({ id: schema.leads.id });
    leadIds.push(lead!.id);
    crm.unavailable = true;
    await expect(sync.sync('lead', lead!.id)).rejects.toMatchObject({ code: 'CRM_PROVIDER_ERROR' });
    expect(await sync.records('lead', lead!.id)).toEqual([expect.objectContaining({ objectType: 'contact', status: 'error', attempts: 1, error: expect.stringContaining('panne') })]);
    expect(await sync.pendingRetries()).toEqual(expect.arrayContaining([{ entityType: 'lead', entityId: lead!.id }]));
    // Toujours en panne : l'échec est compté, jamais propagé par la passe.
    const failed = await jobs.sweep(new Date(), { catchUp: false });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect((await sync.records('lead', lead!.id))[0]!.attempts).toBe(2);
    crm.unavailable = false;
    const report = await jobs.sweep(new Date(), { catchUp: false });
    expect(report.retried).toBeGreaterThanOrEqual(1);
    const records = await sync.records('lead', lead!.id);
    expect(records.find((r) => r.objectType === 'contact')).toMatchObject({ status: 'synced', attempts: 0, error: null });
    expect(crm.deal(`lead:${lead!.id}`)).toMatchObject({ pipeline: 'b2b', stage: 'new', name: 'Partenaire : Panne' });
    expect(crm.contact(`lead:${lead!.id}`)).toMatchObject({ language: 'en', affiliationProgram: 'partner' });
    expect(await sync.pendingRetries()).not.toEqual(expect.arrayContaining([{ entityType: 'lead', entityId: lead!.id }]));
    // Événement perdu : un prospect récent jamais présenté au CRM est rattrapé par la passe.
    const [lost] = await db(app).insert(schema.leads).values({ kind: 'driver', firstName: 'Perdu', phone: testPhone(), language: 'fr', source: 'web', consentAt: new Date() }).returning({ id: schema.leads.id });
    leadIds.push(lost!.id);
    expect(await sync.unsyncedLeads(new Date(Date.now() - 60_000))).toContain(lost!.id);
    // Compte d'affaires saisi en base, sans événement (aucune route ne les crée encore) : rattrapé de même.
    const [silent] = await db(app).insert(schema.businessAccounts).values({ name: `Entreprise Silencieuse ${tag()}`, billingEmail: testEmail('silencieuse') }).returning({ id: schema.businessAccounts.id });
    accountIds.push(silent!.id);
    expect(await sync.unsyncedBusinessAccounts(new Date(Date.now() - 60_000))).toContain(silent!.id);
    // Fenêtre courte : la base est partagée, les prospects des autres suites ne doivent pas saturer la passe.
    const caught = await jobs.sweep(new Date(), { catchUp: true, since: new Date(Date.now() - 60_000) });
    expect(caught.caughtUp).toBeGreaterThanOrEqual(2);
    expect(crm.contact(`lead:${lost!.id}`)).toBeDefined();
    expect(crm.company(`business_account:${silent!.id}`)).toMatchObject({ accountType: 'business_account', consent: { source: 'contract' } });
    expect(await sync.unsyncedBusinessAccounts(new Date(Date.now() - 60_000))).not.toContain(silent!.id);
  });

  it('My Hub : état CRM d\'une fiche lu par le personnel, refusé à un client', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const id = await postLead({ kind: 'driver', email: testEmail('etat-crm') });
    await waitFor(() => sync.records('lead', id), (r) => synced(r, 'contact', 'deal'), 'prospect synchronisé');
    const res = await request(server()).get(`/v1/admin/crm/leads/${id}`).set(bearer(admin.tokens)).expect(200);
    expect(res.body.provider).toBe('mock');
    expect(res.body.records.find((r: { objectType: string }) => r.objectType === 'contact')).toMatchObject({ status: 'synced', attempts: 0, error: null, externalId: crm.contact(`lead:${id}`)!.id, lastSyncedAt: expect.any(String) });
    // Fiche jamais présentée au CRM : liste vide, pas d'erreur.
    const unknown = await request(server()).get('/v1/admin/crm/organizations/00000000-0000-4000-8000-000000000000').set(bearer(admin.tokens)).expect(200);
    expect(unknown.body).toEqual({ provider: 'mock', records: [] });
    const finance = await createStaffAndLogin(app, ['finance']);
    expect((await request(server()).get(`/v1/admin/crm/prospects/${id}`).set(bearer(finance.tokens))).status).toBe(200);
    const client = await loginByOtp(app);
    expect((await request(server()).get(`/v1/admin/crm/leads/${id}`).set(bearer(client))).status).toBe(403);
  });
});
