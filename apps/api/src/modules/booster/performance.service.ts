/**
 * Neomoov Booster (phase 1, agent G) : rapports de performance des sessions. Saisie du chauffeur (départ, arrivée),
 * lecture facultative de captures d'écran par le modèle (aide à la saisie, confirmée par le chauffeur), calculs du
 * domaine, récapitulatifs par semaine et par mois, PDF à la confirmation ; liste et export côté dispatch.
 */
import { schema } from '@neomoov/db';
import {
  aggregatePerformance, isoWeekLabel, localDate, performanceSummary, periodBounds, prefillFromReading, type AdminPerformanceLogView, type Page, type PerformanceFigures,
  type PerformanceListQuery, type PerformanceLogInput, type PerformanceLogView, type PerformanceReading, type PerformanceRecapQuery, type PerformanceRecapView,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, VIRUS_SCANNER, type StorageProvider, type VirusScanner } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { afterOrgScopeCommit, currentOrgScope, storageKeyPrefix } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AgentJobsService } from '../agents/agent-jobs.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BoosterJpegService } from './pdf-to-jpeg.js';
import { DriverProfileService, type DriverRow } from '../drivers/driver-profile.service.js';
import { ANALYSIS_TIMEOUT, analysisState, isBoosterAnalysisJob, PERFORMANCE_ANALYSIS_JOB, pendingAnalysis } from './booster-async.js';
import { BoosterAnalysisService, PERFORMANCE_PROMPT_KEY } from './booster-analysis.service.js';
import { intakeImages, type StoredAnalysis, type UploadedImage } from './booster-images.js';
import { fullName } from './inspections.service.js';
import { renderPerformancePdf } from './performance-pdf.js';

type Row = typeof schema.performanceLogs.$inferSelect;
interface DriverInfo { publicNumber: string; firstName: string | null; lastName: string | null; organizationId: string | null }
const DRIVER_INFO = { publicNumber: schema.drivers.publicNumber, firstName: schema.users.firstName, lastName: schema.users.lastName, organizationId: schema.drivers.organizationId };

