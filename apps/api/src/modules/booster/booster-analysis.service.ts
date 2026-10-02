/**
 * Neomoov Booster (phase 1, agent G) : analyse des photos et lecture des captures d'écran par le modèle, par le socle
 * des agents (`AgentRunnerService` : prompt versionné en base, modèle et effort de l'agent, coûts et journal `agent_runs`,
 * mode manuel respecté). Les images partent en pièces jointes du message ; la sortie est validée par le schéma Zod du
 * domaine. Rien n'est décidé ici : le résultat prépare une saisie que le chauffeur confirme ou corrige.
 */
import { inspectionAnalysisSchema, performanceReadingSchema, type InspectionAnalysis, type PerformanceReading } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { STORAGE_PROVIDER, type LlmAttachment, type StorageProvider } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import type { StoredImage } from './booster-images.js';
import { AgentRunnerService } from '../agents/agent-runner.service.js';

export const INSPECTION_PROMPT_KEY = 'vehicle_inspection.v1';
export const PERFORMANCE_PROMPT_KEY = 'performance_reading.v1';

export type AnalysisOutcome<T> = { ok: true; output: T; model: string | null; runId: string } | { ok: false; error: string; model: string | null; runId: string | null };

const ATTACHABLE = new Set<LlmAttachment['mediaType']>(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class BoosterAnalysisService {
  constructor(
    private readonly runner: AgentRunnerService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** Pièces jointes des images encore présentes dans le stockage (une image purgée ou illisible est ignorée). */
  private async attachments(images: StoredImage[]): Promise<LlmAttachment[]> {
    const out: LlmAttachment[] = [];
    for (const image of images) {
      const object = await this.storage.getObject(image.key).catch(() => null);
      if (!object || !ATTACHABLE.has(object.contentType as LlmAttachment['mediaType'])) continue;
      out.push({ kind: 'image', mediaType: object.contentType as LlmAttachment['mediaType'], dataBase64: object.body.toString('base64') });
    }
    return out;
  }

  private async run<T>(agentCode: string, trigger: { name: string; ref: string; input: Record<string, unknown> }, schemaName: string, schema: z.ZodType<T>, text: string, images: StoredImage[]): Promise<AnalysisOutcome<T>> {
    const attachments = await this.attachments(images);
    if (!attachments.length) return { ok: false, error: 'NO_READABLE_IMAGE', model: null, runId: null };
    const execution = await this.runner.execute<T>(agentCode, trigger, (ctx) => ctx.structured(schemaName, schema, [{ role: 'user', content: text, attachments }]));
    const { run } = execution;
    if (execution.result !== null && run.status !== 'failed') return { ok: true, output: execution.result, model: run.model, runId: run.id };
    const error = run.status === 'skipped' ? 'AGENT_UNAVAILABLE' : run.error ?? 'ANALYSIS_FAILED';
    this.logger.warn({ agentCode, runId: run.id, status: run.status, error }, 'Analyse Booster sans résultat');
    return { ok: false, error, model: run.model, runId: run.id };
  }

  /** Photos d'une vérification sommaire : lecture de l'odomètre, de l'énergie, de la plaque, voyants, défauts, éléments visibles. */
  async analyseInspection(input: { inspectionId: string; driverId: string; attempt: number; images: StoredImage[]; plate: string | null; vehicle: string | null }): Promise<AnalysisOutcome<InspectionAnalysis>> {
    const order = input.images.map((img, i) => `${i} : ${img.kind}`).join(', ');
    const text = [
      `Photos de la vérification sommaire, dans l'ordre (index : vue) : ${order}.`,
      input.vehicle ? `Véhicule déclaré : ${input.vehicle}.` : 'Véhicule non déclaré.',
      input.plate ? `Plaque déclarée par le chauffeur : ${input.plate} (confirme-la ou corrige-la d'après les photos).` : 'Plaque non déclarée.',
      'Renvoie l\'objet demandé.',
    ].join('\n');
    return this.run<InspectionAnalysis>(
      'vehicle_inspection',
      { name: 'booster.inspection', ref: `${input.inspectionId}:${input.attempt}`, input: { inspectionId: input.inspectionId, driverId: input.driverId, photos: input.images.length } },
      'vehicle_inspection',
      inspectionAnalysisSchema,
      text,
      input.images,
    );
  }

  /** Captures d'écran d'un rapport de performance : montants, courses, temps en ligne, heures. */
  async readPerformance(input: { logId: string; driverId: string; attempt: number; images: StoredImage[]; date: string }): Promise<AnalysisOutcome<PerformanceReading>> {
    const text = [
      `${input.images.length} capture(s) d'écran d'applications de travail, session déclarée du ${input.date}.`,
      'Lis seulement les chiffres de la session et renvoie l\'objet demandé.',
    ].join('\n');
    return this.run<PerformanceReading>(
      'performance_reading',
      { name: 'booster.performance', ref: `${input.logId}:${input.attempt}`, input: { logId: input.logId, driverId: input.driverId, screenshots: input.images.length } },
      'performance_reading',
      performanceReadingSchema,
      text,
      input.images,
    );
  }
}
