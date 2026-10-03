import { describe, expect, it } from 'vitest';
import {
  aggregateStats, assignSlots, autoPublishable, checkContent, classifyComment, composeText, contentCalendarOutputSchema, contentUpdateSchema, DEFAULT_SLOTS, EMPTY_METRICS, isSensitive,
  isVideoFormat, keywordTokens, nextMeasureAt, nextWeekStart, normalizeHashtag, normalizePrice, pageCoversKeyword, parseSlots, recordMeasure, retryDelayMs, seoFindings, seoPlanOutputSchema, simpleReply,
  slotCandidates, slotInstant, spaceRule, weekStartOf, zonedInstant, type ContentDraft, type SearchStat, type SitePage,
} from '../src/index.js';
import { CONTENT_SPACES } from '../src/marketing/index.js';

const TZ = 'America/Toronto';
const OPTIONS = { allowedPrices: ['48,20 $', '113,83 $'], ctaUrls: { reserve: 'https://neomoov.net/reserver', academy: 'https://neomoov.net/academy', preregister: 'https://neomoov.net/chauffeurs/#candidature' }, allowedPhones: ['+1 438 900 4990'], allowedEmailDomains: ['neomoov.net'] };
const draft = (over: Partial<ContentDraft> = {}): ContentDraft => ({ space: 'facebook', format: 'post', language: 'fr', title: null, body: 'Réservez votre transfert vers l\'aéroport au prix tout compris, affiché avant de confirmer.', caption: null, hashtags: ['#Montréal'], cta: 'reserve', ...over });

describe('marketing : espaces, formats et texte composé', () => {
  it('treize espaces avec leurs règles (Telegram et chaîne WhatsApp ajoutés) ; formats vidéo ; mots-clics normalisés', () => {
    expect(CONTENT_SPACES).toHaveLength(13);
    for (const space of CONTENT_SPACES) expect(spaceRule(space).formats.length).toBeGreaterThan(0);
    expect(isVideoFormat('reel')).toBe(true);
    expect(isVideoFormat('post')).toBe(false);
    expect(normalizeHashtag(' ##Montréal ')).toBe('#Montréal');
    expect(normalizeHashtag('a')).toBeNull();
    expect(normalizeHashtag('mauvais tag!')).toBeNull();
  });

  it('texte composé : corps puis lien et mots-clics ; légende d\'abord sur les réseaux à média ; lien non répété ni sur les réseaux sans lien', () => {
    expect(composeText({ space: 'facebook', title: null, body: 'Corps', caption: 'Légende', hashtags: ['#a'], ctaUrl: 'https://neomoov.net/reserver' })).toBe('Corps\n\nhttps://neomoov.net/reserver\n\n#a');
    expect(composeText({ space: 'instagram', title: null, body: 'Corps', caption: 'Légende', hashtags: [], ctaUrl: 'https://neomoov.net/reserver' })).toBe('Légende');
    expect(composeText({ space: 'instagram', title: null, body: 'Corps', caption: '  ', hashtags: [], ctaUrl: null })).toBe('Corps');
    expect(composeText({ space: 'x', title: null, body: 'Voir https://neomoov.net/reserver', caption: null, hashtags: [], ctaUrl: 'https://neomoov.net/reserver' })).toBe('Voir https://neomoov.net/reserver');
  });
});

