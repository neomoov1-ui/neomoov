/**
 * Marque par organisation (étape 22, amendement v1.2 section 5, décision D11 : une seule application publiée). Une
 * organisation définit sa marque (ligne `brands`, facultative) ; ce qui manque vient de son organisation parente, puis
 * de Neomoov (identité du prompt 0, coordonnées de l'assistance et liens légaux des réglages). Les applications la
 * reçoivent par `GET /v1/config` une fois le profil client rattaché par code ; le web la résout par le domaine vérifié.
 * Marques résolues en cache 60 secondes par organisation, vidé à chaque modification.
 */
import { schema } from '@neomoov/db';
import {
  applyBrandUpdate, BRAND_COLOR_KEYS, brandContrastIssues, brandSummary, dnsVerificationRecord, isHexColor, NEOMOOV_BRAND, resolveBrand,
  type AttachOrganizationResult, type Brand, type BrandUpdate, type BrandView, type OrganizationDomainCreate, type OrganizationDomainCreated, type OrganizationDomainView,
  type OrganizationSummary, type PublicBrand,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { randomToken } from '../../common/crypto.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from '../auth/actor.js';
import { AuditService } from '../audit/audit.service.js';

type BrandRow = typeof schema.brands.$inferSelect;
type OrgRow = typeof schema.organizations.$inferSelect;
type DomainRow = typeof schema.organizationDomains.$inferSelect;

const CACHE_TTL_MS = 60_000;
/** Statuts dont la marque est servie au public ; une organisation suspendue ou fermée redevient Neomoov. */
const OPEN_STATUSES = ['trial', 'active', 'read_only'];

function uniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

/** Ligne `brands` sous la forme d'une mise à jour (ce qui est enregistré) ; une couleur invalide en base est ignorée. */
export function storedBrandOf(row: BrandRow | null | undefined): BrandUpdate {
  if (!row) return {};
  const rawColors = (row.colors ?? {}) as Record<string, unknown>;
  const colors: Partial<Record<(typeof BRAND_COLOR_KEYS)[number], string>> = {};
  for (const key of BRAND_COLOR_KEYS) if (isHexColor(rawColors[key])) colors[key] = (rawColors[key] as string).toUpperCase();
  const rawTexts = (row.texts ?? {}) as Record<string, unknown>;
  const texts = Object.fromEntries(Object.entries(rawTexts).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return {
    displayName: row.displayName, logoUrl: row.logoUrl, colors, tagline: row.tagline, texts, supportPhone: row.supportPhone, supportEmail: row.supportEmail,
    emailSenderName: row.emailSenderName, emailSenderAddress: row.emailSenderAddress, smsSender: row.smsSender, termsUrl: row.termsUrl, privacyUrl: row.privacyUrl,
  };
}

/** `EMAIL_FROM` (« Neomoov <notifications@neomoov.net> ») décomposé en nom et adresse. */
export function parseSender(from: string): { name: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { name: match[1] || NEOMOOV_BRAND.emailSender.name, address: match[2]!.trim() };
  return { name: NEOMOOV_BRAND.emailSender.name, address: from.trim() || NEOMOOV_BRAND.emailSender.address };
}

const domainView = (d: DomainRow): OrganizationDomainView => ({
  id: d.id, organizationId: d.organizationId, domain: d.domain, kind: d.kind as OrganizationDomainView['kind'], verifiedAt: d.verifiedAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString(),
});

@Injectable()
export class BrandingService {
  private readonly cache = new Map<string, { at: number; brand: Brand }>();
  private root: { at: number; id: string } | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async organization(id: string): Promise<OrgRow> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return org;
  }

  private async rootId(): Promise<string> {
    if (this.root && Date.now() - this.root.at < CACHE_TTL_MS) return this.root.id;
    const [root] = await this.db.select({ id: schema.organizations.id }).from(schema.organizations).where(isNull(schema.organizations.parentId)).orderBy(asc(schema.organizations.createdAt)).limit(1);
    if (!root) throw new AppError('ROOT_ORGANIZATION_MISSING', 'Organisation racine absente (données de départ)', 500);
    this.root = { at: Date.now(), id: root.id };
    return root.id;
  }

  /** Marque de la plateforme : Neomoov, avec l'assistance et les liens légaux des réglages et l'expéditeur de `EMAIL_FROM`. */
  private async platformDefaults(): Promise<Brand> {
    const [phone, email, termsUrl, privacyUrl] = await Promise.all([
      this.settings.get<unknown>('support.phone', null), this.settings.get<unknown>('support.email', null),
      this.settings.string('legal.terms_url', NEOMOOV_BRAND.termsUrl), this.settings.string('legal.privacy_url', NEOMOOV_BRAND.privacyUrl),
    ]);
    const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { ...NEOMOOV_BRAND, support: { phone: text(phone), email: text(email) }, termsUrl, privacyUrl, emailSender: parseSender(this.env.EMAIL_FROM) };
  }

  /**
   * Marque résolue d'une organisation (`null` : la plateforme). Héritage le long du chemin : la marque d'une
   * sous-organisation complète celle de son parent, qui complète Neomoov.
   */
  async brandFor(organizationId: string | null): Promise<Brand> {
    const id = organizationId ?? (await this.rootId());
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.brand;
    const [org] = await this.db.select({ path: schema.organizations.path }).from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    const chain = org ? org.path.split('/').filter(Boolean) : [];
    const rows = chain.length ? await this.db.select().from(schema.brands).where(inArray(schema.brands.organizationId, chain)) : [];
    let brand = await this.platformDefaults();
    for (const orgId of chain) {
      const row = rows.find((r) => r.organizationId === orgId);
      if (row) brand = resolveBrand(storedBrandOf(row), brand);
    }
    this.cache.set(id, { at: Date.now(), brand });
    return brand;
  }

  /** Oublie les marques en cache (toutes : une sous-organisation hérite de son parent). */
  invalidate(): void {
    this.cache.clear();
  }

  // --- Marque publique (applications, web) ---

  private publicView(org: OrgRow, brand: Brand): PublicBrand {
    return { organizationId: org.id, organizationName: org.name, joinCode: org.joinCode, brand };
  }

  async publicByCode(code: string): Promise<PublicBrand> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.joinCode, code)).limit(1);
    if (!org || !OPEN_STATUSES.includes(org.status)) throw AppError.notFound('ORGANIZATION_CODE_NOT_FOUND', 'Aucune organisation pour ce code');
    return this.publicView(org, await this.brandFor(org.id));
  }

  /** Par domaine vérifié seulement : un domaine déclaré mais non contrôlé ne sert aucune marque. */
  async publicByDomain(domain: string): Promise<PublicBrand> {
    const [row] = await this.db
      .select({ org: schema.organizations })
      .from(schema.organizationDomains)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationDomains.organizationId))
      .where(and(eq(schema.organizationDomains.domain, domain), isNotNull(schema.organizationDomains.verifiedAt)))
      .limit(1);
    if (!row || !OPEN_STATUSES.includes(row.org.status)) throw AppError.notFound('DOMAIN_NOT_FOUND', 'Aucune organisation pour ce domaine');
    return this.publicView(row.org, await this.brandFor(row.org.id));
  }

  // --- Administration de la marque ---

  private async brandRow(organizationId: string): Promise<BrandRow | null> {
    const [row] = await this.db.select().from(schema.brands).where(eq(schema.brands.organizationId, organizationId)).limit(1);
    return row ?? null;
  }

  async getBrand(organizationId: string): Promise<BrandView> {
    const org = await this.organization(organizationId);
    const row = await this.brandRow(org.id);
    return { organizationId: org.id, joinCode: org.joinCode, brand: await this.brandFor(org.id), stored: storedBrandOf(row), updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  /** Remplace ce qui est donné (`null` efface) ; refuse une combinaison de couleurs sous le contraste WCAG AA. */
  async updateBrand(organizationId: string, input: BrandUpdate, actor: UserActor): Promise<BrandView> {
    const org = await this.organization(organizationId);
    const before = storedBrandOf(await this.brandRow(org.id));
    const next = applyBrandUpdate(before, input);
    const parentBrand = org.parentId ? await this.brandFor(org.parentId) : await this.platformDefaults();
    const issues = brandContrastIssues(resolveBrand(next, parentBrand).colors);
    if (issues.length) throw new AppError('BRAND_CONTRAST', issues.map((i) => i.message).join(' ; '), 400, { issues });
    const values = {
      organizationId: org.id, displayName: next.displayName ?? null, logoUrl: next.logoUrl ?? null, colors: next.colors ?? {}, tagline: next.tagline ?? null, texts: next.texts ?? {},
      supportPhone: next.supportPhone ?? null, supportEmail: next.supportEmail ?? null, emailSenderName: next.emailSenderName ?? null, emailSenderAddress: next.emailSenderAddress ?? null,
      smsSender: next.smsSender ?? null, termsUrl: next.termsUrl ?? null, privacyUrl: next.privacyUrl ?? null, updatedAt: new Date(),
    };
    await this.db.insert(schema.brands).values(values).onConflictDoUpdate({ target: schema.brands.organizationId, set: values });
    this.invalidate();
    this.audit.record({ action: 'organization.brand_updated', entity: 'organizations', entityId: org.id, before, after: { ...next, by: actor.userId } });
    return this.getBrand(org.id);
  }

  // --- Domaines ---

  async listDomains(organizationId: string): Promise<OrganizationDomainView[]> {
    await this.organization(organizationId);
    const rows = await this.db.select().from(schema.organizationDomains).where(eq(schema.organizationDomains.organizationId, organizationId)).orderBy(asc(schema.organizationDomains.createdAt));
    return rows.map(domainView);
  }

  /** Le jeton de vérification et l'enregistrement TXT à poser ne sont rendus qu'ici. */
  async addDomain(organizationId: string, input: OrganizationDomainCreate, actor: UserActor): Promise<OrganizationDomainCreated> {
    const org = await this.organization(organizationId);
    const token = randomToken(24);
    try {
      const [row] = await this.db.insert(schema.organizationDomains).values({ organizationId: org.id, domain: input.domain, kind: input.kind, verificationToken: token }).returning();
      this.audit.record({ action: 'organization.domain_added', entity: 'organization_domains', entityId: row!.id, after: { organizationId: org.id, domain: input.domain, kind: input.kind, by: actor.userId } });
      return { ...domainView(row!), verificationToken: token, dnsRecord: dnsVerificationRecord(input.domain, token) };
    } catch (error) {
      if (uniqueViolation(error)) throw AppError.conflict('DOMAIN_TAKEN', 'Ce domaine est déjà déclaré');
      throw error;
    }
  }

  private async domain(organizationId: string, domainId: string): Promise<DomainRow> {
    const [row] = await this.db.select().from(schema.organizationDomains).where(and(eq(schema.organizationDomains.id, domainId), eq(schema.organizationDomains.organizationId, organizationId))).limit(1);
    if (!row) throw AppError.notFound('DOMAIN_NOT_FOUND', 'Domaine introuvable');
    return row;
  }

  async removeDomain(organizationId: string, domainId: string, actor: UserActor): Promise<void> {
    await this.organization(organizationId);
    const row = await this.domain(organizationId, domainId);
    await this.db.delete(schema.organizationDomains).where(eq(schema.organizationDomains.id, row.id));
    this.audit.record({ action: 'organization.domain_removed', entity: 'organization_domains', entityId: row.id, before: { organizationId, domain: row.domain, by: actor.userId } });
  }

  /** V1 : vérification manuelle par la plateforme (contrôle du TXT par une personne), pas de vérification automatique. */
  async verifyDomain(organizationId: string, domainId: string, actor: UserActor, now = new Date()): Promise<OrganizationDomainView> {
    await this.organization(organizationId);
    const row = await this.domain(organizationId, domainId);
    if (row.verifiedAt) return domainView(row);
    const [updated] = await this.db.update(schema.organizationDomains).set({ verifiedAt: now, verifiedByUserId: actor.userId }).where(eq(schema.organizationDomains.id, row.id)).returning();
    this.audit.record({ action: 'organization.domain_verified', entity: 'organization_domains', entityId: row.id, after: { organizationId, domain: row.domain, by: actor.userId } });
    return domainView(updated!);
  }

  // --- Rattachement d'un client et sélecteur ---

  /**
   * Rattache le profil client de l'utilisateur à l'organisation du code (une seule organisation cliente par profil en
   * V1 : un profil déjà rattaché ailleurs change d'organisation) ; le consentement est journalisé. Idempotent.
   */
  async attach(userId: string, code: string): Promise<AttachOrganizationResult> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.joinCode, code)).limit(1);
    if (!org || !OPEN_STATUSES.includes(org.status)) throw AppError.notFound('ORGANIZATION_CODE_NOT_FOUND', 'Aucune organisation pour ce code');
    const [client] = await this.db.select({ id: schema.clients.id, organizationId: schema.clients.organizationId }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    if (client.organizationId !== org.id) {
      await this.db.update(schema.clients).set({ organizationId: org.id }).where(eq(schema.clients.id, client.id));
      this.audit.record({
        action: 'client.organization_attached', entity: 'clients', entityId: client.id,
        before: { organizationId: client.organizationId }, after: { organizationId: org.id, joinCode: code, consent: 'code_entered_by_user' },
      });
    }
    const brand = await this.brandFor(org.id);
    return { organization: { id: org.id, name: org.name, joinCode: org.joinCode, current: true, brand: brandSummary(brand) }, brand };
  }

  /**
   * Organisations d'un utilisateur pour le sélecteur : celle de son profil client (courante), celle de sa fiche
   * chauffeur, et ses adhésions actives. Lu ici directement (la route `GET /v1/me/organizations` vit ailleurs).
   */
  async organizationsOf(userId: string, now = new Date()): Promise<{ organizations: OrganizationSummary[]; currentId: string | null }> {
    const [profile] = await this.db
      .select({ client: schema.clients.organizationId, driver: schema.drivers.organizationId })
      .from(schema.users)
      .leftJoin(schema.clients, eq(schema.clients.userId, schema.users.id))
      .leftJoin(schema.drivers, eq(schema.drivers.userId, schema.users.id))
      .where(eq(schema.users.id, userId))
      .limit(1);
    const memberships = await this.db
      .select({ organizationId: schema.memberships.organizationId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active'), or(isNull(schema.memberships.expiresAt), gt(schema.memberships.expiresAt, now))));
    const currentId = profile?.client ?? profile?.driver ?? null;
    const ids = [...new Set([currentId, profile?.driver ?? null, ...memberships.map((m) => m.organizationId)].filter((id): id is string => Boolean(id)))];
    if (!ids.length) return { organizations: [], currentId: null };
    const orgs = await this.db.select().from(schema.organizations).where(inArray(schema.organizations.id, ids));
    const organizations = await Promise.all(orgs.map(async (o) => ({ id: o.id, name: o.name, joinCode: o.joinCode, current: o.id === currentId, brand: brandSummary(await this.brandFor(o.id)) })));
    organizations.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    return { organizations, currentId };
  }

  /** Ce que `GET /v1/config` ajoute : la marque de l'appelant (profil client rattaché, sinon Neomoov) et ses organisations. */
  async configFor(userId: string | null): Promise<{ brand: Brand; organizations: OrganizationSummary[] }> {
    if (!userId) return { brand: await this.brandFor(null), organizations: [] };
    const { organizations, currentId } = await this.organizationsOf(userId);
    return { brand: await this.brandFor(currentId), organizations };
  }
}
