/**
 * Dossier du chauffeur (prompt 11) : candidature d'un compte existant, profil, véhicules (catégorie déduite du modèle),
 * documents téléversés (stockage objet), formation, compte de versement Stripe Connect, assistant d'inscription.
 * Règles lues dans `settings` et `vehicle_categories`, jamais codées dans l'application.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import {
  admittedModels, currentDocument, daysBetween, deduceVehicleCategory, documentState, localDate, onboardingChecklist, vehicleEquipmentSchema,
  type CategoryRule, type DocumentType, type DocumentUploadFields, type DriverApply, type DriverDocumentView, type DriverDocumentsView,
  type DriverProfileUpdate, type DriverProfileView, type OnboardingView, type VehicleCategory, type VehicleInput, type VehicleView,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, VIRUS_SCANNER, type StorageProvider, type VirusScanner } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { ReferralsService } from '../credits/referrals.service.js';
import { DriverPaymentsService } from '../payments/driver-payments.service.js';
import { UsersService } from '../users/users.service.js';

export type DriverRow = typeof schema.drivers.$inferSelect;
type DocumentRow = typeof schema.driverDocuments.$inferSelect;
type VehicleRow = typeof schema.vehicles.$inferSelect;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

const DEFAULT_ONBOARDING_DOCUMENTS: DocumentType[] = ['profile_photo', 'licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check'];
const DEFAULT_EXPIRING_DOCUMENTS: DocumentType[] = ['licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check'];

/** Types de fichiers admis, reconnus à leur signature (l'extension et le type déclarés ne suffisent pas). */
export function sniffDocumentType(buffer: Buffer): { contentType: string; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: 'png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { contentType: 'image/webp', extension: 'webp' };
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return { contentType: 'application/pdf', extension: 'pdf' };
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

@Injectable()
export class DriverProfileService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly driverPayments: DriverPaymentsService,
    private readonly referrals: ReferralsService,
    private readonly events: DomainEventsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  async today(): Promise<string> {
    return localDate(new Date(), await this.timeZone()).date;
  }

  async findDriver(userId: string): Promise<DriverRow | null> {
    const [row] = await this.db.select().from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    return row ?? null;
  }

  async requireDriver(userId: string): Promise<DriverRow> {
    const row = await this.findDriver(userId);
    if (!row) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis : commencez par la candidature');
    return row;
  }

  /**
   * `POST /driver/apply` : le compte connecté par SMS devient candidat (statut `pending`, rôle `driver`). Idempotent :
   * une seconde candidature renvoie le dossier existant. Le jeton en cours ne porte pas encore le rôle : l'application
   * le renouvelle (`POST /auth/refresh`) après la candidature.
   */
  async apply(userId: string, input: DriverApply): Promise<DriverProfileView> {
    const existing = await this.findDriver(userId);
    if (existing) return this.profileView(existing);
    // Code du parrain chauffeur (5.9) : vérifié avant la création du dossier, enregistré après.
    const referrer = input.referralCode ? await this.referrals.driverReferrerFor(userId, input.referralCode) : null;
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ firstName: input.firstName, lastName: input.lastName, ...(input.email ? { email: input.email.toLowerCase() } : {}), ...(input.language ? { language: input.language } : {}) })
          .where(eq(schema.users.id, userId));
        const [numberRow] = await tx.execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n`);
        const [driver] = await tx
          .insert(schema.drivers)
          .values({ userId, publicNumber: numberRow!.n, status: 'pending', qualification: input.qualification, spokenLanguages: input.language === 'en' ? ['en', 'fr'] : ['fr'] })
          .onConflictDoNothing()
          .returning({ id: schema.drivers.id });
        if (driver) await tx.insert(schema.driverBalances).values({ driverId: driver.id }).onConflictDoNothing();
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel est déjà utilisé par un autre compte');
      throw error;
    }
    await this.users.grantRole(userId, 'driver');
    if (referrer) await this.referrals.recordDriverReferral(userId, referrer);
    return this.profileView(await this.requireDriver(userId));
  }

  async profile(userId: string): Promise<DriverProfileView> {
    return this.profileView(await this.requireDriver(userId));
  }

  async profileView(driver: DriverRow): Promise<DriverProfileView> {
    const [user] = await this.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName, email: schema.users.email, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, driver.userId)).limit(1);
    return {
      id: driver.id,
      publicNumber: driver.publicNumber,
      status: driver.status,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? '',
      qualification: driver.qualification,
      gstNumber: driver.gstNumber,
      qstNumber: driver.qstNumber,
      tradeName: driver.tradeName,
      spokenLanguages: stringList(driver.spokenLanguages),
      experienceYears: driver.experienceYears,
      paymentModes: { card: true, cash: driver.acceptsCash, interac: driver.acceptsInterac, terminal: driver.acceptsTerminal, interacEmail: driver.interacEmail },
      acceptsScheduled: driver.acceptsScheduled,
      preferredZones: stringList(driver.preferredZones),
      rating: { average: Number(driver.ratingAverage), count: driver.ratingCount },
      rideCount: driver.rideCount,
      trainingCertifiedAt: driver.trainingCertifiedAt?.toISOString() ?? null,
      payout: { linked: Boolean(driver.stripeConnectAccountId), onboarded: driver.stripeConnectOnboarded },
      currentVehicleId: driver.currentVehicleId,
      activatedAt: driver.activatedAt?.toISOString() ?? null,
    };
  }

  async updateProfile(userId: string, input: DriverProfileUpdate): Promise<DriverProfileView> {
    const driver = await this.requireDriver(userId);
    if (input.preferredZones?.length) {
      const known = await this.db.select({ code: schema.zones.code }).from(schema.zones).where(inArray(schema.zones.code, input.preferredZones));
      const unknown = input.preferredZones.filter((z) => !known.some((k) => k.code === z));
      if (unknown.length) throw new AppError('UNKNOWN_ZONE', 'Zone inconnue', 400, { zones: unknown });
    }
    const interac = input.acceptsInterac ?? driver.acceptsInterac;
    const interacEmail = input.interacEmail !== undefined ? input.interacEmail : driver.interacEmail;
    if (interac && !interacEmail) throw new AppError('INTERAC_EMAIL_REQUIRED', 'Un courriel Interac est requis pour accepter les virements Interac', 400);
    const userSet = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email?.toLowerCase() ?? null } : {}),
    };
    const driverSet = {
      ...(input.qualification !== undefined ? { qualification: input.qualification } : {}),
      ...(input.gstNumber !== undefined ? { gstNumber: input.gstNumber?.replace(/\s+/g, '') ?? null } : {}),
      ...(input.qstNumber !== undefined ? { qstNumber: input.qstNumber?.replace(/\s+/g, '') ?? null } : {}),
      ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
      ...(input.spokenLanguages !== undefined ? { spokenLanguages: [...new Set(input.spokenLanguages)] } : {}),
      ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
      ...(input.acceptsCash !== undefined ? { acceptsCash: input.acceptsCash } : {}),
      ...(input.acceptsInterac !== undefined ? { acceptsInterac: input.acceptsInterac } : {}),
      ...(input.acceptsTerminal !== undefined ? { acceptsTerminal: input.acceptsTerminal } : {}),
      ...(input.interacEmail !== undefined ? { interacEmail: input.interacEmail?.toLowerCase() ?? null } : {}),
      ...(input.acceptsScheduled !== undefined ? { acceptsScheduled: input.acceptsScheduled } : {}),
      ...(input.preferredZones !== undefined ? { preferredZones: input.preferredZones } : {}),
    };
    try {
      await this.db.transaction(async (tx) => {
        if (Object.keys(userSet).length) await tx.update(schema.users).set(userSet).where(eq(schema.users.id, userId));
        if (Object.keys(driverSet).length) await tx.update(schema.drivers).set(driverSet).where(eq(schema.drivers.id, driver.id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel est déjà utilisé par un autre compte');
      throw error;
    }
    return this.profile(userId);
  }

  // Véhicules ------------------------------------------------------------------------------------------------------

  private async categoryRules(): Promise<CategoryRule[]> {
    const rows = await this.db.select().from(schema.vehicleCategories).orderBy(asc(schema.vehicleCategories.rank));
    return rows.map((r) => ({ code: r.code as VehicleCategory, rank: r.rank, seats: r.seats, minYear: r.minYear, allowedModels: stringList(r.allowedModels), active: r.active }));
  }

  async vehicleModels() {
    return admittedModels(await this.categoryRules());
  }

  vehicleView(row: VehicleRow, currentVehicleId: string | null): VehicleView {
    const equipment = vehicleEquipmentSchema.safeParse(row.equipment ?? {});
    return {
      id: row.id, category: row.category as VehicleCategory, make: row.make, model: row.model, year: row.year, colour: row.colour, plate: row.plate, seats: row.seats,
      status: row.status, equipment: equipment.success ? equipment.data : vehicleEquipmentSchema.parse({}), nextInspectionDueOn: row.nextInspectionDueOn, current: row.id === currentVehicleId,
    };
  }

  async vehicles(userId: string): Promise<VehicleView[]> {
    const driver = await this.requireDriver(userId);
    const rows = await this.db.select().from(schema.vehicles).where(eq(schema.vehicles.driverId, driver.id)).orderBy(desc(schema.vehicles.createdAt));
    return rows.filter((r) => r.status !== 'retired').map((r) => this.vehicleView(r, driver.currentVehicleId));
  }

  /** Véhicule déclaré : catégorie déduite du modèle, de l'année et des places ; en attente de l'inspection et des documents. */
  async addVehicle(userId: string, input: VehicleInput): Promise<VehicleView> {
    const driver = await this.requireDriver(userId);
    const deduction = deduceVehicleCategory(input, await this.categoryRules());
    if (!deduction.category) throw new AppError('VEHICLE_NOT_ADMITTED', 'Ce véhicule ne correspond à aucune catégorie Neomoov', 400, { refusal: deduction.refusal });
    try {
      const [row] = await this.db
        .insert(schema.vehicles)
        .values({
          driverId: driver.id, category: deduction.category, make: input.make, model: input.model, year: input.year, colour: input.colour, plate: input.plate.replace(/\s+/g, ' '),
          vin: input.vin ?? null, seats: input.seats, odometerKm: input.odometerKm ?? null, equipment: input.equipment, status: 'pending',
        })
        .returning();
      let current = driver.currentVehicleId;
      if (!current) {
        await this.db.update(schema.drivers).set({ currentVehicleId: row!.id }).where(eq(schema.drivers.id, driver.id));
        current = row!.id;
      }
      return this.vehicleView(row!, current);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('VEHICLE_ALREADY_REGISTERED', 'Cette plaque ou ce numéro de série est déjà enregistré');
      throw error;
    }
  }

  // Documents ------------------------------------------------------------------------------------------------------

  private documentView(row: DocumentRow): DriverDocumentView {
    return {
      id: row.id, type: row.type, status: row.status, number: row.number, issuedOn: row.issuedOn, expiresOn: row.expiresOn, rejectionReason: row.rejectionReason, uploadedAt: row.createdAt.toISOString(),
    };
  }

  private async documentRules(): Promise<{ onboarding: DocumentType[]; expiring: Set<DocumentType>; required: Set<DocumentType>; expiringDays: number }> {
    const [onboarding, expiring, required, reminders] = await Promise.all([
      this.settings.get<unknown>('drivers.onboarding_documents', DEFAULT_ONBOARDING_DOCUMENTS),
      this.settings.get<unknown>('drivers.expiring_documents', DEFAULT_EXPIRING_DOCUMENTS),
      this.settings.get<unknown>('drivers.required_documents', ['licence', 'insurance', 'registration']),
      this.settings.get<unknown>('drivers.document_reminder_days', [30, 7, 1]),
    ]);
    const days = Array.isArray(reminders) ? reminders.filter((d): d is number => typeof d === 'number') : [30];
    return {
      onboarding: stringList(onboarding) as DocumentType[],
      expiring: new Set(stringList(expiring) as DocumentType[]),
      required: new Set(stringList(required) as DocumentType[]),
      expiringDays: days.length ? Math.max(...days) : 30,
    };
  }

  async documents(userId: string): Promise<DriverDocumentsView> {
    const driver = await this.requireDriver(userId);
    return this.documentsOf(driver);
  }

  async documentsOf(driver: DriverRow): Promise<DriverDocumentsView> {
    const [rows, rules, today] = await Promise.all([
      this.db.select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.id)).orderBy(desc(schema.driverDocuments.createdAt)),
      this.documentRules(),
      this.today(),
    ]);
    const types = [...new Set<DocumentType>([...rules.onboarding, ...rules.required])];
    const items = types.map((type) => {
      const { current, replacement } = currentDocument(rows, type, today);
      const state = documentState(current, today, rules.expiringDays);
      return {
        type,
        required: rules.required.has(type) || rules.onboarding.includes(type),
        state,
        daysToExpiry: current?.expiresOn ? daysBetween(today, current.expiresOn) : null,
        expires: rules.expiring.has(type),
        current: current ? this.documentView(current) : null,
        replacement: replacement ? this.documentView(replacement) : null,
      };
    });
    const suspended = driver.status === 'suspended' || items.some((i) => rules.required.has(i.type) && i.state === 'expired');
    return { items, suspended };
  }

  /**
   * Téléversement d'un document (multipart) : type reconnu à la signature du fichier, 10 Mo au plus, échéance exigée
   * pour les documents qui expirent. Le document attend la vérification (agent de recrutement puis humain, étape 12).
   */
  async uploadDocument(userId: string, fields: DocumentUploadFields, file: UploadedFile | undefined): Promise<DriverDocumentView> {
    const driver = await this.requireDriver(userId);
    if (!file?.buffer?.length) throw new AppError('FILE_REQUIRED', 'Le fichier du document est requis (champ `file`)', 400);
    const maxBytes = await this.settings.number('drivers.max_document_bytes', 10_485_760);
    if (file.size > maxBytes || file.buffer.length > maxBytes) throw new AppError('FILE_TOO_LARGE', 'Le fichier dépasse la taille maximale', 413, { maxBytes });
    const sniffed = sniffDocumentType(file.buffer);
    if (!sniffed) throw new AppError('FILE_TYPE_NOT_ALLOWED', 'Formats acceptés : JPEG, PNG, WEBP ou PDF', 415);
    const [rules, today] = await Promise.all([this.documentRules(), this.today()]);
    if (rules.expiring.has(fields.type) && !fields.expiresOn) throw new AppError('EXPIRY_REQUIRED', 'La date d\'échéance du document est requise', 400);
    if (fields.expiresOn && daysBetween(today, fields.expiresOn) < 0) throw new AppError('DOCUMENT_EXPIRED', 'Ce document est déjà expiré', 400, { expiresOn: fields.expiresOn });
    if (fields.issuedOn && daysBetween(today, fields.issuedOn) > 0) throw new AppError('ISSUED_IN_FUTURE', 'La date de délivrance est dans le futur', 400);
    if (fields.vehicleId) {
      const [vehicle] = await this.db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(and(eq(schema.vehicles.id, fields.vehicleId), eq(schema.vehicles.driverId, driver.id))).limit(1);
      if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Véhicule introuvable');
    }
    const key = `drivers/${driver.id}/${fields.type}/${randomUUID()}.${sniffed.extension}`;
    // Étape 14 : analyse antivirus avant tout stockage ; un fichier infecté est refusé et l'essai journalisé.
    const scan = await this.scanner.scan({ body: file.buffer, ...(file.originalname ? { filename: file.originalname } : {}) });
    if (!scan.clean) {
      this.logger.warn({ driverId: driver.id, type: fields.type, signature: scan.signature }, 'Document refusé par l\'antivirus');
      throw new AppError('DOCUMENT_INFECTED', 'Ce fichier est refusé par l\'analyse antivirus', 422, { signature: scan.signature });
    }
    await this.storage.putObject({ key, body: file.buffer, contentType: sniffed.contentType });
    const [row] = await this.db
      .insert(schema.driverDocuments)
      .values({ driverId: driver.id, type: fields.type, fileKey: key, number: fields.number ?? null, issuedOn: fields.issuedOn ?? null, expiresOn: fields.expiresOn ?? null, status: 'pending' })
      .returning();
    this.logger.info({ driverId: driver.id, documentId: row!.id, type: fields.type, bytes: file.buffer.length }, 'Document chauffeur téléversé');
    // Vérification préalable par l'agent recrutement (extraction, cohérence, proposition), puis décision humaine.
    this.events.emit('driver.document_uploaded', { documentId: row!.id, driverId: driver.id, type: fields.type });
    return this.documentView(row!);
  }

  // Assistant d'inscription ----------------------------------------------------------------------------------------

  /** Documents et pack déjà lus par l'appelant (accueil) : passés ici pour ne pas les relire. */
  async onboarding(driver: DriverRow, knownDocs?: DriverDocumentsView, knownPackActive?: boolean): Promise<OnboardingView> {
    const [user] = await this.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.users).where(eq(schema.users.id, driver.userId)).limit(1);
    const [vehicle] = driver.currentVehicleId ? await this.db.select({ status: schema.vehicles.status }).from(schema.vehicles).where(eq(schema.vehicles.id, driver.currentVehicleId)).limit(1) : [];
    const [docs, packRequired, payoutRequired, packActive] = await Promise.all([
      knownDocs ?? this.documentsOf(driver),
      this.settings.get<boolean>('drivers.require_active_pack', false),
      this.settings.get<boolean>('drivers.require_payout_account', false),
      knownPackActive ?? this.db.select({ id: schema.packPurchases.id }).from(schema.packPurchases).where(and(eq(schema.packPurchases.driverId, driver.id), eq(schema.packPurchases.status, 'active'))).limit(1).then((rows) => rows.length > 0),
    ]);
    const profileComplete = Boolean(user?.firstName && user.lastName && driver.qualification && driver.gstNumber && driver.qstNumber);
    return onboardingChecklist({
      profileComplete,
      vehicleStatus: vehicle?.status ?? null,
      documents: docs.items.filter((i) => i.required).map((i) => i.state),
      trainingCertified: Boolean(driver.trainingCertifiedAt),
      payout: { linked: Boolean(driver.stripeConnectAccountId), onboarded: driver.stripeConnectOnboarded },
      payoutRequired: payoutRequired === true,
      packActive,
      packRequired: packRequired === true,
      driverStatus: driver.status,
    });
  }

  // Compte de versement (Stripe Connect Express) -------------------------------------------------------------------

  /** Compte de versement (Stripe Connect Express), tenu par le module des paiements. */
  async payoutStatus(userId: string): Promise<{ linked: boolean; onboarded: boolean; provider: string }> {
    const status = await this.driverPayments.status(userId);
    return { linked: status.linked, onboarded: status.onboarded, provider: status.provider };
  }

  /** Lien d'inscription Stripe (webview de l'application) ; le compte Express est créé au premier appel. */
  payoutLink(userId: string): Promise<{ url: string; expiresAt: string; simulated: boolean }> {
    return this.driverPayments.onboardingLink(userId);
  }
}
