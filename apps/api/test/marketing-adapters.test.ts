import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BrevoNewsletterPublisher, newsletterHtml } from '../src/adapters/real/brevo.js';
import { NotConfiguredPublisher, realSearchConsole, realSocialPublishers, realTts, SPACE_VARIABLES } from '../src/adapters/real/marketing.js';
import { MetaFacebookPublisher, MetaGraphClient, MetaInstagramPublisher } from '../src/adapters/real/meta-graph.js';
import { GoogleSearchConsoleProvider, serviceAccountAssertion } from '../src/adapters/real/search-console.js';
import { wavDurationSeconds } from '../src/adapters/real/tts.js';
import { stripHtml, textToHtml, WordPressConnector } from '../src/adapters/real/wordpress.js';
import { silentWav } from '../src/adapters/mock/marketing.mock.js';
import { loadEnv } from '../src/config/env.js';

/**
 * Phase 1 « entreprise autonome », agent E : adaptateurs réels des connecteurs contre un faux `fetch` (sans réseau) :
 * WordPress (publication, balises, pages, commentaires), Brevo (campagne en brouillon, mesures), Meta (Facebook,
 * Instagram), Search Console (assertion JWT, requête), choix des connecteurs selon l'environnement, durée d'un WAV.
 */
type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };

function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = init?.body;
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, body: raw === undefined || raw === null ? null : typeof raw === 'string' ? raw : `[${(raw as Uint8Array).byteLength} octets]` };
    calls.push(call);
    const out = handler(call);
    const text = out.body === undefined ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    return new Response(text, { status: out.status ?? 200, headers: { 'content-type': 'application/json', ...(out.headers ?? {}) } });
  }) as typeof fetch;
  return { impl, calls };
}

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/neomoov_test', MARKETING_PROVIDER: 'real' };