describe('marketing : garde-fous des contenus', () => {
  it('contenu conforme : aucun écart ; publiable en automatique', () => {
    const issues = checkContent(draft(), OPTIONS);
    expect(issues).toEqual([]);
    expect(isSensitive(false, issues)).toBe(false);
    expect(autoPublishable('auto', false, issues)).toBe(true);
    expect(autoPublishable('approval', false, issues)).toBe(false);
    expect(autoPublishable('auto', true, issues)).toBe(false);
  });

  it('règles du réseau : format, langue, titre, texte vide, longueur, mots-clics', () => {
    const kinds = (d: Partial<ContentDraft>) => checkContent(draft(d), OPTIONS).map((i) => i.kind);
    expect(kinds({ space: 'x', format: 'reel' })).toContain('format_not_allowed');
    expect(kinds({ language: 'en' })).toContain('language_not_allowed');
    expect(kinds({ space: 'site_blog', format: 'article', title: '  ' })).toContain('title_required');
    expect(kinds({ body: '   ' })).toContain('body_empty');
    expect(kinds({ space: 'x', body: 'a'.repeat(300), hashtags: [] })).toContain('too_long');
    expect(kinds({ space: 'x', hashtags: ['#a1', '#b2', '#c3', '#d4'] })).toContain('too_many_hashtags');
    expect(kinds({ hashtags: ['#bon', 'mauvais tag!'] })).toContain('hashtag_invalid');
    expect(checkContent(draft({ body: 'a'.repeat(300) }), OPTIONS).every((i) => i.blocking)).toBe(true);
  });

  it('interdits : promesse de revenu, prix non décidé, données personnelles ; prix décidés et numéro public admis', () => {
    const kinds = (body: string, over: Partial<ContentDraft> = {}) => checkContent(draft({ body, ...over }), OPTIONS).map((i) => i.kind);
    expect(kinds('Gagnez 1 500 $ par semaine en conduisant avec nous.')).toContain('revenue_promise');
    expect(kinds('Revenus garantis chaque mois.')).toContain('revenue_promise');
    expect(kinds('Drivers earn $2,000 per week.', { language: 'en', space: 'linkedin' })).toContain('revenue_promise');
    expect(kinds('Earn $500 a day driving.', { language: 'en', space: 'linkedin' })).toContain('revenue_promise');
    expect(kinds('Le transfert aéroport coûte 55 $.')).toContain('undecided_price');
    expect(kinds('Le transfert aéroport coûte 48,20 $, prix fixe.')).not.toContain('undecided_price');
    expect(kinds('Formation à $113.83 tout compris.')).not.toContain('undecided_price');
    expect(kinds('Appelez-moi au 514 555 0199.')).toContain('personal_data');
    expect(kinds('Écrivez-nous sur WhatsApp au +1 438 900 4990.')).not.toContain('personal_data');
    expect(kinds('Écrivez à jean@exemple.com.')).toContain('personal_data');
    expect(kinds('Écrivez à contact@neomoov.net.')).not.toContain('personal_data');
    expect(normalizePrice('$48.2')).toBe('48,20 $');
    expect(normalizePrice('1 234 $')).toBe('1234 $');
    expect(normalizePrice('$')).toBe('0 $');
  });

  it('vouvoiement et sujets sensibles : avertissements non bloquants, mais contenu sensible ; appel à l\'action sans adresse', () => {
    const informal = checkContent(draft({ body: 'Réserve ta course, tu verras la différence.' }), OPTIONS);
    expect(informal.find((i) => i.kind === 'informal_address')).toMatchObject({ blocking: false });
    expect(checkContent(draft({ body: 'Book your ride, you will see.', language: 'en', space: 'x' }), OPTIONS).map((i) => i.kind)).not.toContain('informal_address');
    // Lettres accentuées : « êtes », « côte » et « sélection » ne sont ni du tutoiement ni un sujet sensible.
    const accents = checkContent(draft({ body: 'Vous êtes attendus sur la côte, avec notre sélection de véhicules.' }), OPTIONS).map((i) => i.kind);
    expect(accents).not.toContain('informal_address');
    expect(accents).not.toContain('sensitive_topic');
    expect(checkContent(draft({ body: 'Tu peux réserver.' }), OPTIONS).map((i) => i.kind)).toContain('informal_address');
    expect(checkContent(draft({ body: 'Pendant l\'élection, réservez tôt.' }), OPTIONS).map((i) => i.kind)).toContain('sensitive_topic');
    const sensitive = checkContent(draft({ body: 'Après l\'accident de la semaine dernière, nos chauffeurs redoublent de prudence.' }), OPTIONS);
    expect(sensitive).toEqual([{ kind: 'sensitive_topic', detail: expect.stringContaining('accident'), blocking: false }]);
    expect(isSensitive(false, sensitive)).toBe(true);
    expect(isSensitive(true, [])).toBe(true);
    expect(autoPublishable('auto', false, sensitive)).toBe(true);
    expect(checkContent(draft({ body: 'Nos tarifs battent Uber.' }), OPTIONS).map((i) => i.kind)).toContain('sensitive_topic');
    const noUrl = checkContent(draft({ cta: 'reserve' }), { ...OPTIONS, ctaUrls: {} });
    expect(noUrl).toEqual([{ kind: 'missing_cta_link', detail: expect.stringContaining('reserve'), blocking: false }]);
    expect(checkContent(draft({ cta: 'none' }), { ...OPTIONS, ctaUrls: {} })).toEqual([]);
    expect(checkContent(draft({ space: 'instagram', cta: 'reserve' }), { ...OPTIONS, ctaUrls: {} }).map((i) => i.kind)).not.toContain('missing_cta_link');
    expect(checkContent(draft({ body: 'Merci à tous.' }), { allowedPrices: [], ctaUrls: OPTIONS.ctaUrls })).toEqual([]);
  });
});

