/**
 * Neomoov Booster (phase 1, agent G) : rapports de vérification sommaire. Le chauffeur photographie son véhicule
 * (parcours guidé), l'API fait analyser les photos par le modèle (aide à la saisie), le chauffeur confirme ou corrige,
 * puis le rapport est archivé : PDF produit par le moteur des factures, rangé chez le dispatch (My Hub) et dans le
 * compte du chauffeur. Une défectuosité majeure est signalée au personnel. Les fichiers sont des clés de stockage
 * privé, servis par l'API ou par un lien signé de courte durée ; jamais d'adresse publique en base.
 */
import { schema } from '@neomoov/db';
import {
  BODY_ZONE_LABELS, defaultInspectionItems, INSPECTION_ITEM_LABELS, INSPECTION_ITEMS, inspectionItemsSchema, localDate, majorItems, normalizePlate, overallSeverity, PHOTO_KINDS,
  prefillFromAnalysis, type AdminInspectionListQuery, type AdminInspectionView, type BodyZoneEntry, type InspectionAnalysis, type InspectionAnalysisView, type InspectionConfirm,
  type InspectionCreateFields, type InspectionDownloadView, type InspectionItems, type InspectionListQuery, type InspectionUpdate, type MissingInspectionView, type Page,
  type VehicleInspectionView,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte, notExists, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, VIRUS_SCANNER, type StorageProvider, type VirusScanner } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { FieldCipher } from '../../common/field-cipher.js';
import { APP_LOGGER } from '../../common/logger.js';
import { currentOrgScope, storageKeyPrefix } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { BoosterJpegService } from './pdf-to-jpeg.js';
import { DriverProfileService, type DriverRow } from '../drivers/driver-profile.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { BoosterAnalysisService, INSPECTION_PROMPT_KEY } from './booster-analysis.service.js';
import { intakeImages, kindsOf, type StoredAnalysis, type UploadedImage } from './booster-images.js';
import { renderInspectionPdf } from './inspection-pdf.js';

type Row = typeof schema.vehicleInspections.$inferSelect;
interface DriverInfo { publicNumber: string; firstName: string | null; lastName: string | null; organizationId: string | null; userId: string }

const DRIVER_INFO = { publicNumber: schema.drivers.publicNumber, firstName: schema.users.firstName, lastName: schema.users.lastName, organizationId: schema.drivers.organizationId, userId: schema.drivers.userId };

export function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || null;
}