describe('WordPress réel', () => {
  const page = (id: number, over: Record<string, unknown> = {}) => ({ id, link: `https://neomoov.net/p${id}`, title: { rendered: `Page &amp; ${id}` }, content: { rendered: '<h1>Titre H1</h1><p>Texte <a href="https://neomoov.net/reserver">lien</a> <a href="https://autre.site/x">externe</a> <a href="/aeroport">interne</a></p><h2>Section</h2>' }, meta: { _neomoov_seo_title: 'Balise', _neomoov_seo_desc: '' }, ...over });

  it('publie un article (média en image à la une, catégorie, balises), lit les commentaires et répond', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/wp/v2/media') && c.method === 'POST') return { body: { id: 77 } };
      if (c.url.includes('/wp/v2/categories?slug=blogue')) return { body: [{ id: 5 }] };
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') return { body: { id: 120, link: 'https://neomoov.net/aeroport-sans-stress' } };
      if (c.url.includes('/wp/v2/comments?post=120&per_page=1')) return { body: [], headers: { 'x-wp-total': '4' } };
      if (c.url.includes('/wp/v2/comments?post=120&after=')) return { body: [{ id: 9, author_name: 'Ana', content: { rendered: '<p>Merci &amp; bravo</p>' }, date_gmt: '2026-10-02T12:00:00' }] };
      if (c.url.endsWith('/wp/v2/comments') && c.method === 'POST') return { body: { id: 10 } };
      return { status: 404, body: { message: 'inconnu' } };
    });
    const wp = new WordPressConnector({ baseUrl: 'https://neomoov.net/', user: 'robot', appPassword: 'xxxx yyyy', space: 'site_blog', category: 'blogue', seoMeta: 'neomoov', fetchImpl: impl });
    const result = await wp.publish({ itemId: 'item-1', space: 'site_blog', format: 'article', language: 'fr', title: 'Aéroport sans stress', body: 'Premier paragraphe.\n\n## Sous-titre\n\n- un\n- deux', caption: 'Résumé', hashtags: [], text: 'Aéroport sans stress', ctaUrl: null, media: { key: 'k', contentType: 'image/png', body: Buffer.from([1, 2, 3]), url: null }, draft: false });
    expect(result).toEqual({ externalId: '120', url: 'https://neomoov.net/aeroport-sans-stress', draft: false });
    const upload = calls.find((c) => c.url.endsWith('/wp/v2/media'))!;
    expect(upload.headers['authorization']).toBe(`Basic ${Buffer.from('robot:xxxx yyyy').toString('base64')}`);
    expect(upload.headers['content-disposition']).toContain('neomoov-item-1.png');
    const post = JSON.parse(calls.find((c) => c.url.endsWith('/wp/v2/posts'))!.body!) as Record<string, unknown>;
    expect(post).toMatchObject({ title: 'Aéroport sans stress', status: 'publish', categories: [5], featured_media: 77, excerpt: 'Résumé', meta: { _neomoov_seo_title: 'Aéroport sans stress', _neomoov_seo_desc: 'Résumé' } });
    expect(post['content']).toBe('<p>Premier paragraphe.</p>\n<h2>Sous-titre</h2>\n<ul><li>un</li><li>deux</li></ul>');
    expect(await wp.metrics({ itemId: 'item-1', externalId: '120', externalUrl: null })).toMatchObject({ reach: 0, interactions: 4, clicks: 0 });
    const comments = await wp.comments({ itemId: 'item-1', externalId: '120', externalUrl: null }, new Date('2026-10-01T00:00:00Z'));
    expect(comments).toEqual([{ externalId: '9', author: 'Ana', text: 'Merci & bravo', postedAt: new Date('2026-10-02T12:00:00Z') }]);
    expect(await wp.replyComment({ itemId: 'item-1', externalId: '120', externalUrl: null }, '9', 'Merci !')).toEqual({ externalId: '10' });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ post: 120, parent: 9, content: 'Merci !' });
    expect(JSON.stringify(wp)).not.toContain('yyyy');
  });

  it('lit les pages (balises, H1, en-têtes, liens internes), corrige les balises, crée un brouillon ; une erreur HTTP devient SITE_PROVIDER_ERROR', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.includes('/wp/v2/pages?')) return { body: [page(1), page(2, { meta: {}, yoast_head_json: { title: 'Yoast', description: 'Desc Yoast' } })] };
      if (c.url.includes('/wp/v2/posts?')) return { body: [page(3)] };
      if (c.url.endsWith('/wp/v2/pages/2') && c.method === 'POST') return { body: { id: 2 } };
      if (c.url.endsWith('/wp/v2/pages') && c.method === 'POST') return { body: { id: 50, link: 'https://neomoov.net/?page_id=50' } };
      if (c.url.includes('/wp/v2/media?')) return { body: [{ id: 3, source_url: 'https://neomoov.net/u/a.jpg', alt_text: 'Véhicule', mime_type: 'image/jpeg' }, { id: 4, mime_type: 'image/jpeg' }] };
      return { status: 500, body: { message: 'panne' } };
    });
    const wp = new WordPressConnector({ baseUrl: 'https://neomoov.net', user: 'robot', appPassword: 'secret', space: 'site_blog', category: null, seoMeta: 'neomoov', fetchImpl: impl });
    const pages = await wp.pages();
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ id: '1', kind: 'page', url: 'https://neomoov.net/p1', title: 'Page & 1', metaTitle: 'Balise', metaDescription: null, h1: 'Titre H1', headings: ['Section'], internalLinks: 2, wordCount: 7 });
    expect(pages[1]).toMatchObject({ metaTitle: 'Yoast', metaDescription: 'Desc Yoast' });
    expect(pages[2]!.kind).toBe('post');
    await wp.updateSeo('2', { title: 'Nouveau titre', description: null });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ meta: { _neomoov_seo_title: 'Nouveau titre', _neomoov_seo_desc: '' } });
    expect(await wp.createDraft({ kind: 'page', title: 'Brouillon', content: 'Texte', excerpt: 'Résumé' })).toEqual({ externalId: '50', url: 'https://neomoov.net/?page_id=50' });
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ status: 'draft', title: 'Brouillon' });
    expect(await wp.mediaLibrary(5)).toEqual([{ id: '3', url: 'https://neomoov.net/u/a.jpg', alt: 'Véhicule', mimeType: 'image/jpeg' }]);
    await expect(wp.replyComment({ itemId: 'x', externalId: '1', externalUrl: null }, '1', 'a')).rejects.toMatchObject({ code: 'SITE_PROVIDER_ERROR', status: 502 });
    expect(stripHtml('A&nbsp;&eacute;t&#233; <b>x</b>')).toBe('A été x');
    expect(textToHtml('Bonjour <monde>')).toBe('<p>Bonjour &lt;monde&gt;</p>');
  });
});

