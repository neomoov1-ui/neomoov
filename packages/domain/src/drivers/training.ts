/**
 * Formation Neomoov (prompt 11, écran Formation) : modules (vidéo et résumé), quiz corrigé côté serveur, attestation
 * quand tous les modules sont réussis. Le contenu des modules et le seuil de réussite viennent des réglages
 * (`training.modules`, `training.pass_score_pct`) ; les bonnes réponses ne quittent jamais l'API.
 */

export interface LocalizedText {
  fr: string;
  en: string;
}

export interface TrainingQuestion {
  id: string;
  prompt: LocalizedText;
  choices: LocalizedText[];
  answerIndex: number;
}

export interface TrainingModule {
  code: string;
  title: LocalizedText;
  summary: LocalizedText;
  /** Vidéo du module ; null tant que le fondateur ne l'a pas fournie (le résumé tient lieu de contenu). */
  videoUrl: string | null;
  durationMinutes: number;
  questions: TrainingQuestion[];
}

export interface QuizGrade {
  correct: number;
  total: number;
  scorePct: number;
  passed: boolean;
}

/** Une question sans réponse compte comme fausse ; une réponse hors des choix aussi. */
export function gradeQuiz(module: TrainingModule, answers: Readonly<Record<string, number>>, passScorePct: number): QuizGrade {
  const total = module.questions.length;
  const correct = module.questions.filter((q) => answers[q.id] === q.answerIndex).length;
  const scorePct = total === 0 ? 100 : Math.floor((correct * 100) / total);
  return { correct, total, scorePct, passed: scorePct >= passScorePct };
}

/** Module tel qu'il est envoyé à l'application : sans les bonnes réponses. */
export function publicTrainingModule(module: TrainingModule): Omit<TrainingModule, 'questions'> & { questions: Array<Omit<TrainingQuestion, 'answerIndex'>> } {
  return { ...module, questions: module.questions.map(({ answerIndex: _answer, ...q }) => q) };
}

/** Attestation : chaque module de la formation en vigueur a été réussi au moins une fois. */
export function trainingComplete(modules: readonly Pick<TrainingModule, 'code'>[], passedCodes: ReadonlySet<string>): boolean {
  return modules.length > 0 && modules.every((m) => passedCodes.has(m.code));
}
