/**
 * Marketing simulé (phase 1 « entreprise autonome ») : connecteurs des onze espaces, site WordPress, voix de synthèse et
 * Search Console, en mémoire, déterministes, sans réseau. Les tests lisent `published`, `replies`, `drafts`, et
 * simulent des commentaires (`addComment`) et des pannes (`failures`, `unavailable`). Aucune règle métier ici.
 */
import { randomBytes } from 'node:crypto';
import { CONTENT_SPACES, SPACE_RULES, type ContentLanguage, type ContentSpace, type SearchStat, type SitePage } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { PublishedRef, SearchConsoleProvider, SiteConnector, SiteMediaItem, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher, SocialPublishers, TtsProvider } from '../marketing.types.js';

let counter = 0;
const RUN = randomBytes(3).toString('hex');
const nextId = (prefix: string) => `${prefix}_${RUN}${(++counter).toString(36).padStart(6, '0')}`;

export class MockSocialPublisher implements SocialPublisher {
  readonly name = 'mock';
  readonly configured = true;
  readonly published = new Map<string, SocialPublishInput & { url: string; publishedAt: Date }>();
  readonly replies: Array<{ externalId: string; commentExternalId: string; text: string }> = [];
  private readonly commentsByPost = new Map<string, SocialComment[]>();
  private readonly metricReads = new Map<string, number>();
  /** Les N prochaines publications échouent (panne du réseau), comme `captureFailures` des paiements. */
  failures = 0;
  /** Panne durable : tout appel échoue. */
  unavailable = false;

  constructor(readonly space: ContentSpace) {}

  private available(): void {
    if (this.unavailable) throw new AppError('SOCIAL_PROVIDER_ERROR', `${SPACE_RULES[this.space].name} indisponible (panne simulée)`, 502);
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    this.available();
    if (this.failures > 0) {
      this.failures -= 1;
      throw new AppError('SOCIAL_PROVIDER_ERROR', `${SPACE_RULES[this.space].name} : publication refusée (panne simulée)`, 502);
    }
    if (SPACE_RULES[this.space].requiresMedia && !input.media) throw new AppError('SOCIAL_MEDIA_REQUIRED', `${SPACE_RULES[this.space].name} exige un visuel ou une vidéo`, 422);
    const externalId = nextId(`${this.space}_post`);
    const url = `https://mock.social/${this.space}/${externalId}`;
    this.published.set(externalId, { ...input, url, publishedAt: new Date() });
    return { externalId, url, draft: input.draft };
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    this.available();
    const post = this.published.get(ref.externalId);
    if (!post) throw AppError.notFound('SOCIAL_POST_NOT_FOUND', 'Publication introuvable chez le réseau simulé');
    const reads = (this.metricReads.get(ref.externalId) ?? 0) + 1;
    this.metricReads.set(ref.externalId, reads);
    const comments = this.commentsByPost.get(ref.externalId)?.length ?? 0;
    // Déterministe et croissant d'une lecture à l'autre : portée selon la longueur du texte, interactions selon les commentaires.
    return { reach: (100 + post.text.length) * reads, interactions: (10 + comments) * reads, clicks: 5 * reads, collectedAt: new Date(), raw: { reads } };
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    this.available();
    return (this.commentsByPost.get(ref.externalId) ?? []).filter((c) => c.postedAt > since);
  }

  async replyComment(ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    this.available();
    if (!this.published.has(ref.externalId)) throw AppError.notFound('SOCIAL_POST_NOT_FOUND', 'Publication introuvable chez le réseau simulé');
    const externalId = nextId('reply');
    this.replies.push({ externalId, commentExternalId, text });
    return { externalId };
  }

  /** Pour les tests : un commentaire reçu sur une publication. */
  addComment(externalId: string, comment: { text: string; author?: string | null; postedAt?: Date }): SocialComment {
    const list = this.commentsByPost.get(externalId) ?? [];
    const stored: SocialComment = { externalId: nextId('comment'), author: comment.author ?? 'Visiteur', text: comment.text, postedAt: comment.postedAt ?? new Date() };
    list.push(stored);
    this.commentsByPost.set(externalId, list);
    return stored;
  }