describe('Brevo réel', () => {
  it('crée une campagne en brouillon avec la mention de désinscription et lit ses statistiques', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/emailCampaigns') && c.method === 'POST') return { status: 201, body: { id: 4242 } };
      if (c.url.includes('/emailCampaigns/4242')) return { body: { id: 4242, statistics: { globalStats: { sent: 1000, delivered: 980, uniqueViews: 400, uniqueClicks: 55 } } } };
      return { status: 404, body: {} };
    });
    const brevo = new BrevoNewsletterPublisher({ apiKey: 'xkeysib-secret', listId: 7, senderEmail: 'infolettre@neomoov.net', senderName: 'Neomoov', fetchImpl: impl });
    const result = await brevo.publish({ itemId: 'n1', space: 'newsletter', format: 'newsletter', language: 'fr', title: 'Cette semaine', body: 'Texte', caption: null, hashtags: [], text: 'Texte', ctaUrl: 'https://neomoov.net/reserver', media: null, draft: false });
    expect(result).toMatchObject({ externalId: '4242', draft: true });
    const payload = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(calls[0]!.headers['api-key']).toBe('xkeysib-secret');
    expect(payload).toMatchObject({ subject: 'Cette semaine', type: 'classic', recipients: { listIds: [7] }, sender: { email: 'infolettre@neomoov.net' } });
    expect(String(payload['htmlContent'])).toContain('{{ unsubscribe }}');
    expect(String(payload['htmlContent'])).toContain('https://neomoov.net/reserver');
    expect(await brevo.metrics({ itemId: 'n1', externalId: '4242', externalUrl: null })).toMatchObject({ reach: 980, interactions: 400, clicks: 55 });
    expect(await brevo.comments()).toEqual([]);
    await expect(brevo.replyComment()).rejects.toMatchObject({ code: 'SOCIAL_UNSUPPORTED' });
    expect(JSON.stringify(brevo)).not.toContain('xkeysib');
    expect(newsletterHtml('<T>', 'x', null)).not.toContain('<T>');
  });
});

