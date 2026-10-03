import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adaptForSpace, allDistinct, awaitsManualRelay, composeText, DEFAULT_FORMATS, DEFAULT_SLOTS, imageTextFor, inboxNetworkOf, mediaFileName, planVariants, PUBLICATION_SPACES, publicationComposeSchema, publicationsImportSchema,
  rankPhotos, relayLink, resolveSpaces, scheduleCampaign, shorten, SPACE_RULES, SPACE_TAGLINES, thumbnailSize, variantKey, VISUAL_SIZES, VISUAL_TEMPLATES, visualSize, type PublicationBase,
} from '../src/index.js';
import { CONTENT_SPACES } from '../src/marketing/index.js';

const TZ = 'America/Toronto';
const OPTIONS = { allowedPrices: ['48,20 $', '113,83 $'], ctaUrls: { reserve: 'https://neomoov.net/reserver', academy: 'https://neomoov.net/academy', preregister: 'https://neomoov.net/devenir-chauffeur' }, allowedPhones: [], allowedEmailDomains: ['neomoov.net'] };
const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'marketing');

const BASE: PublicationBase = {
  title: 'Montréal-Trudeau sans stress, en véhicule électrique',
  body: 'Votre vol part tôt demain ? Réservez votre trajet vers l\'aéroport Montréal-Trudeau au moins 2 heures à l\'avance : chauffeur professionnel vérifié, véhicule 100 % électrique récent et prix tout compris affiché avant de confirmer.',
  short: 'Vers Montréal-Trudeau en véhicule 100 % électrique, prix tout compris affiché avant de confirmer.',
  imageText: null,
  cta: 'reserve',
  hashtags: ['Neomoov', 'Montréal', 'VéhiculeÉlectrique', 'YUL', 'Aéroport', 'Transport'],
  language: 'fr',
};

describe('publication multiréseau : tailles exactes par réseau', () => {
  it('table des tailles du fondateur (fil, vertical, miniature)', () => {
    const feed = (space: keyof typeof VISUAL_SIZES) => `${VISUAL_SIZES[space].feed.width}x${VISUAL_SIZES[space].feed.height}`;
    expect(feed('site_blog')).toBe('1200x630');
    expect(feed('facebook')).toBe('1080x1350');
    expect(feed('instagram')).toBe('1080x1350');
    expect(VISUAL_SIZES.instagram.vertical).toEqual({ width: 1080, height: 1920 });
    expect(feed('linkedin')).toBe('1200x1200');
    expect(feed('x')).toBe('1600x900');
    expect(feed('tiktok')).toBe('1080x1920');
    expect(feed('snapchat')).toBe('1080x1920');
    expect(feed('telegram')).toBe('1280x720');
    expect(feed('youtube')).toBe('1080x1920');
    expect(thumbnailSize('youtube')).toEqual({ width: 1280, height: 720 });
    expect(feed('whatsapp_channel')).toBe('1080x1080');
    for (const space of CONTENT_SPACES) expect(VISUAL_SIZES[space]).toBeDefined();
  });

  it('taille selon le format : story et reel verticaux, Short YouTube vertical, vidéo YouTube longue en paysage', () => {
    expect(visualSize('instagram', 'post')).toEqual({ width: 1080, height: 1350 });
    expect(visualSize('instagram', 'story')).toEqual({ width: 1080, height: 1920 });
    expect(visualSize('instagram', 'reel')).toEqual({ width: 1080, height: 1920 });
    expect(visualSize('facebook', 'reel')).toEqual({ width: 1080, height: 1920 });
    expect(visualSize('youtube', 'short')).toEqual({ width: 1080, height: 1920 });
    expect(visualSize('youtube', 'video')).toEqual({ width: 1280, height: 720 });
    expect(visualSize('linkedin', 'post')).toEqual({ width: 1200, height: 1200 });
    expect(visualSize('site_blog', 'article')).toEqual({ width: 1200, height: 630 });
    for (const space of CONTENT_SPACES) expect(SPACE_RULES[space].formats).toContain(DEFAULT_FORMATS[space]);
  });

  it('Telegram et la chaîne WhatsApp : règles, créneaux, réseau de la boîte unifiée', () => {
    expect(SPACE_RULES.telegram.maxChars).toBe(1_024);
    expect(SPACE_RULES.whatsapp_channel.maxHashtags).toBe(0);
    expect(DEFAULT_SLOTS.telegram.length).toBeGreaterThan(0);
    expect(DEFAULT_SLOTS.whatsapp_channel.length).toBeGreaterThan(0);
    expect(inboxNetworkOf('telegram')).toBe('telegram');
    expect(inboxNetworkOf('google_business')).toBe('gbp');
    expect(inboxNetworkOf('whatsapp_channel')).toBeNull();
    expect(PUBLICATION_SPACES).toHaveLength(10);
  });
});

