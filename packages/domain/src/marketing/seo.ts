/**
 * Référencement (plan 4.1) : contrôles déterministes des pages du site (titres, descriptions, en-têtes, maillage) et
 * couverture des mots-clés cibles, à partir desquels l'agent `seo` propose des tâches ; agrégation des mesures de la
 * Search Console avant et après. Les contrôles décident, l'agent justifie et rédige.
 */
export const SEO_ACTIONS = ['new_page', 'new_article', 'fix_title', 'fix_description', 'faq_question', 'internal_link'] as const;
export type SeoAction = (typeof SEO_ACTIONS)[number];

export const SEO_TASK_STATUSES = ['proposed', 'approved', 'applied', 'rejected', 'failed', 'measured'] as const;
export type SeoTaskStatus = (typeof SEO_TASK_STATUSES)[number];

export const SEO_TARGET_KINDS = ['page', 'post', 'site'] as const;
export type SeoTargetKind = (typeof SEO_TARGET_KINDS)[number];

/** Page du site telle que l'API WordPress la décrit (titres et descriptions des balises, en-têtes, liens internes). */
export interface SitePage {
  id: string;
  kind: 'page' | 'post';
  url: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  headings: readonly string[];
  internalLinks: number;
  wordCount: number;
}

/** Ligne de la Search Console : clics, impressions et position moyenne d'une requête (et d'une page si demandée). */
export interface SearchStat {
  page: string | null;
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface SeoFinding {
  action: SeoAction;
  targetKind: SeoTargetKind;
  targetRef: string | null;
  targetTitle: string | null;
  keyword: string | null;
  justification: string;
  proposal: Record<string, unknown>;
}

export interface SeoLimits {
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
  minInternalLinks: number;
}

/** Limites usuelles des balises (règles des moteurs, pas des règles métier). */
export const DEFAULT_SEO_LIMITS: SeoLimits = { titleMin: 30, titleMax: 60, descriptionMin: 70, descriptionMax: 155, minInternalLinks: 2 };

const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'au', 'aux', 'pour', 'the', 'a', 'of', 'in', 'to', 'prix', 'fixe']);

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Mots significatifs d'un mot-clé (accents et mots vides retirés). */
export function keywordTokens(keyword: string): string[] {
  return normalizeText(keyword).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Une page couvre un mot-clé quand tous ses mots significatifs figurent dans son titre, sa balise titre, son H1 ou son adresse. */
export function pageCoversKeyword(page: SitePage, keyword: string): boolean {
  const haystack = normalizeText([page.title, page.metaTitle ?? '', page.h1 ?? '', page.url.replace(/[-_/]/g, ' '), ...page.headings].join(' '));
  const tokens = keywordTokens(keyword);
  return tokens.length > 0 && tokens.every((t) => haystack.includes(t));
}

/** Première requête de la Search Console qui ressemble à une question (comment, combien, quel, pourquoi, how, what…). */
const QUESTION = /^(comment|combien|quel|quelle|quels|quelles|pourquoi|o[uù]|quand|est-ce|how|what|which|why|where|when|can|is|are|do|does)\b/i;

export function seoFindings(pages: readonly SitePage[], keywords: readonly string[], stats: readonly SearchStat[], limits: SeoLimits = DEFAULT_SEO_LIMITS): SeoFinding[] {
  const findings: SeoFinding[] = [];
  for (const page of pages) {
    const title = page.metaTitle ?? page.title;
    if (!title.trim() || title.length < limits.titleMin || title.length > limits.titleMax) {
      findings.push({
        action: 'fix_title', targetKind: page.kind, targetRef: page.id, targetTitle: page.title, keyword: keywords.find((k) => pageCoversKeyword(page, k)) ?? null,
        justification: !title.trim() ? 'Balise titre absente' : `Balise titre de ${title.length} caractères (${limits.titleMin} à ${limits.titleMax} attendus)`,
        proposal: { currentTitle: title, min: limits.titleMin, max: limits.titleMax },
      });
    }
    const description = page.metaDescription ?? '';
    if (!description.trim() || description.length < limits.descriptionMin || description.length > limits.descriptionMax) {
      findings.push({
        action: 'fix_description', targetKind: page.kind, targetRef: page.id, targetTitle: page.title, keyword: keywords.find((k) => pageCoversKeyword(page, k)) ?? null,
        justification: !description.trim() ? 'Description absente' : `Description de ${description.length} caractères (${limits.descriptionMin} à ${limits.descriptionMax} attendus)`,
        proposal: { currentDescription: description, min: limits.descriptionMin, max: limits.descriptionMax },
      });
    }
    if (!page.h1) {
      findings.push({ action: 'fix_title', targetKind: page.kind, targetRef: page.id, targetTitle: page.title, keyword: null, justification: 'Aucun en-tête H1 sur la page', proposal: { heading: 'h1' } });
    }
    if (page.internalLinks < limits.minInternalLinks) {
      findings.push({
        action: 'internal_link', targetKind: page.kind, targetRef: page.id, targetTitle: page.title, keyword: null,
        justification: `${page.internalLinks} lien(s) interne(s), ${limits.minInternalLinks} au moins attendus`,
        proposal: { candidates: pages.filter((p) => p.id !== page.id).slice(0, 5).map((p) => ({ id: p.id, url: p.url, title: p.title })) },
      });
    }
  }
  for (const keyword of keywords) {
    if (pages.some((p) => pageCoversKeyword(p, keyword))) continue;
    const tokens = keywordTokens(keyword);
    const related = stats.filter((s) => tokens.every((t) => normalizeText(s.query).includes(t)));
    const impressions = related.reduce((sum, s) => sum + s.impressions, 0);
    findings.push({
      action: 'new_article', targetKind: 'site', targetRef: null, targetTitle: null, keyword,
      justification: `Aucune page ne couvre « ${keyword} »${impressions ? ` (${impressions} impressions sur des requêtes proches)` : ''}`,
      proposal: { keyword, impressions },
    });
  }
  const questions = stats.filter((s) => QUESTION.test(s.query.trim())).sort((a, b) => b.impressions - a.impressions).slice(0, 3);
  for (const stat of questions) {
    const page = stat.page ? pages.find((p) => p.url === stat.page) : undefined;
    findings.push({
      action: 'faq_question', targetKind: page ? page.kind : 'site', targetRef: page?.id ?? null, targetTitle: page?.title ?? null, keyword: stat.query,
      justification: `Requête en forme de question (${stat.impressions} impressions, position ${stat.position.toFixed(1)})`,
      proposal: { question: stat.query, clicks: stat.clicks, impressions: stat.impressions, position: stat.position },
    });
  }
  return findings;
}

export interface PageMetrics {
  clicks: number;
  impressions: number;
  /** Position moyenne pondérée par les impressions ; null sans impression. */
  position: number | null;
  queries: number;
}

/** Mesures agrégées d'une page (ou du site entier sans adresse) à partir des lignes de la Search Console. */
export function aggregateStats(stats: readonly SearchStat[], pageUrl: string | null): PageMetrics {
  const rows = pageUrl ? stats.filter((s) => s.page === pageUrl) : stats;
  const clicks = rows.reduce((sum, s) => sum + s.clicks, 0);
  const impressions = rows.reduce((sum, s) => sum + s.impressions, 0);
  const weighted = rows.reduce((sum, s) => sum + s.position * s.impressions, 0);
  return { clicks, impressions, position: impressions ? Math.round((weighted / impressions) * 10) / 10 : null, queries: rows.length };
}