describe('Meta réel (Facebook et Instagram)', () => {
  const client = (handler: Parameters<typeof fakeFetch>[0]) => {
    const f = fakeFetch(handler);
    return { ...f, client: new MetaGraphClient({ pageId: 'PAGE', pageToken: 'EAAB-secret', igUserId: 'IG', version: 'v21.0', fetchImpl: f.impl, pollMs: 1 }) };
  };

  it('Facebook : texte avec lien, photo par adresse, mesures, commentaires et réponse ; le jeton reste dans le corps', async () => {
    const { impl, calls, client: c } = client((call) => {
      if (call.url.includes('/PAGE/feed')) return { body: { id: 'PAGE_1' } };
      if (call.url.includes('/PAGE/photos')) return { body: { id: '55', post_id: 'PAGE_2' } };
      if (call.url.includes('/PAGE_1/insights')) return { body: { data: [{ name: 'post_impressions_unique', values: [{ value: 320 }] }, { name: 'post_engaged_users', values: [{ value: 21 }] }, { name: 'post_clicks', values: [{ value: 8 }] }] } };
      if (call.url.includes('/PAGE_1/comments')) return { body: { data: [{ id: 'c1', from: { name: 'Marc' }, message: 'Super', created_time: '2026-10-02T10:00:00+0000' }] } };
      if (call.url.includes('/c1/comments')) return { body: { id: 'r1' } };
      return { status: 400, body: { error: { message: 'inconnu', code: 100 } } };
    });
    void impl;
    const fb = new MetaFacebookPublisher(c);
    const input = { itemId: 'i', space: 'facebook' as const, format: 'post' as const, language: 'fr' as const, title: null, body: 'Texte', caption: null, hashtags: [], text: 'Texte #a', ctaUrl: 'https://neomoov.net/reserver', media: null, draft: false };
    expect(await fb.publish(input)).toEqual({ externalId: 'PAGE_1', url: 'https://www.facebook.com/PAGE_1', draft: false });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toContain('access_token=EAAB-secret');
    expect(calls[0]!.body).toContain('link=https%3A%2F%2Fneomoov.net%2Freserver');
    expect(calls[0]!.url).not.toContain('secret');
    expect(await fb.publish({ ...input, media: { key: 'k', contentType: 'image/png', body: Buffer.alloc(1), url: 'https://stockage/signed.png' } })).toMatchObject({ externalId: 'PAGE_2' });
    expect(await fb.metrics({ itemId: 'i', externalId: 'PAGE_1', externalUrl: null })).toMatchObject({ reach: 320, interactions: 21, clicks: 8 });
    expect(await fb.comments({ itemId: 'i', externalId: 'PAGE_1', externalUrl: null }, new Date('2026-10-01T00:00:00Z'))).toEqual([{ externalId: 'c1', author: 'Marc', text: 'Super', postedAt: new Date('2026-10-02T10:00:00Z') }]);
    expect(await fb.replyComment({ itemId: 'i', externalId: 'PAGE_1', externalUrl: null }, 'c1', 'Merci')).toEqual({ externalId: 'r1' });
    await expect(fb.metrics({ itemId: 'i', externalId: 'inconnu', externalUrl: null })).rejects.toMatchObject({ code: 'SOCIAL_PROVIDER_ERROR' });
    expect(JSON.stringify(fb)).not.toContain('secret');
  });

  it('Instagram : conteneur image ou Reel attendu jusqu\'à FINISHED, puis publication ; un média est obligatoire', async () => {
    let polls = 0;
    const { client: c } = client((call) => {
      if (call.url.includes('/IG/media') && !call.url.includes('media_publish')) return { body: { id: 'CONT' } };
      if (call.url.includes('/CONT?fields=status_code')) return { body: { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' } };
      if (call.url.includes('/IG/media_publish')) return { body: { id: 'MEDIA1' } };
      if (call.url.includes('/MEDIA1?fields=permalink')) return { body: { permalink: 'https://www.instagram.com/p/abc/' } };
      if (call.url.includes('/MEDIA1/insights')) return { body: { data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'total_interactions', values: [{ value: 40 }] }] } };
      return { status: 400, body: { error: { message: 'inconnu' } } };
    });
    const ig = new MetaInstagramPublisher(c);
    const input = { itemId: 'i', space: 'instagram' as const, format: 'reel' as const, language: 'fr' as const, title: null, body: 'Script', caption: 'Légende', hashtags: [], text: 'Légende', ctaUrl: null, media: { key: 'k', contentType: 'video/mp4', body: Buffer.alloc(1), url: 'https://stockage/signed.mp4' }, draft: false };
    expect(await ig.publish(input)).toEqual({ externalId: 'MEDIA1', url: 'https://www.instagram.com/p/abc/', draft: false });
    expect(polls).toBe(2);
    expect(await ig.metrics({ itemId: 'i', externalId: 'MEDIA1', externalUrl: null })).toMatchObject({ reach: 900, interactions: 40, clicks: 0 });
    await expect(ig.publish({ ...input, media: null })).rejects.toMatchObject({ code: 'SOCIAL_MEDIA_REQUIRED' });
  });
});