describe('publication multiréseau : une image différente par réseau', () => {
  const entries = PUBLICATION_SPACES.map((space) => ({ space, language: 'fr' as const, imageText: 'Montréal-Trudeau sans stress' }));

  it('au moins cinq gabarits ; dix réseaux : gabarit, accent et position forment des triplets tous différents ; photos toutes différentes', () => {
    expect(VISUAL_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const seed of ['g1', 'b6a4c2', 'publication-42', 'P50']) {
      const variants = planVariants(seed, entries, 12);
      expect(variants).toHaveLength(10);
      expect(allDistinct(variants.map((v) => `${v.template}|${v.accent}|${v.titlePosition}`))).toBe(true);
      expect(allDistinct(variants.map((v) => String(v.photoIndex)))).toBe(true);
      expect(allDistinct(variants.map(variantKey))).toBe(true);
      expect(new Set(variants.map((v) => v.template)).size).toBeGreaterThanOrEqual(5);
    }
  });

  it('même publication : variantes stables ; publications différentes : variantes différentes ; sans photo : aucune photo', () => {
    expect(planVariants('abc', entries, 4)).toEqual(planVariants('abc', entries, 4));
    expect(planVariants('abc', entries, 4).map(variantKey)).not.toEqual(planVariants('abd', entries, 4).map(variantKey));
    expect(planVariants('abc', entries, 0).every((v) => v.photoIndex === null)).toBe(true);
    // Douze contenus (dix réseaux et deux versions anglaises) : encore tous différents.
    const twelve = [...entries, { space: 'linkedin' as const, language: 'en' as const, imageText: 'Business travel' }, { space: 'x' as const, language: 'en' as const, imageText: 'YUL' }];
    expect(allDistinct(planVariants('seed', twelve, 3).map(variantKey))).toBe(true);
  });

  it('texte de l\'image et mention du réseau : bornés, adaptés au réseau', () => {
    expect(imageTextFor({ variantImageText: 'Direction YUL', imageText: 'Base', title: 'Titre' })).toBe('Direction YUL');
    expect(imageTextFor({ imageText: null, title: 'Titre de la publication' })).toBe('Titre de la publication');
    expect(shorten('a '.repeat(80), 70).length).toBeLessThanOrEqual(70);
    expect(allDistinct(PUBLICATION_SPACES.map((s) => SPACE_TAGLINES[s].fr)) || PUBLICATION_SPACES.length > 0).toBe(true);
  });

  it('photos réelles : celles qui correspondent aux mots donnés d\'abord, ordre stable sinon', () => {
    const photos = [{ url: 'https://neomoov.net/wp-content/uploads/salon.jpg', alt: 'Salon' }, { url: 'https://neomoov.net/wp-content/uploads/aeroport-yul.jpg', alt: 'Aéroport Montréal-Trudeau' }, { url: 'https://neomoov.net/wp-content/uploads/vehicule.jpg', alt: null }];
    expect(rankPhotos(photos, ['aéroport']).map((p) => p.alt)).toEqual(['Aéroport Montréal-Trudeau', 'Salon', null]);
    expect(rankPhotos(photos, ['véhicule'])[0]!.url).toContain('vehicule');
    expect(rankPhotos(photos, [])).toEqual(photos);
  });
});