@Injectable()
export class InspectionsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    private readonly settings: SettingsService,
    private readonly profiles: DriverProfileService,
    private readonly analysis: BoosterAnalysisService,
    private readonly outbox: NotificationsOutbox,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
    private readonly jpegs: BoosterJpegService,
    private readonly fields: FieldCipher,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async limits() {
    const [enabled, min, max, maxBytes, linkSeconds, timeZone, companyName] = await Promise.all([
      this.settings.get<boolean>('booster.enabled', true),
      this.settings.number('booster.inspection_photos_min', 6),
      this.settings.number('booster.inspection_photos_max', 12),
      this.settings.number('booster.max_image_bytes', 10_485_760),
      this.settings.number('booster.download_link_seconds', 300),
      this.settings.string('service.time_zone', 'America/Toronto'),
      this.settings.string('company.legal_name', 'Neomoov'),
    ]);
    if (!enabled) throw new AppError('BOOSTER_DISABLED', 'Neomoov Booster n\'est pas offert pour le moment', 503);
    return { min, max, maxBytes, linkSeconds, timeZone, companyName };
  }

  // --- Vues ---------------------------------------------------------------------------------------------------------

  private items(row: Row): InspectionItems {
    const parsed = inspectionItemsSchema.safeParse(row.items);
    return parsed.success ? parsed.data : defaultInspectionItems();
  }

  private zones(row: Row): BodyZoneEntry[] {
    return Array.isArray(row.bodyZones) ? (row.bodyZones as BodyZoneEntry[]) : [];
  }

  private analysisView(row: Row): InspectionAnalysisView {
    const a = row.analysis as StoredAnalysis | null;
    if (!a) return { status: 'none', promptKey: null, model: null, analysedAt: null, confidence: null, summary: null, itemsFromAnalysis: [], warningLights: [], photosUnusable: [], error: null };
    if (a.error) return { status: 'failed', promptKey: a.promptKey, model: a.model, analysedAt: a.analysedAt, confidence: null, summary: null, itemsFromAnalysis: [], warningLights: [], photosUnusable: [], error: a.error };
    const raw = a.raw as InspectionAnalysis;
    const prefill = prefillFromAnalysis(raw);
    return {
      status: 'done', promptKey: a.promptKey, model: a.model, analysedAt: a.analysedAt, confidence: a.confidence, summary: raw.summary,
      itemsFromAnalysis: prefill.itemsFromAnalysis, warningLights: raw.warningLights, photosUnusable: prefill.photosUnusable, error: null,
    };
  }

  private baseView(row: Row) {
    return {
      id: row.id, driverId: row.driverId, vehicleId: row.vehicleId, status: row.status as VehicleInspectionView['status'], inspectedAt: row.inspectedAt.toISOString(),
      plate: row.plate, accessoryNumber: row.accessoryNumber, driverName: row.driverName, odometerKm: row.odometerKm, energyPercent: row.energyPercent,
      warningLightOn: row.warningLightOn, warningLightReason: row.warningLightReason, items: this.items(row), bodyZones: this.zones(row), allItemsChecked: row.allItemsChecked,
      severity: row.severity as VehicleInspectionView['severity'], notes: row.notes,
      photos: row.photos.map((p, index) => ({ index, kind: (PHOTO_KINDS as readonly string[]).includes(p.kind) ? (p.kind as VehicleInspectionView['photos'][number]['kind']) : 'other', contentType: p.contentType, bytes: p.bytes, uploadedAt: p.uploadedAt })),
      analysis: this.analysisView(row), confirmedAt: row.confirmedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null,
      formats: row.pdfKey ? (['pdf', 'jpeg'] as const).slice() : [], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  view(row: Row): VehicleInspectionView {
    return { ...this.baseView(row), licenceNumber: this.fields.decrypt(row.licenceNumber) };
  }

  adminView(row: Row, driver: DriverInfo): AdminInspectionView {
    const licence = this.fields.decrypt(row.licenceNumber);
    return { ...this.baseView(row), licenceNumberLast4: licence ? licence.slice(-4) : null, driverPublicNumber: driver.publicNumber, driverFullName: fullName(driver.firstName, driver.lastName), organizationId: driver.organizationId };
  }

  // --- Accès --------------------------------------------------------------------------------------------------------

  private async requireOwn(userId: string, id: string): Promise<{ driver: DriverRow; row: Row }> {
    const driver = await this.profiles.requireDriver(userId);
    const [row] = await this.db.select().from(schema.vehicleInspections).where(and(eq(schema.vehicleInspections.id, id), eq(schema.vehicleInspections.driverId, driver.id))).limit(1);
    if (!row) throw AppError.notFound('INSPECTION_NOT_FOUND', 'Rapport de vérification introuvable');
    return { driver, row };
  }

  private async requireRow(id: string): Promise<{ row: Row; driver: DriverInfo }> {
    const [found] = await this.db
      .select({ row: schema.vehicleInspections, driver: DRIVER_INFO })
      .from(schema.vehicleInspections)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.vehicleInspections.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.vehicleInspections.id, id))
      .limit(1);
    if (!found) throw AppError.notFound('INSPECTION_NOT_FOUND', 'Rapport de vérification introuvable');
    return found;
  }

  private assertEditable(row: Row): void {
    if (row.status === 'archived') throw AppError.conflict('INSPECTION_ARCHIVED', 'Ce rapport est archivé : il ne se modifie plus');
  }

  private async driverInfo(driver: DriverRow): Promise<DriverInfo> {
    const [user] = await this.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.users).where(eq(schema.users.id, driver.userId)).limit(1);
    return { publicNumber: driver.publicNumber, firstName: user?.firstName ?? null, lastName: user?.lastName ?? null, organizationId: driver.organizationId, userId: driver.userId };
  }

  private async vehicleOf(driver: DriverRow, vehicleId: string | null | undefined): Promise<{ id: string; plate: string; label: string } | null> {
    const id = vehicleId ?? driver.currentVehicleId;
    if (!id) return null;
    const [vehicle] = await this.db.select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model, year: schema.vehicles.year }).from(schema.vehicles).where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.driverId, driver.id))).limit(1);
    if (!vehicle) {
      if (vehicleId) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Véhicule introuvable');
      return null;
    }
    return { id: vehicle.id, plate: vehicle.plate, label: `${vehicle.make} ${vehicle.model} ${vehicle.year}` };
  }

  // --- Parcours du chauffeur ----------------------------------------------------------------------------------------

  /** Crée un rapport (brouillon) avec ses premières photos ; plaque et nom repris du véhicule courant et du compte. */
  async create(userId: string, fields: InspectionCreateFields, files: UploadedImage[]): Promise<VehicleInspectionView> {
    const driver = await this.profiles.requireDriver(userId);
    const limits = await this.limits();
    if (files.length > limits.max) throw new AppError('TOO_MANY_PHOTOS', `Au plus ${limits.max} photos par rapport`, 400, { max: limits.max });
    const vehicle = await this.vehicleOf(driver, fields.vehicleId);
    const info = await this.driverInfo(driver);
    const inspectedAt = fields.inspectedAt ? new Date(fields.inspectedAt) : new Date();
    const id = randomUUID();
    const photos = await intakeImages(files, kindsOf(fields.kinds, files.length, PHOTO_KINDS), { storage: this.storage, scanner: this.scanner, logger: this.logger, maxBytes: limits.maxBytes, folder: `booster/inspections/${id}`, reportId: id });
    const [row] = await this.db
      .insert(schema.vehicleInspections)
      .values({
        id, driverId: driver.id, vehicleId: vehicle?.id ?? null, inspectedAt, inspectedOn: localDate(inspectedAt, limits.timeZone).date,
        plate: normalizePlate(fields.plate ?? vehicle?.plate ?? null), accessoryNumber: fields.accessoryNumber || null, driverName: fields.driverName || fullName(info.firstName, info.lastName),
        licenceNumber: this.fields.encrypt(fields.licenceNumber), items: defaultInspectionItems(), bodyZones: [], photos, severity: 'ok',
      })
      .returning();
    this.logger.info({ inspectionId: id, driverId: driver.id, photos: photos.length }, 'Vérification sommaire ouverte');
    return this.view(row!);
  }

  /** Ajoute des photos à un rapport non archivé (reprise d'une étape du parcours). */
  async addPhotos(userId: string, id: string, fields: { kinds?: string | undefined }, files: UploadedImage[]): Promise<VehicleInspectionView> {
    const { row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const limits = await this.limits();
    if (!files.length) throw new AppError('FILE_REQUIRED', 'Au moins une photo est requise (champ `photos`)', 400);
    if (row.photos.length + files.length > limits.max) throw new AppError('TOO_MANY_PHOTOS', `Au plus ${limits.max} photos par rapport`, 400, { max: limits.max, current: row.photos.length });
    const photos = await intakeImages(files, kindsOf(fields.kinds, files.length, PHOTO_KINDS), { storage: this.storage, scanner: this.scanner, logger: this.logger, maxBytes: limits.maxBytes, folder: `booster/inspections/${id}`, reportId: id });
    const [updated] = await this.db.update(schema.vehicleInspections).set({ photos: [...row.photos, ...photos] }).where(eq(schema.vehicleInspections.id, id)).returning();
    return this.view(updated!);
  }

  /**
   * Analyse des photos par le modèle : les champs lus préremplissent le rapport (sans écraser une défectuosité déjà
   * saisie par le chauffeur) ; en cas d'échec, l'analyse est consignée et le rapport reste modifiable à la main.
   */
  async analyse(userId: string, id: string): Promise<VehicleInspectionView> {
    const { driver, row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const limits = await this.limits();
    if (row.photos.length < limits.min) throw new AppError('NOT_ENOUGH_PHOTOS', `Au moins ${limits.min} photos sont nécessaires pour l'analyse`, 400, { min: limits.min, current: row.photos.length });
    const attempt = row.analysisCount + 1;
    const vehicle = await this.vehicleOf(driver, row.vehicleId);
    const outcome = await this.analysis.analyseInspection({ inspectionId: id, driverId: driver.id, attempt, images: row.photos, plate: row.plate, vehicle: vehicle?.label ?? null });
    const analysedAt = new Date().toISOString();
    if (!outcome.ok) {
      const analysis: StoredAnalysis = { promptKey: INSPECTION_PROMPT_KEY, model: outcome.model, analysedAt, confidence: null, raw: null, error: outcome.error };
      const [updated] = await this.db.update(schema.vehicleInspections).set({ analysis, analysisCount: attempt }).where(eq(schema.vehicleInspections.id, id)).returning();
      return this.view(updated!);
    }
    const prefill = prefillFromAnalysis(outcome.output, this.items(row));
    const existingZones = this.zones(row);
    const bodyZones = [...existingZones, ...prefill.bodyZones.filter((z) => !existingZones.some((e) => e.zone === z.zone))];
    const analysis: StoredAnalysis = { promptKey: INSPECTION_PROMPT_KEY, model: outcome.model, analysedAt, confidence: prefill.confidence, raw: outcome.output, error: null };
    const warningLightOn = row.warningLightOn || prefill.warningLightOn;
    const [updated] = await this.db
      .update(schema.vehicleInspections)
      .set({
        status: 'analysed', analysis, analysisCount: attempt, items: prefill.items, bodyZones,
        odometerKm: row.odometerKm ?? prefill.odometerKm, energyPercent: row.energyPercent ?? prefill.energyPercent, plate: row.plate ?? prefill.plate,
        warningLightOn, warningLightReason: row.warningLightReason ?? prefill.warningLightReason, severity: overallSeverity(prefill.items, bodyZones),
      })
      .where(eq(schema.vehicleInspections.id, id))
      .returning();
    this.logger.info({ inspectionId: id, driverId: driver.id, confidence: prefill.confidence, severity: updated!.severity, runId: outcome.runId }, 'Vérification sommaire analysée');
    return this.view(updated!);
  }

  private patchOf(row: Row, body: InspectionUpdate): Partial<typeof schema.vehicleInspections.$inferInsert> {
    const patch: Partial<typeof schema.vehicleInspections.$inferInsert> = {};
    if (body.inspectedAt !== undefined) patch.inspectedAt = new Date(body.inspectedAt);
    if (body.vehicleId !== undefined) patch.vehicleId = body.vehicleId;
    if (body.plate !== undefined) patch.plate = normalizePlate(body.plate);
    if (body.accessoryNumber !== undefined) patch.accessoryNumber = body.accessoryNumber || null;
    if (body.driverName !== undefined) patch.driverName = body.driverName || null;
    if (body.licenceNumber !== undefined) patch.licenceNumber = this.fields.encrypt(body.licenceNumber);
    if (body.odometerKm !== undefined) patch.odometerKm = body.odometerKm;
    if (body.energyPercent !== undefined) patch.energyPercent = body.energyPercent;
    if (body.warningLightOn !== undefined) patch.warningLightOn = body.warningLightOn;
    if (body.warningLightReason !== undefined) patch.warningLightReason = body.warningLightReason || null;
    if (body.items !== undefined) patch.items = body.items;
    if (body.bodyZones !== undefined) patch.bodyZones = body.bodyZones;
    if (body.allItemsChecked !== undefined) patch.allItemsChecked = body.allItemsChecked;
    if (body.notes !== undefined) patch.notes = body.notes || null;
    const items = body.items ?? this.items(row);
    const zones = body.bodyZones ?? this.zones(row);
    patch.severity = overallSeverity(items, zones);
    return patch;
  }

  /** Corrections du chauffeur avant l'archivage. */
  async update(userId: string, id: string, body: InspectionUpdate): Promise<VehicleInspectionView> {
    const { driver, row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    if (body.vehicleId) await this.vehicleOf(driver, body.vehicleId);
    const patch = this.patchOf(row, body);
    if (patch.inspectedAt) patch.inspectedOn = localDate(patch.inspectedAt as Date, (await this.limits()).timeZone).date;
    const [updated] = await this.db.update(schema.vehicleInspections).set(patch).where(eq(schema.vehicleInspections.id, id)).returning();
    return this.view(updated!);
  }

  /**
   * Confirmation et archivage : le chauffeur atteste la vérification de tous les éléments ; plaque et nom exigés
   * (contenu du rapport, article 66). PDF produit et rangé ; événement de domaine ; alerte du personnel si majeure.
   */
  async confirm(userId: string, id: string, body: InspectionConfirm): Promise<VehicleInspectionView> {
    const { driver, row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const limits = await this.limits();
    if (body.vehicleId) await this.vehicleOf(driver, body.vehicleId);
    const patch = this.patchOf(row, body);
    const merged = { ...row, ...patch } as Row;
    const missing = [!merged.plate ? 'plate' : null, !merged.driverName ? 'driverName' : null].filter((f): f is string => Boolean(f));
    if (missing.length) throw new AppError('INSPECTION_INCOMPLETE', 'La plaque et le nom du chauffeur sont requis pour archiver le rapport', 400, { fields: missing });
    const now = new Date();
    const info = await this.driverInfo(driver);
    const vehicle = await this.vehicleOf(driver, merged.vehicleId);
    const confirmedView: VehicleInspectionView = { ...this.view({ ...merged, confirmedAt: now, archivedAt: now, allItemsChecked: true, status: 'archived' }), confirmedAt: now.toISOString() };
    const photos: Array<{ kind: string; contentType: string; body: Buffer }> = [];
    for (const photo of merged.photos) {
      const object = await this.storage.getObject(photo.key).catch(() => null);
      if (object) photos.push({ kind: photo.kind, contentType: object.contentType, body: object.body });
    }
    const pdf = await renderInspectionPdf({ inspection: confirmedView, driverPublicNumber: info.publicNumber, driverFullName: fullName(info.firstName, info.lastName), vehicle: vehicle?.label ?? null, photos, companyName: limits.companyName, timeZone: limits.timeZone });
    const pdfKey = `${storageKeyPrefix(currentOrgScope()?.organizationId)}booster/inspections/${id}/rapport-${merged.inspectedOn}.pdf`;
    await this.storage.putObject({ key: pdfKey, body: pdf, contentType: 'application/pdf' });
    const [updated] = await this.db
      .update(schema.vehicleInspections)
      .set({ ...patch, allItemsChecked: true, status: 'archived', confirmedAt: now, archivedAt: now, pdfKey, ...(patch.inspectedAt ? { inspectedOn: localDate(patch.inspectedAt as Date, limits.timeZone).date } : {}) })
      .where(eq(schema.vehicleInspections.id, id))
      .returning();
    const majors = majorItems(this.items(updated!));
    this.audit.record({ action: 'booster.inspection_archived', entity: 'vehicle_inspections', entityId: id, after: { severity: updated!.severity, majorItems: majors, photos: updated!.photos.length } });
    this.events.emit('booster.inspection_archived', { inspectionId: id, driverId: driver.id, severity: updated!.severity as VehicleInspectionView['severity'], organizationId: updated!.organizationId ?? driver.organizationId ?? null, majorItems: majors });
    if (updated!.severity === 'major') {
      await this.outbox.queueForStaff('alert.inspection_major', {
        inspectionId: id, driverId: driver.id, driverPublicNumber: info.publicNumber, driverName: updated!.driverName ?? fullName(info.firstName, info.lastName) ?? info.publicNumber,
        plate: updated!.plate, items: majors.map((item) => INSPECTION_ITEM_LABELS[item].fr).join(', '), zones: this.zones(updated!).map((z) => BODY_ZONE_LABELS[z.zone].fr).join(', '),
      });
      this.logger.warn({ inspectionId: id, driverId: driver.id, majorItems: majors }, 'Vérification sommaire : défectuosité majeure signalée au dispatch');
    }
    return this.view(updated!);
  }

  async list(userId: string, query: InspectionListQuery): Promise<Page<VehicleInspectionView>> {
    const driver = await this.profiles.requireDriver(userId);
    const where = and(eq(schema.vehicleInspections.driverId, driver.id), ...this.filters(query));
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.vehicleInspections).where(where).orderBy(desc(schema.vehicleInspections.inspectedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.vehicleInspections).where(where),
    ]);
    return { items: rows.map((r) => this.view(r)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  private filters(query: { from?: string | undefined; to?: string | undefined; status?: string | undefined }): SQL[] {
    const out: SQL[] = [];
    if (query.from) out.push(gte(schema.vehicleInspections.inspectedOn, query.from));
    if (query.to) out.push(lte(schema.vehicleInspections.inspectedOn, query.to));
    if (query.status) out.push(eq(schema.vehicleInspections.status, query.status));
    return out;
  }

  async get(userId: string, id: string): Promise<VehicleInspectionView> {
    return this.view((await this.requireOwn(userId, id)).row);
  }

  private async photoOf(row: Row, index: number): Promise<{ body: Buffer; contentType: string }> {
    const photo = row.photos[index];
    if (!photo) throw AppError.notFound('PHOTO_NOT_FOUND', 'Photo introuvable');
    const object = await this.storage.getObject(photo.key);
    if (!object) throw AppError.notFound('PHOTO_FILE_NOT_FOUND', 'Fichier de la photo introuvable dans le stockage (purgé après le délai de conservation)');
    return object;
  }

  private async pdfOf(row: Row): Promise<{ body: Buffer; contentType: string }> {
    if (!row.pdfKey) throw AppError.conflict('INSPECTION_NOT_ARCHIVED', 'Le PDF n\'existe qu\'une fois le rapport archivé');
    const object = await this.storage.getObject(row.pdfKey);
    if (!object) throw AppError.notFound('PDF_NOT_FOUND', 'Fichier PDF introuvable dans le stockage');
    return object;
  }

  async photo(userId: string, id: string, index: number) {
    return this.photoOf((await this.requireOwn(userId, id)).row, index);
  }

  async pdf(userId: string, id: string) {
    return this.pdfOf((await this.requireOwn(userId, id)).row);
  }

  async jpeg(userId: string, id: string) {
    return this.jpegOf((await this.requireOwn(userId, id)).row);
  }

  /** Copie JPEG du PDF archivé (pages empilées), rendue une fois puis gardée à côté du PDF. */
  private async jpegOf(row: Row): Promise<{ body: Buffer; contentType: string }> {
    if (!row.pdfKey) throw AppError.conflict('INSPECTION_NOT_ARCHIVED', 'Le PDF n\'existe qu\'une fois le rapport archivé');
    const { body, contentType } = await this.jpegs.ensure(row.pdfKey);
    return { body, contentType };
  }

  /** Lien signé de courte durée (ouvert par l'application dans le navigateur) : PDF, ou sa copie JPEG. */
  async download(userId: string, id: string, format: 'pdf' | 'jpeg' = 'pdf'): Promise<InspectionDownloadView> {
    const { row } = await this.requireOwn(userId, id);
    if (!row.pdfKey) throw AppError.conflict('INSPECTION_NOT_ARCHIVED', 'Le PDF n\'existe qu\'une fois le rapport archivé');
    const key = format === 'jpeg' ? (await this.jpegs.ensure(row.pdfKey)).key : row.pdfKey;
    const seconds = (await this.limits()).linkSeconds;
    return { format, url: await this.storage.getSignedUrl(key, seconds), expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
  }

  /** Une inspection archivée ce jour-là (alertes, dispatch). */
  async hasArchivedOn(driverId: string, date: string): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.vehicleInspections.id }).from(schema.vehicleInspections).where(and(eq(schema.vehicleInspections.driverId, driverId), eq(schema.vehicleInspections.inspectedOn, date), eq(schema.vehicleInspections.status, 'archived'))).limit(1);
    return Boolean(row);
  }

  // --- Dispatch (My Hub) --------------------------------------------------------------------------------------------

  async adminList(query: AdminInspectionListQuery): Promise<Page<AdminInspectionView>> {
    const conditions = this.filters(query);
    if (query.driverId) conditions.push(eq(schema.vehicleInspections.driverId, query.driverId));
    if (query.date) conditions.push(eq(schema.vehicleInspections.inspectedOn, query.date));
    if (query.majorOnly) conditions.push(eq(schema.vehicleInspections.severity, 'major'));
    const where = conditions.length ? and(...conditions) : undefined;
    const base = () => this.db.select({ row: schema.vehicleInspections, driver: DRIVER_INFO }).from(schema.vehicleInspections).innerJoin(schema.drivers, eq(schema.drivers.id, schema.vehicleInspections.driverId)).innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId));
    const [rows, [total]] = await Promise.all([
      base().where(where).orderBy(desc(schema.vehicleInspections.inspectedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.vehicleInspections).where(where),
    ]);
    return { items: rows.map((r) => this.adminView(r.row, r.driver)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async adminGet(id: string): Promise<AdminInspectionView> {
    const found = await this.requireRow(id);
    return this.adminView(found.row, found.driver);
  }

  async adminPhoto(id: string, index: number) {
    return this.photoOf((await this.requireRow(id)).row, index);
  }

  async adminPdf(id: string) {
    return this.pdfOf((await this.requireRow(id)).row);
  }

  async adminJpeg(id: string) {
    return this.jpegOf((await this.requireRow(id)).row);
  }

  /** Chauffeurs en ligne sans rapport archivé aujourd'hui. */
  async missingToday(): Promise<MissingInspectionView[]> {
    const today = localDate(new Date(), await this.settings.string('service.time_zone', 'America/Toronto')).date;
    const rows = await this.db
      .select({ driverId: schema.drivers.id, driver: DRIVER_INFO })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(and(
        eq(schema.drivers.isOnline, true),
        notExists(this.db.select({ one: sql`1` }).from(schema.vehicleInspections).where(and(eq(schema.vehicleInspections.driverId, schema.drivers.id), eq(schema.vehicleInspections.inspectedOn, today), eq(schema.vehicleInspections.status, 'archived')))),
      ))
      .orderBy(schema.drivers.publicNumber);
    return rows.map((r) => ({ driverId: r.driverId, driverPublicNumber: r.driver.publicNumber, driverFullName: fullName(r.driver.firstName, r.driver.lastName), organizationId: r.driver.organizationId, onlineSince: null }));
  }

  /** Export CSV (séparateur « ; », comme les autres exports) des rapports archivés d'une période. */
  async exportCsv(query: { from?: string | undefined; to?: string | undefined; driverId?: string | undefined }): Promise<string> {
    const conditions = [eq(schema.vehicleInspections.status, 'archived'), ...this.filters(query)];
    if (query.driverId) conditions.push(eq(schema.vehicleInspections.driverId, query.driverId));
    const rows = await this.db
      .select({ row: schema.vehicleInspections, driver: DRIVER_INFO })
      .from(schema.vehicleInspections)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.vehicleInspections.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(and(...conditions))
      .orderBy(desc(schema.vehicleInspections.inspectedAt))
      .limit(5000);
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['date', 'heure', 'chauffeur', 'nom', 'plaque', 'odometre_km', 'energie_pct', 'gravite', 'voyant', 'elements_non_conformes', 'zones', 'archive_le'].join(';')];
    for (const r of rows) {
      const items = this.items(r.row);
      const bad = INSPECTION_ITEMS.filter((i) => items[i].state === 'minor' || items[i].state === 'major').map((i) => `${INSPECTION_ITEM_LABELS[i].fr} (${items[i].state})`).join(', ');
      lines.push([
        r.row.inspectedOn, r.row.inspectedAt.toISOString().slice(11, 16), r.driver.publicNumber, fullName(r.driver.firstName, r.driver.lastName) ?? '', r.row.plate ?? '', r.row.odometerKm ?? '', r.row.energyPercent ?? '',
        r.row.severity, r.row.warningLightOn ? r.row.warningLightReason ?? 'oui' : 'non', bad, this.zones(r.row).map((z) => BODY_ZONE_LABELS[z.zone].fr).join(', '), r.row.archivedAt?.toISOString() ?? '',
      ].map(cell).join(';'));
    }
    return `${lines.join('\n')}\n`;
  }
}