  reset(): void {
    this.published.clear();
    this.replies.length = 0;
    this.commentsByPost.clear();
    this.metricReads.clear();
    this.failures = 0;
    this.unavailable = false;
  }
}

export function mockSocialPublishers(): SocialPublishers {
  return new Map(CONTENT_SPACES.map((space) => [space, new MockSocialPublisher(space)]));
}

/** Pages d'un site de démonstration, avec des défauts de référencement voulus (titre court, description absente, sans H1, peu de liens). */
const DEMO_PAGES: SitePage[] = [
  { id: '23', kind: 'page', url: 'https://neomoov.net/', title: 'Neomoov : chauffeur privé à Montréal, prix fixe', metaTitle: 'Chauffeur privé à Montréal, prix fixe garanti | Neomoov', metaDescription: 'Transport de personnes à Montréal avec chauffeur privé, véhicules électriques, prix tout compris affiché avant de confirmer.', h1: 'Chauffeur privé à Montréal', headings: ['Nos véhicules', 'Comment réserver'], internalLinks: 8, wordCount: 520 },
  { id: '31', kind: 'page', url: 'https://neomoov.net/reserver', title: 'Réserver', metaTitle: null, metaDescription: null, h1: null, headings: [], internalLinks: 1, wordCount: 90 },
  { id: '33', kind: 'page', url: 'https://neomoov.net/aeroport', title: 'Transport aéroport Montréal à prix fixe', metaTitle: 'Transport aéroport Montréal à prix fixe, navette aéroport Montréal-Trudeau | Neomoov', metaDescription: 'Navette aéroport Montréal-Trudeau au prix fixe, chauffeur professionnel, véhicule électrique, réservation en ligne en deux minutes.', h1: 'Transport aéroport Montréal', headings: ['Prix fixe', 'Suivi de vol'], internalLinks: 4, wordCount: 410 },
  { id: '35', kind: 'page', url: 'https://neomoov.net/chauffeurs', title: 'Devenir chauffeur', metaTitle: 'Devenir chauffeur Neomoov à Montréal | Neomoov', metaDescription: null, h1: 'Devenir chauffeur', headings: ['Les conditions', 'La formation'], internalLinks: 3, wordCount: 380 },
  { id: '40', kind: 'page', url: 'https://neomoov.net/academy', title: 'Neomoov Academy', metaTitle: 'Neomoov Academy : formation Neomoov Chauffeur Pro | Neomoov', metaDescription: 'Formation complémentaire des chauffeurs : sept modules, quiz et attestation.', h1: 'Neomoov Academy', headings: ['Les sept modules'], internalLinks: 2, wordCount: 300 },
];

export class MockSiteConnector implements SiteConnector {
  readonly name = 'mock';
  readonly configured = true;
  readonly pagesStore = new Map<string, SitePage>(DEMO_PAGES.map((p) => [p.id, { ...p, headings: [...p.headings] }]));
  readonly seoUpdates: Array<{ ref: string; patch: { title?: string | null; description?: string | null } }> = [];
  readonly drafts: Array<{ externalId: string; kind: 'page' | 'post'; title: string; content: string; excerpt: string | null; category: string | null }> = [];
  unavailable = false;

  private available(): void {
    if (this.unavailable) throw new AppError('SITE_PROVIDER_ERROR', 'Site WordPress indisponible (panne simulée)', 502);
  }

  async pages(): Promise<SitePage[]> {
    this.available();
    return [...this.pagesStore.values()].map((p) => ({ ...p, headings: [...p.headings] }));
  }

  async updateSeo(ref: string, patch: { title?: string | null; description?: string | null }): Promise<void> {
    this.available();
    const page = this.pagesStore.get(ref);
    if (!page) throw AppError.notFound('SITE_PAGE_NOT_FOUND', `Page ${ref} introuvable sur le site simulé`);
    if (patch.title !== undefined) page.metaTitle = patch.title;
    if (patch.description !== undefined) page.metaDescription = patch.description;
    this.seoUpdates.push({ ref, patch });
  }