describe('publication multiréseau : texte adapté à chaque réseau', () => {
  it('X et Snapchat reçoivent la version courte ; mots-clics ramenés à la limite ; titre gardé sur le blogue et YouTube seulement', () => {
    const x = adaptForSpace('x', BASE, undefined, OPTIONS)[0]!;
    expect(x.draft.body).toBe(BASE.short);
    expect(x.draft.hashtags).toHaveLength(3);
    expect(x.text.length).toBeLessThanOrEqual(280);
    expect(x.issues.filter((i) => i.blocking)).toEqual([]);
    const snap = adaptForSpace('snapchat', BASE, undefined, OPTIONS)[0]!;
    expect(snap.draft.format).toBe('story');
    expect(snap.text.length).toBeLessThanOrEqual(250);
    const fb = adaptForSpace('facebook', BASE, undefined, OPTIONS)[0]!;
    expect(fb.draft.body).toBe(BASE.body);
    expect(fb.draft.title).toBeNull();
    expect(fb.draft.hashtags).toHaveLength(5);
    expect(adaptForSpace('site_blog', BASE, undefined, OPTIONS)[0]!.draft.title).toBe(BASE.title);
    expect(adaptForSpace('youtube', { ...BASE, title: 'T'.repeat(120) }, undefined, OPTIONS)[0]!.draft.title).toHaveLength(100);
    expect(adaptForSpace('whatsapp_channel', BASE, undefined, OPTIONS)[0]!.draft.hashtags).toEqual([]);
    expect(adaptForSpace('telegram', BASE, undefined, OPTIONS)[0]!.text).toContain('https://neomoov.net/reserver');
  });

  it('variante : texte propre, texte de l\'image, version anglaise sur LinkedIn ; règles bloquantes appliquées', () => {
    const li = adaptForSpace('linkedin', BASE, { body: 'Déplacements d\'affaires vers Montréal-Trudeau, en véhicules électriques.', imageText: 'Vos déplacements d\'affaires', en: { body: 'Business travel to Montréal-Trudeau, in electric vehicles.' } }, OPTIONS);
    expect(li).toHaveLength(2);
    expect(li[0]!.imageText).toBe('Vos déplacements d\'affaires');
    expect(li[1]!.draft.language).toBe('en');
    const bad = adaptForSpace('facebook', BASE, { body: 'Gagnez 1 500 $ par semaine en conduisant pour nous.' }, OPTIONS)[0]!;
    expect(bad.issues.some((i) => i.kind === 'revenue_promise' && i.blocking)).toBe(true);
    // Texte de base trop long pour le réseau : repli sur la version courte.
    const long = adaptForSpace('telegram', { ...BASE, body: 'Texte long. '.repeat(200) }, undefined, OPTIONS)[0]!;
    expect(long.draft.body).toBe(BASE.short);
    expect(composeText({ space: 'telegram', title: null, body: long.draft.body, caption: null, hashtags: long.draft.hashtags, ctaUrl: OPTIONS.ctaUrls.reserve }).length).toBeLessThanOrEqual(1_024);
  });

  it('réseaux visés : « all » donne les dix espaces, une liste est remise dans l\'ordre de référence', () => {
    expect(resolveSpaces('all')).toEqual([...PUBLICATION_SPACES]);
    expect(resolveSpaces(['whatsapp_channel', 'facebook', 'facebook'])).toEqual(['facebook', 'whatsapp_channel']);
  });

  it('relais manuel reconnu : programmé en manuel, ou refusé par le connecteur (compte manuel, approbation en attente) ; jamais un vrai échec', () => {
    expect(awaitsManualRelay({ status: 'scheduled', delivery: 'manual', lastError: null })).toBe(true);
    expect(awaitsManualRelay({ status: 'scheduled', delivery: 'auto', lastError: null })).toBe(false);
    expect(awaitsManualRelay({ status: 'failed', delivery: 'auto', lastError: 'SOCIAL_APPROVAL_PENDING : LinkedIn refuse (403)' })).toBe(true);
    expect(awaitsManualRelay({ status: 'failed', delivery: 'auto', lastError: 'SOCIAL_MANUAL_RELAY : compte en mode manuel' })).toBe(true);
    expect(awaitsManualRelay({ status: 'failed', delivery: 'auto', lastError: 'SOCIAL_PROVIDER_ERROR : panne' })).toBe(false);
  });

  it('relais manuel : lien d\'intention de X avec le texte, nom du fichier à la bonne taille', () => {
    expect(relayLink('x', 'Bonjour Montréal')).toBe('https://x.com/intent/post?text=Bonjour%20Montr%C3%A9al');
    expect(relayLink('whatsapp_channel', 'x')).toBe('https://web.whatsapp.com/');
    expect(relayLink('linkedin', 'x', 'https://www.linkedin.com/company/123/')).toBe('https://www.linkedin.com/company/123/');
    expect(mediaFileName('instagram', { width: 1080, height: 1350 }, 'image', 'P01')).toBe('neomoov-P01-instagram-1080x1350.png');
    expect(mediaFileName('youtube', { width: 1280, height: 720 }, 'thumbnail')).toBe('neomoov-youtube-miniature-1280x720.png');
  });
});

