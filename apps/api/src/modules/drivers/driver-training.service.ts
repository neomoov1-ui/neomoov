/**
 * Formation Neomoov (prompt 11, écran Formation) : modules lus dans `training.modules`, quiz corrigé ici (les bonnes
 * réponses ne quittent jamais l'API), attestation quand chaque module est réussi. Sans attestation, le passage en ligne
 * est refusé (`training_required`, réglage `drivers.require_training`).
 */
import { schema } from '@neomoov/db';
import { gradeQuiz, publicTrainingModule, trainingComplete, type TrainingModule, type TrainingResult, type TrainingView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { DriverProfileService } from './driver-profile.service.js';

const text = z.object({ fr: z.string(), en: z.string() });
const moduleSchema = z.object({
  code: z.string().min(1).max(40),
  title: text,
  summary: text,
  videoUrl: z.string().url().nullable(),
  durationMinutes: z.number().int().min(0),
  questions: z.array(z.object({ id: z.string(), prompt: text, choices: z.array(text).min(2), answerIndex: z.number().int().min(0) })),
});

@Injectable()
export class DriverTrainingService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
    private readonly profiles: DriverProfileService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Modules en vigueur ; un module mal formé dans les réglages est ignoré plutôt que de bloquer toute la formation. */
  async modules(): Promise<TrainingModule[]> {
    const raw = await this.settings.get<unknown>('training.modules', []);
    return (Array.isArray(raw) ? raw : []).flatMap((m) => {
      const parsed = moduleSchema.safeParse(m);
      return parsed.success && parsed.data.questions.every((q) => q.answerIndex < q.choices.length) ? [parsed.data] : [];
    });
  }

  async view(userId: string): Promise<TrainingView> {
    const driver = await this.profiles.requireDriver(userId);
    const [modules, passScorePct, results] = await Promise.all([
      this.modules(),
      this.settings.number('training.pass_score_pct', 80),
      this.db.select({ moduleCode: schema.driverTrainingResults.moduleCode, scorePct: schema.driverTrainingResults.scorePct, passed: schema.driverTrainingResults.passed }).from(schema.driverTrainingResults).where(eq(schema.driverTrainingResults.driverId, driver.id)),
    ]);
    return {
      passScorePct,
      certifiedAt: driver.trainingCertifiedAt?.toISOString() ?? null,
      modules: modules.map((m) => {
        const mine = results.filter((r) => r.moduleCode === m.code);
        return { ...publicTrainingModule(m), passed: mine.some((r) => r.passed), bestScorePct: mine.length ? Math.max(...mine.map((r) => r.scorePct)) : null };
      }),
    };
  }

  /** Quiz d'un module : chaque tentative est conservée ; l'attestation est délivrée à la réussite du dernier module manquant. */
  async submit(userId: string, moduleCode: string, answers: Record<string, number>): Promise<TrainingResult> {
    const driver = await this.profiles.requireDriver(userId);
    const modules = await this.modules();
    const module = modules.find((m) => m.code === moduleCode);
    if (!module) throw AppError.notFound('TRAINING_MODULE_NOT_FOUND', 'Module de formation introuvable');
    const passScorePct = await this.settings.number('training.pass_score_pct', 80);
    const grade = gradeQuiz(module, answers, passScorePct);
    await this.db.insert(schema.driverTrainingResults).values({ driverId: driver.id, moduleCode, scorePct: grade.scorePct, passed: grade.passed, answers });
    let certifiedAt = driver.trainingCertifiedAt;
    if (!certifiedAt && grade.passed) {
      const passed = await this.db
        .selectDistinct({ moduleCode: schema.driverTrainingResults.moduleCode })
        .from(schema.driverTrainingResults)
        .where(and(eq(schema.driverTrainingResults.driverId, driver.id), eq(schema.driverTrainingResults.passed, true)))
        .orderBy(desc(schema.driverTrainingResults.moduleCode));
      if (trainingComplete(modules, new Set(passed.map((p) => p.moduleCode)))) {
        certifiedAt = new Date();
        await this.db.update(schema.drivers).set({ trainingCertifiedAt: certifiedAt }).where(eq(schema.drivers.id, driver.id));
      }
    }
    return {
      moduleCode,
      correct: grade.correct,
      total: grade.total,
      scorePct: grade.scorePct,
      passed: grade.passed,
      missed: module.questions.filter((q) => answers[q.id] !== q.answerIndex).map((q) => q.id),
      certifiedAt: certifiedAt?.toISOString() ?? null,
    };
  }
}