describe('Search Console réelle', () => {
  it('signe l\'assertion du compte de service, obtient un jeton (une fois) et lit les lignes par page et requête', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const assertion = serviceAccountAssertion('robot@projet.iam.gserviceaccount.com', pem.replace(/\n/g, '\\n'), 1_700_000_000);
    const [header, claims] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({ iss: 'robot@projet.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token', exp: 1_700_003_600 });
    const { impl, calls } = fakeFetch((c) => {
      if (c.url === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'ya29.jeton', expires_in: 3600 } };
      if (c.url.includes('/searchAnalytics/query')) return { body: { rows: [{ keys: ['https://neomoov.net/aeroport', 'navette aéroport montréal'], clicks: 12.4, impressions: 400, position: 8.2 }] } };
      return { status: 500, body: {} };
    });
    const sc = new GoogleSearchConsoleProvider({ siteUrl: 'sc-domain:neomoov.net', clientEmail: 'robot@projet.iam.gserviceaccount.com', privateKey: pem, fetchImpl: impl, now: () => 1_700_000_000_000 });
    const rows = await sc.query({ from: '2026-09-01', to: '2026-09-28', byPage: true });
    expect(rows).toEqual([{ page: 'https://neomoov.net/aeroport', query: 'navette aéroport montréal', clicks: 12, impressions: 400, position: 8.2 }]);
    await sc.query({ from: '2026-09-01', to: '2026-09-28', byPage: false });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    expect(calls.at(-1)!.url).toContain(encodeURIComponent('sc-domain:neomoov.net'));
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ dimensions: ['query'] });
    expect(JSON.stringify(sc)).not.toContain('PRIVATE');
  });
});

describe('choix des connecteurs réels et durée WAV', () => {
  it('sans clés : onze connecteurs non configurés qui refusent clairement ; avec WordPress, Brevo et Meta : réels', () => {
    const none = loadEnv(base, { dotenv: false });
    const empty = realSocialPublishers(none);
    expect(empty.size).toBe(11);
    expect([...empty.values()].every((p) => p instanceof NotConfiguredPublisher && !p.configured)).toBe(true);
    expect(realTts(none).configured).toBe(false);
    expect(realSearchConsole(none).configured).toBe(false);
    const full = loadEnv({ ...base, WORDPRESS_URL: 'https://neomoov.net', WORDPRESS_USER: 'robot', WORDPRESS_APP_PASSWORD: 'x', BREVO_API_KEY: 'k', BREVO_NEWSLETTER_LIST_ID: '3', BREVO_SENDER_EMAIL: 'a@neomoov.net', META_PAGE_ID: 'P', META_PAGE_TOKEN: 'T', META_IG_USER_ID: 'I' }, { dotenv: false });
    const real = realSocialPublishers(full);
    expect(['site_blog', 'academy', 'newsletter', 'facebook', 'instagram'].every((s) => real.get(s as never)!.configured)).toBe(true);
    expect(real.get('linkedin')!.configured).toBe(false);
    expect(SPACE_VARIABLES.x).toEqual(['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']);
  });

  it('NotConfiguredPublisher : 501 PROVIDER_NOT_CONFIGURED avec les variables attendues', async () => {
    await expect(new NotConfiguredPublisher('tiktok').publish({} as never)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 501, message: expect.stringContaining('TIKTOK_ACCESS_TOKEN') });
  });

  it('durée d\'un WAV PCM ; en-tête absent : null', () => {
    expect(wavDurationSeconds(silentWav(2.5))).toBe(2.5);
    expect(wavDurationSeconds(Buffer.from('pas un wav'))).toBeNull();
  });
});
