'use client';

/**
 * Neomoov Booster dans My Hub : état de l'analyse automatique d'un rapport de vérification sommaire, ou de la lecture des
 * captures d'un rapport de performance. Confiée à la file `agents` (finalisation U3), l'analyse reste à l'état `pending`
 * tant que le résultat n'est pas prêt : la page l'annonce « Analyse en cours » et se relit d'elle-même jusqu'au résultat.
 * La relecture s'arrête toujours : l'API rend en échec une analyse perdue après 10 minutes.
 */
import type { InspectionAnalysisView } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { Badge, Notice, type BadgeTone } from '@/components/ui/kit';

type AnalysisStatus = InspectionAnalysisView['status'];

/** Délai entre deux relectures tant qu'une analyse est en cours (onglet visible seulement, comportement par défaut de React Query). */
export const ANALYSIS_REFRESH_MS = 10_000;

/** Intervalle de relecture d'une page : `ANALYSIS_REFRESH_MS` si au moins une analyse est en cours, sinon aucune relecture. */
export function analysisRefetchInterval(statuses: readonly AnalysisStatus[] | undefined): number | false {
  return statuses?.includes('pending') ? ANALYSIS_REFRESH_MS : false;
}

const TONES: Record<AnalysisStatus, BadgeTone> = { none: 'neutral', pending: 'info', done: 'success', failed: 'warning' };

/** Pastille d'état de l'analyse dans une liste (inspections, performance). */
export function AnalysisBadge({ status }: { status: AnalysisStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[status]}>{t(`hub.booster.analysisStates.${status}`)}</Badge>;
}

/** Avis au-dessus d'une liste quand des analyses sont en cours (rien sinon). */
export function PendingAnalysisNotice({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return <div className="mb-3"><Notice tone="info">{t('hub.booster.pendingNotice', { count })}</Notice></div>;
}

/**
 * Phrase de la fiche d'un rapport : en cours, terminée avec sa confiance, en échec, ou rapport saisi sans analyse.
 * Zone annoncée aux lecteurs d'écran : le passage de « en cours » au résultat est lu sans action de l'utilisateur.
 */
export function InspectionAnalysisText({ analysis }: { analysis: Pick<InspectionAnalysisView, 'status' | 'confidence' | 'summary'> }) {
  const { t } = useTranslation();
  const text = analysis.status === 'done'
    ? t('hub.booster.analysisDone', { percent: Math.round((analysis.confidence ?? 0) * 100) })
    : analysis.status === 'failed' ? t('hub.booster.analysisFailed') : analysis.status === 'pending' ? t('hub.booster.analysisPending') : t('hub.booster.analysisNone');
  return (
    <p className="text-sm text-slate-700" aria-live="polite">
      {text}
      {analysis.summary ? <><br />{analysis.summary}</> : null}
    </p>
  );
}
