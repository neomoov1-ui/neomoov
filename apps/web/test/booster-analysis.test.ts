/**
 * Neomoov Booster dans My Hub (finalisation U7, 3 octobre 2026) : état « Analyse en cours » des rapports dont l'analyse
 * est confiée à la file `agents`, et relecture automatique tant qu'une analyse de la page est en cours. Rendu statique,
 * sans navigateur ni base.
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_REFRESH_MS, AnalysisBadge, analysisRefetchInterval, InspectionAnalysisText, PendingAnalysisNotice } from '../src/components/hub/booster-analysis';
import { a11yIssues, render } from './support/markup';

describe('Booster dans My Hub : relecture tant qu\'une analyse est en cours', () => {
  it('relecture toutes les 10 secondes si au moins une analyse est en cours, sinon aucune', () => {
    expect(ANALYSIS_REFRESH_MS).toBe(10_000);
    expect(analysisRefetchInterval(['done', 'pending', 'none'])).toBe(ANALYSIS_REFRESH_MS);
    expect(analysisRefetchInterval(['pending'])).toBe(ANALYSIS_REFRESH_MS);
    expect(analysisRefetchInterval(['done', 'failed', 'none'])).toBe(false);
    expect(analysisRefetchInterval([])).toBe(false);
    // Données pas encore chargées : la première lecture suffit.
    expect(analysisRefetchInterval(undefined)).toBe(false);
  });
});

describe('Booster dans My Hub : état de l\'analyse affiché', () => {
  it('fiche d\'une inspection : « Analyse en cours » pour l\'état pending, plus jamais « sans analyse automatique »', () => {
    const html = render(createElement(InspectionAnalysisText, { analysis: { status: 'pending', confidence: null, summary: null } }));
    expect(html).toContain('Analyse en cours');
    expect(html).not.toContain('sans analyse automatique');
    // Zone annoncée : le résultat qui remplace « en cours » est lu sans action.
    expect(html).toContain('aria-live="polite"');
    expect(a11yIssues(html)).toEqual([]);
    expect(render(createElement(InspectionAnalysisText, { analysis: { status: 'pending', confidence: null, summary: null } }), { language: 'en' })).toContain('Analysis in progress');
  });

  it('fiche d\'une inspection : résultat avec sa confiance et son résumé, échec, rapport saisi sans analyse', () => {
    const done = render(createElement(InspectionAnalysisText, { analysis: { status: 'done', confidence: 0.92, summary: 'Pneu avant gauche usé.' } }));
    expect(done).toContain('confiance 92 %');
    expect(done).toContain('Pneu avant gauche usé.');
    expect(render(createElement(InspectionAnalysisText, { analysis: { status: 'failed', confidence: null, summary: null } }))).toContain('Analyse automatique en échec');
    expect(render(createElement(InspectionAnalysisText, { analysis: { status: 'none', confidence: null, summary: null } }))).toContain('Rapport saisi sans analyse automatique.');
  });

  it('listes des inspections et des performances : pastille par état, avis seulement quand des analyses sont en cours', () => {
    const labels = (['none', 'pending', 'done', 'failed'] as const).map((status) => render(createElement(AnalysisBadge, { status })));
    expect(labels).toEqual([
      expect.stringContaining('Aucune'), expect.stringContaining('Analyse en cours'), expect.stringContaining('Terminée'), expect.stringContaining('En échec'),
    ]);
    expect(render(createElement(AnalysisBadge, { status: 'pending' }), { language: 'en' })).toContain('Analysis in progress');
    const notice = render(createElement(PendingAnalysisNotice, { count: 2 }));
    expect(notice).toContain('Analyse en cours pour 2 rapport(s)');
    expect(notice).toContain('role="status"');
    expect(a11yIssues(notice)).toEqual([]);
    expect(render(createElement(PendingAnalysisNotice, { count: 0 }))).toBe('');
  });
});