  async createDraft(input: { kind: 'page' | 'post'; title: string; content: string; excerpt?: string | null; category?: string | null }): Promise<{ externalId: string; url: string | null }> {
    this.available();
    const externalId = nextId('draft');
    this.drafts.push({ externalId, kind: input.kind, title: input.title, content: input.content, excerpt: input.excerpt ?? null, category: input.category ?? null });
    return { externalId, url: `https://neomoov.net/?p=${externalId}&preview=true` };
  }

  async mediaLibrary(limit: number): Promise<SiteMediaItem[]> {
    this.available();
    return [
      { id: 'm1', url: 'https://neomoov.net/wp-content/uploads/vehicule-electrique.jpg', alt: 'Véhicule électrique Neomoov devant l\'aéroport', mimeType: 'image/jpeg' },
      { id: 'm2', url: 'https://neomoov.net/wp-content/uploads/chauffeur-accueil.jpg', alt: 'Chauffeur qui accueille un passager', mimeType: 'image/jpeg' },
      { id: 'm3', url: 'https://neomoov.net/wp-content/uploads/montreal-nuit.jpg', alt: 'Montréal la nuit', mimeType: 'image/jpeg' },
    ].slice(0, limit);
  }

  reset(): void {
    this.pagesStore.clear();
    for (const p of DEMO_PAGES) this.pagesStore.set(p.id, { ...p, headings: [...p.headings] });
    this.seoUpdates.length = 0;
    this.drafts.length = 0;
    this.unavailable = false;
  }
}

/** En-tête WAV (PCM 16 bits mono, 16 kHz) suivi de silence : lisible par ffmpeg, durée proportionnelle au texte. */
export function silentWav(seconds: number, sampleRate = 16_000): Buffer {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Voix simulée : silence de la durée estimée de la lecture (14 caractères par seconde, comme la narration de l'Academy). */
export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock';
  readonly configured = true;
  readonly calls: Array<{ text: string; language: ContentLanguage }> = [];

  async synthesize(input: { text: string; language: ContentLanguage }) {
    this.calls.push(input);
    const durationSeconds = Math.max(1, Math.round(input.text.length / 14));
    return { audio: silentWav(Math.min(durationSeconds, 3)), contentType: 'audio/wav', durationSeconds };
  }
}

/** Search Console simulée : requêtes stables sur les pages de démonstration, dont deux questions et un mot-clé sans page. */
export class MockSearchConsoleProvider implements SearchConsoleProvider {
  readonly name = 'mock';
  readonly configured = true;
  readonly calls: Array<{ from: string; to: string; byPage: boolean }> = [];

  async query(input: { from: string; to: string; byPage: boolean; rowLimit?: number }): Promise<SearchStat[]> {
    this.calls.push({ from: input.from, to: input.to, byPage: input.byPage });
    const rows: SearchStat[] = [
      { page: 'https://neomoov.net/aeroport', query: 'navette aéroport montréal', clicks: 12, impressions: 400, position: 8.2 },
      { page: 'https://neomoov.net/aeroport', query: 'transport aéroport montréal prix fixe', clicks: 9, impressions: 220, position: 6.1 },
      { page: 'https://neomoov.net/aeroport', query: 'combien coûte un taxi pour l\'aéroport de montréal', clicks: 3, impressions: 150, position: 14 },
      { page: 'https://neomoov.net/', query: 'chauffeur privé montréal', clicks: 20, impressions: 900, position: 5.4 },
      { page: 'https://neomoov.net/', query: 'how much is a ride to yul', clicks: 1, impressions: 20, position: 18.5 },
      { page: 'https://neomoov.net/chauffeurs', query: 'chauffeur électrique montréal', clicks: 0, impressions: 30, position: 25 },
    ];
    return (input.byPage ? rows : rows.map((r) => ({ ...r, page: null }))).slice(0, input.rowLimit ?? rows.length);
  }
}
