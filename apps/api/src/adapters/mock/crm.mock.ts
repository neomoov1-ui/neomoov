/**
 * CRM simulé (étape 25) : en mémoire, déterministe, sans réseau. Mêmes règles que l'adaptateur réel : rien ne part
 * sans consentement, une fiche est identifiée par son identifiant Neomoov (idempotence), et `unavailable` simule une
 * panne du fournisseur (502, la file relance). Les tests lisent `contacts`, `companies`, `deals` et `notes`.
 */
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { requireCrmConsent, type CrmCompanyInput, type CrmContactInput, type CrmDealInput, type CrmNoteInput, type CrmProvider, type CrmUpsertResult } from '../types.js';

let counter = 0;
const RUN = randomBytes(3).toString('hex');
const nextId = (prefix: string) => `${prefix}_${RUN}${(++counter).toString(36).padStart(6, '0')}`;

type Stored<T> = T & { id: string; updatedAt: Date };

export class MockCrmProvider implements CrmProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** Fiches par identifiant Neomoov (`lead:<id>`, `organization:<id>`…). */
  readonly contacts = new Map<string, Stored<CrmContactInput>>();
  readonly companies = new Map<string, Stored<CrmCompanyInput>>();
  readonly deals = new Map<string, Stored<CrmDealInput>>();
  readonly notes: Array<Stored<CrmNoteInput>> = [];
  /** Panne simulée du CRM : tout appel échoue en 502 `CRM_PROVIDER_ERROR`, comme l'adaptateur réel. */
  unavailable = false;

  private available(): void {
    if (this.unavailable) throw new AppError('CRM_PROVIDER_ERROR', 'CRM indisponible (panne simulée)', 502);
  }

  private upsert<T extends { platformId: string; externalId?: string | null }>(store: Map<string, Stored<T>>, input: T, prefix: string): CrmUpsertResult {
    const existing = store.get(input.platformId) ?? (input.externalId ? [...store.values()].find((s) => s.id === input.externalId) : undefined);
    const id = existing?.id ?? nextId(prefix);
    store.set(input.platformId, { ...input, id, updatedAt: new Date() });
    return { id, created: !existing };
  }

  async upsertContact(input: CrmContactInput): Promise<CrmUpsertResult> {
    this.calls.push({ method: 'upsertContact', args: [input] });
    requireCrmConsent(input.consent);
    this.available();
    return this.upsert(this.contacts, input, 'crm_contact');
  }

  async upsertCompany(input: CrmCompanyInput): Promise<CrmUpsertResult> {
    this.calls.push({ method: 'upsertCompany', args: [input] });
    requireCrmConsent(input.consent);
    this.available();
    return this.upsert(this.companies, input, 'crm_company');
  }

  async upsertDeal(input: CrmDealInput): Promise<CrmUpsertResult> {
    this.calls.push({ method: 'upsertDeal', args: [input] });
    requireCrmConsent(input.consent);
    this.available();
    return this.upsert(this.deals, input, 'crm_deal');
  }

  async addNote(input: CrmNoteInput): Promise<{ id: string }> {
    this.calls.push({ method: 'addNote', args: [input] });
    requireCrmConsent(input.consent);
    this.available();
    if (!input.contactExternalId && !input.companyExternalId && !input.dealExternalId) throw new AppError('CRM_NOTE_WITHOUT_TARGET', 'Une note doit viser un contact, une entreprise ou une transaction', 500);
    const id = nextId('crm_note');
    this.notes.push({ ...input, id, updatedAt: new Date() });
    return { id };
  }

  /** Pour les tests : fiches d'une entité Neomoov. */
  contact(platformId: string): Stored<CrmContactInput> | undefined {
    return this.contacts.get(platformId);
  }
  company(platformId: string): Stored<CrmCompanyInput> | undefined {
    return this.companies.get(platformId);
  }
  deal(platformId: string): Stored<CrmDealInput> | undefined {
    return this.deals.get(platformId);
  }

  reset(): void {
    this.calls.length = 0;
    this.contacts.clear();
    this.companies.clear();
    this.deals.clear();
    this.notes.length = 0;
    this.unavailable = false;
  }
}