describe('marketing : calendrier et créneaux', () => {
  it('semaine : lundi de la semaine d\'une date, semaine suivante ; instants locaux (heure avancée et normale)', () => {
    expect(weekStartOf('2026-10-02')).toBe('2026-09-28');
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28');
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28');
    expect(nextWeekStart(new Date('2026-10-02T13:00:00Z'), TZ)).toBe('2026-10-05');
    expect(zonedInstant('2026-10-05', '09:00', TZ).toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(zonedInstant('2026-12-07', '09:00', TZ).toISOString()).toBe('2026-12-07T14:00:00.000Z');
    expect(slotInstant('2026-10-05', { day: 3, time: '12:30' }, TZ).toISOString()).toBe('2026-10-07T16:30:00.000Z');
  }, 20_000);

  it('réglage des créneaux : jours et heures valides gardés, le reste remplacé par les défauts', () => {
    expect(parseSlots(null)).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('x')).toEqual(DEFAULT_SLOTS);
    const parsed = parseSlots({ x: [{ day: 2, time: '07:15' }, { day: 9, time: '07:15' }, { day: 1, time: '25:00' }, null, 'bad'], facebook: [], inconnu: [{ day: 1, time: '10:00' }] });
    expect(parsed.x).toEqual([{ day: 2, time: '07:15' }]);
    expect(parsed.facebook).toEqual(DEFAULT_SLOTS.facebook);
  });

  it('candidats : créneaux triés puis jours libres la première semaine ; attribution par espace, débordement, instants passés sautés', () => {
    const slots = { x: [{ day: 3, time: '09:00' }, { day: 1, time: '09:00' }] };
    const first = slotCandidates('x', '2026-10-05', slots, TZ, true);
    expect(first.map((d) => d.toISOString())).toEqual(['2026-10-05T13:00:00.000Z', '2026-10-07T13:00:00.000Z', '2026-10-06T13:00:00.000Z', '2026-10-08T13:00:00.000Z', '2026-10-09T13:00:00.000Z', '2026-10-10T13:00:00.000Z', '2026-10-11T13:00:00.000Z']);
    expect(slotCandidates('x', '2026-10-05', slots, TZ, false)).toHaveLength(2);
    expect(slotCandidates('newsletter', '2026-10-05', {}, TZ, false)).toHaveLength(1);
    expect(slotCandidates('newsletter', '2026-10-05', { newsletter: [] }, TZ, false)).toHaveLength(1);
    // Deux créneaux le même jour : triés par heure.
    expect(slotCandidates('x', '2026-10-05', { x: [{ day: 1, time: '18:00' }, { day: 1, time: '09:00' }] }, TZ, false).map((d) => d.toISOString())).toEqual(['2026-10-05T13:00:00.000Z', '2026-10-05T22:00:00.000Z']);
    const items = [{ space: 'x' as const }, { space: 'x' as const }, { space: 'x' as const }, { space: 'newsletter' as const }];
    const assigned = assignSlots(items, '2026-10-05', slots, TZ);
    expect(assigned.map((d) => d.toISOString())).toEqual(['2026-10-05T13:00:00.000Z', '2026-10-07T13:00:00.000Z', '2026-10-06T13:00:00.000Z', '2026-10-08T14:00:00.000Z']);
    // Huit contenus sur un espace à un seul créneau : la semaine, puis la semaine suivante.
    const many = assignSlots(Array.from({ length: 8 }, () => ({ space: 'newsletter' as const })), '2026-10-05', {}, TZ);
    expect(many[6]!.toISOString()).toBe('2026-10-11T14:00:00.000Z');
    expect(many[7]!.toISOString()).toBe('2026-10-15T14:00:00.000Z');
    // Instants passés sautés (le prochain vrai créneau avant les jours libres) ; semaine entièrement passée : repli sur la semaine de l'instant.
    const late = assignSlots([{ space: 'x' as const }, { space: 'x' as const }], '2026-10-05', slots, TZ, new Date('2026-10-06T00:00:00Z'));
    expect(late.map((d) => d.toISOString())).toEqual(['2026-10-07T13:00:00.000Z', '2026-10-06T13:00:00.000Z']);
    const past = assignSlots([{ space: 'x' as const }, { space: 'x' as const }], '2026-09-07', slots, TZ, new Date('2026-10-11T23:00:00Z'));
    expect(past.map((d) => d.toISOString())).toEqual(['2026-10-12T13:00:00.000Z', '2026-10-14T13:00:00.000Z']);
  });

  it('mesures à J+1 puis J+7, historique borné ; délais de nouvelle tentative', () => {
    const published = new Date('2026-10-05T13:00:00Z');
    expect(nextMeasureAt(published, [1, 7], 0)!.toISOString()).toBe('2026-10-06T13:00:00.000Z');
    expect(nextMeasureAt(published, [1, 7], 1)!.toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(nextMeasureAt(published, [1, 7], 2)).toBeNull();
    const once = recordMeasure(null, { reach: 10, interactions: 2, clicks: 1 }, published, 1);
    expect(once).toEqual({ reach: 10, interactions: 2, clicks: 1, measuredAt: published.toISOString(), history: [{ at: published.toISOString(), day: 1, reach: 10, interactions: 2, clicks: 1 }] });
    let metrics = EMPTY_METRICS;
    for (let i = 0; i < 15; i += 1) metrics = recordMeasure(metrics, { reach: i, interactions: 0, clicks: 0 }, published, 7);
    expect(metrics.history).toHaveLength(12);
    expect(metrics.reach).toBe(14);
    expect(recordMeasure({ reach: 1 }, { reach: 2, interactions: 0, clicks: 0 }, published, 1).history).toHaveLength(1);
    expect(retryDelayMs(1)).toBe(300_000);
    expect(retryDelayMs(2)).toBe(1_800_000);
    expect(retryDelayMs(3)).toBe(7_200_000);
  });
});

describe('marketing : commentaires simples', () => {
  const texts = { hours: { fr: 'Service de 5 h à 23 h, réservation 2 heures à l\'avance.', en: 'Service from 5 am to 11 pm, book 2 hours ahead.' }, bookingUrl: 'https://neomoov.net/reserver' };

  it('remerciement, horaires, réservation : réponse automatique dans la langue ; le reste part vers un humain', () => {
    const thanks = classifyComment('Merci, super service !');
    expect(thanks).toEqual({ intent: 'thanks', language: 'fr', negative: false, simple: true });
    expect(simpleReply(thanks, texts)).toContain('Merci');
    expect(simpleReply(classifyComment('Thanks, great service, we love it!'), texts)).toContain('Thank you');
    const hours = classifyComment('Are you open at night? What are your hours?');
    expect(hours).toMatchObject({ intent: 'hours', language: 'en', simple: true });
    expect(simpleReply(hours, texts)).toBe(texts.hours.en);
    expect(simpleReply(classifyComment('Vous êtes ouverts la nuit ?'), texts)).toBe(texts.hours.fr);
    const booking = classifyComment('Comment réserver pour l\'aéroport et combien ça coûte ?');
    expect(booking).toMatchObject({ intent: 'booking', language: 'fr', simple: true });
    expect(simpleReply(booking, texts)).toContain(texts.bookingUrl);
    expect(simpleReply(classifyComment('How much to book a ride to the airport?'), texts)).toContain('book online');
    const other = classifyComment('Est-ce que vos chauffeurs acceptent les chiens ?');
    expect(other).toMatchObject({ intent: 'other', simple: false });
    expect(simpleReply(other, texts)).toBeNull();
    expect(simpleReply({ intent: 'other', language: 'fr', negative: false, simple: true }, texts)).toBeNull();
  });

  it('ton négatif : jamais de réponse automatique, même sur une intention simple', () => {
    const negative = classifyComment('Merci pour rien, c\'est une arnaque, je veux un remboursement');
    expect(negative).toMatchObject({ intent: 'thanks', negative: true, simple: false });
    expect(simpleReply(negative, texts)).toBeNull();
    expect(classifyComment('Worst service ever, scam!')).toMatchObject({ language: 'en', negative: true, simple: false });
  });
});

describe('marketing : référencement', () => {
  const pages: SitePage[] = [
    { id: '1', kind: 'page', url: 'https://neomoov.net/', title: 'Neomoov : chauffeur privé à Montréal, prix fixe', metaTitle: 'Chauffeur privé à Montréal, prix fixe garanti | Neomoov', metaDescription: 'Transport de personnes à Montréal avec chauffeur privé, véhicules électriques, prix tout compris affiché avant de confirmer.', h1: 'Chauffeur privé à Montréal', headings: ['Nos véhicules'], internalLinks: 6, wordCount: 400 },
    { id: '2', kind: 'page', url: 'https://neomoov.net/reserver', title: 'Réserver', metaTitle: null, metaDescription: null, h1: null, headings: [], internalLinks: 0, wordCount: 80 },
    { id: '3', kind: 'page', url: 'https://neomoov.net/aeroport', title: 'Transport aéroport Montréal à prix fixe', metaTitle: 'Transport aéroport Montréal à prix fixe, navette aéroport Montréal | Neomoov', metaDescription: 'Navette aéroport Montréal-Trudeau au prix fixe, chauffeur professionnel, véhicule électrique, réservation en ligne en deux minutes.', h1: 'Transport aéroport Montréal', headings: [], internalLinks: 3, wordCount: 300 },
  ];
  const stats: SearchStat[] = [
    { page: 'https://neomoov.net/aeroport', query: 'navette aéroport montréal', clicks: 12, impressions: 400, position: 8.2 },
    { page: 'https://neomoov.net/aeroport', query: 'combien coûte un taxi pour l\'aéroport de montréal', clicks: 3, impressions: 150, position: 14 },
    { page: null, query: 'chauffeur électrique montréal', clicks: 0, impressions: 30, position: 25 },
    { page: 'https://neomoov.net/', query: 'how much is a ride to yul', clicks: 1, impressions: 20, position: 18.5 },
  ];
  const keywords = ['chauffeur privé Montréal', 'transport aéroport Montréal prix fixe', 'navette aéroport Montréal', 'chauffeur électrique Montréal', 'formation chauffeur taxi Montréal'];

  it('couverture des mots-clés : mots significatifs sans accents ni mots vides', () => {
    expect(keywordTokens('transport aéroport Montréal prix fixe')).toEqual(['transport', 'aeroport', 'montreal']);
    expect(keywordTokens('de la')).toEqual([]);
    expect(pageCoversKeyword(pages[0]!, 'chauffeur privé Montréal')).toBe(true);
    expect(pageCoversKeyword(pages[2]!, 'navette aéroport Montréal')).toBe(true);
    expect(pageCoversKeyword(pages[1]!, 'navette aéroport Montréal')).toBe(false);
    expect(pageCoversKeyword(pages[0]!, 'de la')).toBe(false);
  });

  it('constats : titres et descriptions hors limites, H1 absent, maillage faible, mots-clés sans page, questions des requêtes', () => {
    const findings = seoFindings(pages, keywords, stats);
    const of = (action: string, ref: string | null) => findings.filter((f) => f.action === action && f.targetRef === ref);
    // Page « Réserver » : titre trop court, description absente, aucun H1, aucun lien interne.
    expect(of('fix_title', '2')).toHaveLength(2);
    expect(of('fix_title', '2')[0]).toMatchObject({ justification: 'Balise titre de 8 caractères (30 à 60 attendus)', keyword: null });
    expect(of('fix_title', '2')[1]).toMatchObject({ justification: 'Aucun en-tête H1 sur la page', proposal: { heading: 'h1' } });
    expect(of('fix_description', '2')[0]).toMatchObject({ justification: 'Description absente' });
    expect(of('internal_link', '2')[0]!.proposal).toMatchObject({ candidates: [{ id: '1' }, { id: '3' }] });
    // Page aéroport : titre trop long (mot-clé rattaché), description trop longue.
    expect(of('fix_title', '3')[0]).toMatchObject({ justification: expect.stringContaining('caractères (30 à 60'), keyword: 'transport aéroport Montréal prix fixe' });
    expect(of('fix_description', '3')).toHaveLength(0);
    expect(of('fix_title', '1')).toHaveLength(0);
    // Mots-clés sans page : chauffeur électrique (30 impressions sur une requête proche) et formation.
    const articles = findings.filter((f) => f.action === 'new_article');
    expect(articles.map((f) => f.keyword)).toEqual(['chauffeur électrique Montréal', 'formation chauffeur taxi Montréal']);
    expect(articles[0]!.justification).toContain('30 impressions');
    expect(articles[1]!.justification).not.toContain('impressions');
    // Questions : les deux requêtes interrogatives, la plus vue d'abord, rattachées à leur page.
    const questions = findings.filter((f) => f.action === 'faq_question');
    expect(questions.map((f) => [f.keyword, f.targetRef])).toEqual([['combien coûte un taxi pour l\'aéroport de montréal', '3'], ['how much is a ride to yul', '1']]);
    expect(seoFindings([], [], [{ page: 'https://inconnue', query: 'comment réserver', clicks: 0, impressions: 1, position: 50 }])[0]).toMatchObject({ action: 'faq_question', targetKind: 'site', targetRef: null });
    expect(seoFindings([], [], [{ page: null, query: 'how to book', clicks: 0, impressions: 2, position: 40 }])[0]).toMatchObject({ action: 'faq_question', targetKind: 'site', keyword: 'how to book' });
    expect(seoFindings([{ ...pages[0]!, metaTitle: '   ', metaDescription: 'x'.repeat(200) }], [], [])).toMatchObject([{ action: 'fix_title', justification: 'Balise titre absente' }, { action: 'fix_description', justification: 'Description de 200 caractères (70 à 155 attendus)' }]);
  });

  it('mesures agrégées d\'une page ou du site : clics, impressions, position pondérée', () => {
    expect(aggregateStats(stats, 'https://neomoov.net/aeroport')).toEqual({ clicks: 15, impressions: 550, position: 9.8, queries: 2 });
    expect(aggregateStats(stats, null)).toMatchObject({ clicks: 16, impressions: 600, queries: 4 });
    expect(aggregateStats(stats, 'https://neomoov.net/absente')).toEqual({ clicks: 0, impressions: 0, position: null, queries: 0 });
  });
});

describe('marketing : schémas', () => {
  it('sorties structurées et modification d\'un contenu', () => {
    expect(contentCalendarOutputSchema.safeParse({ items: [{ space: 'x', format: 'post', language: 'en', title: null, body: 'Hi', caption: null, hashtags: [], cta: 'none', sensitive: false, visualHeadline: 'Hi', rationale: 'r' }], summary: 's' }).success).toBe(true);
    expect(contentCalendarOutputSchema.safeParse({ items: [{ space: 'myspace' }], summary: 's' }).success).toBe(false);
    expect(seoPlanOutputSchema.safeParse({ tasks: [{ action: 'fix_title', targetRef: '2', keyword: null, justification: 'j', proposal: { title: 'T', description: null, question: null, answer: null, outline: [], body: null, linkFrom: null, linkTo: null, anchor: null } }], summary: 's' }).success).toBe(true);
    expect(contentUpdateSchema.safeParse({}).success).toBe(false);
    expect(contentUpdateSchema.safeParse({ title: 'Nouveau titre' }).success).toBe(true);
  });
});