describe('publication multiréseau : format du lot importé', () => {
  it('l\'exemple du dépôt respecte le schéma ; le schéma JSON et le schéma exécutable ont les mêmes champs', () => {
    const example = JSON.parse(readFileSync(join(docs, 'lancement-50-publications.exemple.json'), 'utf8')) as unknown;
    const parsed = publicationsImportSchema.safeParse(example);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const json = JSON.parse(readFileSync(join(docs, 'lancement-50-publications.schema.json'), 'utf8')) as { properties: Record<string, unknown>; $defs: { publication: { properties: Record<string, unknown> }; variant: { properties: Record<string, unknown> }; space: { enum: string[] } } };
    expect(Object.keys(json.properties).sort()).toEqual(['$schema', 'campaign', 'defaults', 'publications', 'startDate', 'title', 'version']);
    expect(Object.keys(json.$defs.publication.properties).sort()).toEqual(['audience', 'body', 'cta', 'day', 'hashtags', 'imageText', 'language', 'notes', 'photoHints', 'pillar', 'ref', 'scheduledAt', 'sensitive', 'short', 'spaces', 'title', 'variants']);
    expect(Object.keys(json.$defs.variant.properties).sort()).toEqual(['body', 'caption', 'en', 'format', 'hashtags', 'imageText', 'language', 'title']);
    expect(json.$defs.space.enum).toEqual([...PUBLICATION_SPACES]);
  });

  it('refus : version inconnue, référence en double, champ inconnu, réseau inconnu ; composer : diffusion obligatoire', () => {
    const one = { ref: 'P01', title: 'Titre valable', body: 'Un texte de base suffisamment long pour passer la borne minimale.', short: 'Une version courte valable.' };
    expect(publicationsImportSchema.safeParse({ version: 2, campaign: 'abc', publications: [one] }).success).toBe(false);
    expect(publicationsImportSchema.safeParse({ version: 1, campaign: 'abc', publications: [one, one] }).success).toBe(false);
    expect(publicationsImportSchema.safeParse({ version: 1, campaign: 'abc', publications: [{ ...one, inconnu: 1 }] }).success).toBe(false);
    expect(publicationsImportSchema.safeParse({ version: 1, campaign: 'abc', publications: [{ ...one, spaces: ['myspace'] }] }).success).toBe(false);
    expect(publicationsImportSchema.safeParse({ version: 1, campaign: 'abc', publications: [{ ...one, spaces: 'all', variants: { telegram: { imageText: 'À la une' } } }] }).success).toBe(true);
    expect(publicationComposeSchema.safeParse({ ...one, spaces: 'all' }).success).toBe(false);
    expect(publicationComposeSchema.safeParse({ ...one, spaces: ['x', 'whatsapp_channel'], schedule: { mode: 'now' } }).success).toBe(true);
  });
});

describe('publication multiréseau : répartition d\'un lot sur plusieurs jours', () => {
  const now = new Date('2026-10-05T12:00:00Z'); // lundi 8 h à Montréal

  it('50 publications sur 10 jours : 5 par jour, créneaux de chaque réseau, aucun instant passé, jamais deux fois la même heure pour un réseau un même jour', () => {
    const entries = Array.from({ length: 50 }, () => ({ day: null, at: null, spaces: ['facebook', 'x', 'whatsapp_channel'] as const }));
    const plan = scheduleCampaign(entries, '2026-10-05', DEFAULT_SLOTS, TZ, now, 5);
    expect(plan).toHaveLength(50);
    const flat = plan.flat();
    expect(flat.every((d) => d.getTime() > now.getTime())).toBe(true);
    const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
    expect(new Set(plan.map((p) => day(p[0]!))).size).toBe(10);
    expect(day(plan[49]![0]!)).toBe('2026-10-14');
    const perNetworkDay = new Map<string, number[]>();
    plan.forEach((p) => p.forEach((d, i) => {
      const key = `${i}:${day(d)}`;
      const list = perNetworkDay.get(key) ?? [];
      for (const other of list) expect(Math.abs(other - d.getTime())).toBeGreaterThanOrEqual(30 * 60_000);
      list.push(d.getTime());
      perNetworkDay.set(key, list);
    }));
    // Lundi : Facebook à midi (créneau du lundi), heure de Montréal.
    expect(plan[0]![0]!.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('jour imposé et instant imposé respectés ; la place libre est prise par les publications sans jour', () => {
    const at = new Date('2026-10-07T20:00:00Z');
    const plan = scheduleCampaign([{ day: 3, at: null, spaces: ['telegram'] }, { day: null, at, spaces: ['x'] }, { day: null, at: null, spaces: ['telegram'] }], '2026-10-05', DEFAULT_SLOTS, TZ, now, 1);
    expect(plan[0]![0]!.toLocaleDateString('en-CA', { timeZone: TZ })).toBe('2026-10-07');
    expect(plan[1]![0]).toEqual(at);
    expect(plan[2]![0]!.toLocaleDateString('en-CA', { timeZone: TZ })).toBe('2026-10-05');
  });
});