/** Instant d'une heure civile (`HH:MM`) d'une date dans un fuseau : décalage mesuré sur la date elle-même (heure avancée comprise). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  const localOfGuess = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return new Date(guess.getTime() - (localOfGuess - guess.getTime()));
}

function figuresOf(row: Row): PerformanceFigures {
  return {
    startedAt: row.startedAt, endedAt: row.endedAt, startEnergyPercent: row.startEnergyPercent, endEnergyPercent: row.endEnergyPercent, startOdometerKm: row.startOdometerKm, endOdometerKm: row.endOdometerKm,
    onlineMinutes: row.onlineMinutes, drivingMinutes: row.drivingMinutes, ridesCount: row.ridesCount, ridesCents: row.ridesCents, tipsCents: row.tipsCents, promotionsCents: row.promotionsCents,
    energyCents: row.energyCents, cleaningCents: row.cleaningCents,
  };
}

@Injectable()
export class PerformanceService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    private readonly settings: SettingsService,
    private readonly profiles: DriverProfileService,
    private readonly analysis: BoosterAnalysisService,
    private readonly audit: AuditService,
    private readonly jpegs: BoosterJpegService,
    private readonly queues: QueueService,
    private readonly agentJobs: AgentJobsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Lecture asynchrone : la tâche `booster.performance` de la file `agents` est traitée ici (API sans Redis, worker avec Redis). */
  onModuleInit() {
    this.agentJobs.registerHandler(PERFORMANCE_ANALYSIS_JOB, async (data) => {
      if (isBoosterAnalysisJob(data)) await this.runAnalysis(data.id, data.attempt);
    });
  }

  private async limits() {
    const [enabled, max, maxBytes, linkSeconds, timeZone, companyName] = await Promise.all([
      this.settings.get<boolean>('booster.enabled', true),
      this.settings.number('booster.performance_screenshots_max', 6),
      this.settings.number('booster.max_image_bytes', 10_485_760),
      this.settings.number('booster.download_link_seconds', 300),
      this.settings.string('service.time_zone', 'America/Toronto'),
      this.settings.string('company.legal_name', 'Neomoov'),
    ]);
    if (!enabled) throw new AppError('BOOSTER_DISABLED', 'Neomoov Booster n\'est pas offert pour le moment', 503);
    return { max, maxBytes, linkSeconds, timeZone, companyName };
  }

  // --- Vues ---------------------------------------------------------------------------------------------------------

  private readingView(row: Row): PerformanceLogView['reading'] {
    const a = row.analysis as StoredAnalysis | null;
    const state = analysisState(a);
    if (!a) return { status: 'none', promptKey: null, model: null, analysedAt: null, confidence: null, summary: null, app: null, photosUnusable: [], error: null };
    // Lecture confiée à la file `agents` : en cours, ou réputée perdue après 10 minutes (relançable).
    if (state === 'pending') return { status: 'pending', promptKey: a.promptKey, model: null, analysedAt: null, confidence: null, summary: null, app: null, photosUnusable: [], error: null };
    if (state === 'stale') return { status: 'failed', promptKey: a.promptKey, model: null, analysedAt: null, confidence: null, summary: null, app: null, photosUnusable: [], error: ANALYSIS_TIMEOUT };
    if (a.error) return { status: 'failed', promptKey: a.promptKey, model: a.model, analysedAt: a.analysedAt, confidence: null, summary: null, app: null, photosUnusable: [], error: a.error };
    const raw = a.raw as PerformanceReading;
    const prefill = prefillFromReading(raw);
    return { status: 'done', promptKey: a.promptKey, model: a.model, analysedAt: a.analysedAt, confidence: a.confidence, summary: raw.summary, app: prefill.app, photosUnusable: prefill.photosUnusable, error: null };
  }

  view(row: Row): PerformanceLogView {
    return {
      id: row.id, driverId: row.driverId, status: row.status as PerformanceLogView['status'], date: row.date, startedAt: row.startedAt?.toISOString() ?? null, endedAt: row.endedAt?.toISOString() ?? null,
      startEnergyPercent: row.startEnergyPercent, endEnergyPercent: row.endEnergyPercent, startOdometerKm: row.startOdometerKm, endOdometerKm: row.endOdometerKm, onlineMinutes: row.onlineMinutes,
      drivingMinutes: row.drivingMinutes, ridesCount: row.ridesCount, ridesCents: row.ridesCents, tipsCents: row.tipsCents, promotionsCents: row.promotionsCents, energyCents: row.energyCents,
      cleaningCents: row.cleaningCents, points: row.points, otherNotes: row.otherNotes, source: row.source as PerformanceLogView['source'],
      screenshots: row.screenshots.map((s, index) => ({ index, contentType: s.contentType, bytes: s.bytes, uploadedAt: s.uploadedAt })),
      reading: this.readingView(row), summary: performanceSummary(figuresOf(row)), confirmedAt: row.confirmedAt?.toISOString() ?? null, formats: row.pdfKey ? ['pdf', 'jpeg'] : [],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  adminView(row: Row, driver: DriverInfo): AdminPerformanceLogView {
    return { ...this.view(row), driverPublicNumber: driver.publicNumber, driverFullName: fullName(driver.firstName, driver.lastName), organizationId: driver.organizationId };
  }

  // --- Accès --------------------------------------------------------------------------------------------------------

  private async requireOwn(userId: string, id: string): Promise<{ driver: DriverRow; row: Row }> {
    const driver = await this.profiles.requireDriver(userId);
    const [row] = await this.db.select().from(schema.performanceLogs).where(and(eq(schema.performanceLogs.id, id), eq(schema.performanceLogs.driverId, driver.id))).limit(1);
    if (!row) throw AppError.notFound('PERFORMANCE_LOG_NOT_FOUND', 'Rapport de performance introuvable');
    return { driver, row };
  }

  private async requireRow(id: string): Promise<{ row: Row; driver: DriverInfo }> {
    const [found] = await this.db.select({ row: schema.performanceLogs, driver: DRIVER_INFO }).from(schema.performanceLogs)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.performanceLogs.driverId)).innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.performanceLogs.id, id)).limit(1);
    if (!found) throw AppError.notFound('PERFORMANCE_LOG_NOT_FOUND', 'Rapport de performance introuvable');
    return found;
  }

  private assertEditable(row: Row): void {
    if (row.status === 'confirmed') throw AppError.conflict('PERFORMANCE_LOG_CONFIRMED', 'Ce rapport est confirmé : il ne se modifie plus');
  }

  private patchOf(body: PerformanceLogInput): Partial<typeof schema.performanceLogs.$inferInsert> {
    const patch: Partial<typeof schema.performanceLogs.$inferInsert> = {};
    if (body.date !== undefined) patch.date = body.date;
    if (body.startedAt !== undefined) patch.startedAt = body.startedAt ? new Date(body.startedAt) : null;
    if (body.endedAt !== undefined) patch.endedAt = body.endedAt ? new Date(body.endedAt) : null;
    for (const key of ['startEnergyPercent', 'endEnergyPercent', 'startOdometerKm', 'endOdometerKm', 'onlineMinutes', 'drivingMinutes', 'ridesCount', 'points'] as const) if (body[key] !== undefined) patch[key] = body[key];
    for (const key of ['ridesCents', 'tipsCents', 'promotionsCents', 'energyCents', 'cleaningCents'] as const) if (body[key] !== undefined) patch[key] = body[key];
    if (body.otherNotes !== undefined) patch.otherNotes = body.otherNotes || null;
    return patch;
  }

  // --- Parcours du chauffeur ----------------------------------------------------------------------------------------

  async create(userId: string, body: PerformanceLogInput): Promise<PerformanceLogView> {
    const driver = await this.profiles.requireDriver(userId);
    const limits = await this.limits();
    const patch = this.patchOf(body);
    const [row] = await this.db.insert(schema.performanceLogs).values({ driverId: driver.id, date: body.date ?? localDate(new Date(), limits.timeZone).date, ...patch }).returning();
    return this.view(row!);
  }

  async update(userId: string, id: string, body: PerformanceLogInput): Promise<PerformanceLogView> {
    const { row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const [updated] = await this.db.update(schema.performanceLogs).set(this.patchOf(body)).where(eq(schema.performanceLogs.id, id)).returning();
    return this.view(updated!);
  }

  async addScreenshots(userId: string, id: string, files: UploadedImage[]): Promise<PerformanceLogView> {
    const { row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const limits = await this.limits();
    if (!files.length) throw new AppError('FILE_REQUIRED', 'Au moins une capture est requise (champ `screenshots`)', 400);
    if (row.screenshots.length + files.length > limits.max) throw new AppError('TOO_MANY_SCREENSHOTS', `Au plus ${limits.max} captures par rapport`, 400, { max: limits.max, current: row.screenshots.length });
    const stored = await intakeImages(files, files.map(() => 'screenshot'), { storage: this.storage, scanner: this.scanner, logger: this.logger, maxBytes: limits.maxBytes, folder: `booster/performance/${id}`, reportId: id });
    const [updated] = await this.db.update(schema.performanceLogs).set({ screenshots: [...row.screenshots, ...stored], source: 'screenshot' }).where(eq(schema.performanceLogs.id, id)).returning();
    return this.view(updated!);
  }

  /** Lecture des captures : les champs lus remplissent ceux encore vides (nuls ou à zéro) ; le chauffeur confirme ensuite. */
  async analyse(userId: string, id: string, options: { async?: boolean } = {}): Promise<PerformanceLogView> {
    const { row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    if (!row.screenshots.length) throw new AppError('NO_SCREENSHOTS', 'Ajoutez au moins une capture d\'écran avant la lecture', 400);
    if (options.async ?? (await this.settings.get<unknown>('booster.analysis_async', false)) === true) return this.queueAnalysis(row);
    return this.analyseRow(row, row.analysisCount + 1);
  }

  /** Lecture confiée à la file `agents` (finalisation du 3 octobre 2026) : état `pending`, tâche mise en file après la validation. */
  private async queueAnalysis(row: Row): Promise<PerformanceLogView> {
    if (analysisState(row.analysis as StoredAnalysis | null) === 'pending') return this.view(row);
    const attempt = row.analysisCount + 1;
    const [updated] = await this.db
      .update(schema.performanceLogs)
      .set({ analysis: pendingAnalysis(PERFORMANCE_PROMPT_KEY, attempt), analysisCount: attempt })
      .where(and(eq(schema.performanceLogs.id, row.id), eq(schema.performanceLogs.analysisCount, row.analysisCount)))
      .returning();
    if (!updated) throw AppError.conflict('ANALYSIS_IN_PROGRESS', 'Une lecture de ce rapport vient d\'être lancée');
    afterOrgScopeCommit(() => void this.enqueueAnalysis(row.id, attempt));
    return this.view(updated);
  }

  /** Mise en file de la tâche ; un échec de la file est consigné dans le rapport (relançable). */
  private async enqueueAnalysis(id: string, attempt: number): Promise<void> {
    try {
      await this.queues.add('agents', PERFORMANCE_ANALYSIS_JOB, { id, attempt }, { jobId: `${PERFORMANCE_ANALYSIS_JOB}-${id}-${attempt}` });
    } catch (error) {
      this.logger.error({ err: error, logId: id }, 'Lecture des captures non confiée à la file agents');
      const analysis: StoredAnalysis = { promptKey: PERFORMANCE_PROMPT_KEY, model: null, analysedAt: new Date().toISOString(), confidence: null, raw: null, error: 'QUEUE_UNAVAILABLE' };
      await this.db.update(schema.performanceLogs).set({ analysis }).where(eq(schema.performanceLogs.id, id)).catch(() => undefined);
    }
  }

  /** Tâche `booster.performance` : rapport relu au moment de la lecture ; tentative remplacée ou rapport confirmé ignorés. */
  async runAnalysis(id: string, attempt: number): Promise<PerformanceLogView | null> {
    const [row] = await this.db.select().from(schema.performanceLogs).where(eq(schema.performanceLogs.id, id)).limit(1);
    const stored = row?.analysis as StoredAnalysis | null | undefined;
    if (!row || row.status === 'confirmed' || !stored?.pending || stored.attempt !== attempt) return null;
    try {
      return await this.analyseRow(row, attempt);
    } catch (error) {
      this.logger.error({ err: error, logId: id }, 'Lecture asynchrone des captures en échec');
      const analysis: StoredAnalysis = { promptKey: PERFORMANCE_PROMPT_KEY, model: null, analysedAt: new Date().toISOString(), confidence: null, raw: null, error: error instanceof AppError ? error.code : 'ANALYSIS_FAILED' };
      const [updated] = await this.db.update(schema.performanceLogs).set({ analysis }).where(eq(schema.performanceLogs.id, id)).returning();
      return updated ? this.view(updated) : null;
    }
  }

  private async analyseRow(row: Row, attempt: number): Promise<PerformanceLogView> {
    const id = row.id;
    const driver = { id: row.driverId };
    const outcome = await this.analysis.readPerformance({ logId: id, driverId: driver.id, attempt, images: row.screenshots, date: row.date });
    const analysedAt = new Date().toISOString();
    if (!outcome.ok) {
      const analysis: StoredAnalysis = { promptKey: PERFORMANCE_PROMPT_KEY, model: outcome.model, analysedAt, confidence: null, raw: null, error: outcome.error };
      const [updated] = await this.db.update(schema.performanceLogs).set({ analysis, analysisCount: attempt }).where(eq(schema.performanceLogs.id, id)).returning();
      return this.view(updated!);
    }
    const prefill = prefillFromReading(outcome.output);
    const analysis: StoredAnalysis = { promptKey: PERFORMANCE_PROMPT_KEY, model: outcome.model, analysedAt, confidence: prefill.confidence, raw: outcome.output, error: null };
    const timeZone = (await this.limits()).timeZone;
    const timeOn = (time: string | null, current: Date | null): Date | null => (current || !time ? current : zonedTimeToUtc(row.date, time, timeZone));
    const [updated] = await this.db
      .update(schema.performanceLogs)
      .set({
        status: 'analysed', analysis, analysisCount: attempt, source: 'screenshot',
        ridesCents: row.ridesCents || (prefill.ridesCents ?? 0), tipsCents: row.tipsCents || (prefill.tipsCents ?? 0), promotionsCents: row.promotionsCents || (prefill.promotionsCents ?? 0),
        ridesCount: row.ridesCount ?? prefill.ridesCount, onlineMinutes: row.onlineMinutes ?? prefill.onlineMinutes, drivingMinutes: row.drivingMinutes ?? prefill.drivingMinutes,
        startedAt: timeOn(prefill.startedTime, row.startedAt), endedAt: timeOn(prefill.endedTime, row.endedAt),
      })
      .where(eq(schema.performanceLogs.id, id))
      .returning();
    this.logger.info({ logId: id, driverId: driver.id, confidence: prefill.confidence, runId: outcome.runId }, 'Rapport de performance lu sur captures');
    return this.view(updated!);
  }

  /** Confirmation par le chauffeur : rapport figé, PDF produit. */
  async confirm(userId: string, id: string, body: PerformanceLogInput): Promise<PerformanceLogView> {
    const { driver, row } = await this.requireOwn(userId, id);
    this.assertEditable(row);
    const limits = await this.limits();
    const patch = this.patchOf(body);
    const now = new Date();
    const merged = { ...row, ...patch, confirmedAt: now, status: 'confirmed' } as Row;
    const [user] = await this.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.users).where(eq(schema.users.id, driver.userId)).limit(1);
    const pdf = await renderPerformancePdf({ log: this.view(merged), driverPublicNumber: driver.publicNumber, driverFullName: fullName(user?.firstName ?? null, user?.lastName ?? null), companyName: limits.companyName, timeZone: limits.timeZone });
    const pdfKey = `${storageKeyPrefix(currentOrgScope()?.organizationId)}booster/performance/${id}/rapport-${merged.date}.pdf`;
    await this.storage.putObject({ key: pdfKey, body: pdf, contentType: 'application/pdf' });
    const [updated] = await this.db.update(schema.performanceLogs).set({ ...patch, status: 'confirmed', confirmedAt: now, pdfKey }).where(eq(schema.performanceLogs.id, id)).returning();
    this.audit.record({ action: 'booster.performance_confirmed', entity: 'performance_logs', entityId: id, after: { date: updated!.date, source: updated!.source } });
    return this.view(updated!);
  }

  private filters(query: { from?: string | undefined; to?: string | undefined; status?: string | undefined }): SQL[] {
    const out: SQL[] = [];
    if (query.from) out.push(gte(schema.performanceLogs.date, query.from));
    if (query.to) out.push(lte(schema.performanceLogs.date, query.to));
    if (query.status) out.push(eq(schema.performanceLogs.status, query.status));
    return out;
  }

  async list(userId: string, query: PerformanceListQuery): Promise<Page<PerformanceLogView>> {
    const driver = await this.profiles.requireDriver(userId);
    const where = and(eq(schema.performanceLogs.driverId, driver.id), ...this.filters(query));
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.performanceLogs).where(where).orderBy(desc(schema.performanceLogs.date), desc(schema.performanceLogs.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.performanceLogs).where(where),
    ]);
    return { items: rows.map((r) => this.view(r)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async get(userId: string, id: string): Promise<PerformanceLogView> {
    return this.view((await this.requireOwn(userId, id)).row);
  }

  /** Récapitulatif d'une période (sessions confirmées) pour un chauffeur. */
  private async recapOf(driverId: string, query: PerformanceRecapQuery): Promise<PerformanceRecapView> {
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const date = query.date ?? localDate(new Date(), timeZone).date;
    const { start, end } = periodBounds(date, query.period);
    const rows = await this.db.select().from(schema.performanceLogs)
      .where(and(eq(schema.performanceLogs.driverId, driverId), eq(schema.performanceLogs.status, 'confirmed'), gte(schema.performanceLogs.date, start), lte(schema.performanceLogs.date, end)))
      .orderBy(desc(schema.performanceLogs.date), desc(schema.performanceLogs.createdAt));
    const sessions = rows.map((r) => this.view(r));
    const totals = aggregatePerformance(rows.map((r) => ({ figures: figuresOf(r), summary: performanceSummary(figuresOf(r)) })));
    return { period: query.period, start, end, label: query.period === 'week' ? isoWeekLabel(start) : start.slice(0, 7), totals, sessions };
  }

  async recap(userId: string, query: PerformanceRecapQuery): Promise<PerformanceRecapView> {
    return this.recapOf((await this.profiles.requireDriver(userId)).id, query);
  }

  private async pdfOf(row: Row): Promise<{ body: Buffer; contentType: string }> {
    if (!row.pdfKey) throw AppError.conflict('PERFORMANCE_LOG_NOT_CONFIRMED', 'Le PDF n\'existe qu\'une fois le rapport confirmé');
    const object = await this.storage.getObject(row.pdfKey);
    if (!object) throw AppError.notFound('PDF_NOT_FOUND', 'Fichier PDF introuvable dans le stockage');
    return object;
  }

  async pdf(userId: string, id: string) {
    return this.pdfOf((await this.requireOwn(userId, id)).row);
  }

  async jpeg(userId: string, id: string) {
    return this.jpegOf((await this.requireOwn(userId, id)).row);
  }

  /** Copie JPEG du PDF confirmé (pages empilées), rendue une fois puis gardée à côté du PDF. */
  private async jpegOf(row: Row): Promise<{ body: Buffer; contentType: string }> {
    if (!row.pdfKey) throw AppError.conflict('PERFORMANCE_LOG_NOT_CONFIRMED', 'Le PDF n\'existe qu\'une fois le rapport confirmé');
    const { body, contentType } = await this.jpegs.ensure(row.pdfKey);
    return { body, contentType };
  }

  async download(userId: string, id: string, format: 'pdf' | 'jpeg' = 'pdf') {
    const { row } = await this.requireOwn(userId, id);
    if (!row.pdfKey) throw AppError.conflict('PERFORMANCE_LOG_NOT_CONFIRMED', 'Le PDF n\'existe qu\'une fois le rapport confirmé');
    const key = format === 'jpeg' ? (await this.jpegs.ensure(row.pdfKey)).key : row.pdfKey;
    const seconds = (await this.limits()).linkSeconds;
    return { format, url: await this.storage.getSignedUrl(key, seconds), expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
  }

  async screenshot(userId: string, id: string, index: number): Promise<{ body: Buffer; contentType: string }> {
    const { row } = await this.requireOwn(userId, id);
    const shot = row.screenshots[index];
    if (!shot) throw AppError.notFound('SCREENSHOT_NOT_FOUND', 'Capture introuvable');
    const object = await this.storage.getObject(shot.key);
    if (!object) throw AppError.notFound('SCREENSHOT_FILE_NOT_FOUND', 'Fichier de la capture introuvable (purgé après le délai de conservation)');
    return object;
  }

  // --- Dispatch (My Hub) --------------------------------------------------------------------------------------------

  async adminList(query: PerformanceListQuery & { driverId?: string | undefined }): Promise<Page<AdminPerformanceLogView>> {
    const conditions = this.filters(query);
    if (query.driverId) conditions.push(eq(schema.performanceLogs.driverId, query.driverId));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db.select({ row: schema.performanceLogs, driver: DRIVER_INFO }).from(schema.performanceLogs).innerJoin(schema.drivers, eq(schema.drivers.id, schema.performanceLogs.driverId)).innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
        .where(where).orderBy(desc(schema.performanceLogs.date), desc(schema.performanceLogs.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.performanceLogs).where(where),
    ]);
    return { items: rows.map((r) => this.adminView(r.row, r.driver)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async adminGet(id: string): Promise<AdminPerformanceLogView> {
    const found = await this.requireRow(id);
    return this.adminView(found.row, found.driver);
  }

  async adminRecap(query: PerformanceRecapQuery & { driverId: string }): Promise<PerformanceRecapView> {
    return this.recapOf(query.driverId, query);
  }

  async adminPdf(id: string) {
    return this.pdfOf((await this.requireRow(id)).row);
  }

  async adminJpeg(id: string) {
    return this.jpegOf((await this.requireRow(id)).row);
  }

  async exportCsv(query: { from?: string | undefined; to?: string | undefined; driverId?: string | undefined }): Promise<string> {
    const conditions = [eq(schema.performanceLogs.status, 'confirmed'), ...this.filters(query)];
    if (query.driverId) conditions.push(eq(schema.performanceLogs.driverId, query.driverId));
    const rows = await this.db.select({ row: schema.performanceLogs, driver: DRIVER_INFO }).from(schema.performanceLogs)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.performanceLogs.driverId)).innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(and(...conditions)).orderBy(desc(schema.performanceLogs.date)).limit(5000);
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['date', 'chauffeur', 'nom', 'source', 'minutes_base', 'km', 'courses', 'courses_cents', 'pourboires_cents', 'promotions_cents', 'energie_cents', 'nettoyage_cents', 'solde_cents', 'solde_par_heure_cents', 'solde_par_km_cents', 'confirme_le'].join(';')];
    for (const r of rows) {
      const s = performanceSummary(figuresOf(r.row));
      lines.push([r.row.date, r.driver.publicNumber, fullName(r.driver.firstName, r.driver.lastName) ?? '', r.row.source, s.basisMinutes ?? '', s.distanceKm ?? '', r.row.ridesCount ?? '', r.row.ridesCents, r.row.tipsCents, r.row.promotionsCents, r.row.energyCents, r.row.cleaningCents, s.netCents, s.netPerHourCents ?? '', s.netPerKmCents ?? '', r.row.confirmedAt?.toISOString() ?? ''].map(cell).join(';'));
    }
    return `${lines.join('\n')}\n`;
  }
}
