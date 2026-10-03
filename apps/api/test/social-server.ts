/**
 * Serveur HTTP simulé des connecteurs de diffusion (tests du 3 octobre 2026) : `fetch` injecté qui répond selon des
 * routes (méthode et motif d'adresse), garde chaque appel (adresse, en-têtes, corps, champs de formulaire) et rejoue des
 * réponses en séquence (jeton refusé puis accepté, 429 puis succès ; la dernière réponse se répète). Aucun appel réseau.
 */
export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Corps texte (JSON, formulaire) ; octets : `[n octets]`. */
  body: string | null;
  bytes: number;
  /** Champs d'un formulaire (`application/x-www-form-urlencoded` ou `multipart/form-data`) ; un fichier : `fichier:<type>:<taille>`. */
  form: Record<string, string> | null;
}

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type Responder = Reply | ((call: Recorded, hit: number) => Reply);

interface Route {
  method: string;
  pattern: string | RegExp;
  replies: Responder[];
  hits: number;
}

export class SocialServer {
  readonly calls: Recorded[] = [];
  private readonly routes: Route[] = [];

  /** Route : une réponse par appel, dans l'ordre ; la dernière sert ensuite à chaque appel. */
  on(method: string, pattern: string | RegExp, ...replies: Responder[]): this {
    this.routes.push({ method: method.toUpperCase(), pattern, replies, hits: 0 });
    return this;
  }

  /** Appels dont l'adresse contient (ou vérifie) le motif. */
  to(pattern: string | RegExp, method?: string): Recorded[] {
    return this.calls.filter((c) => (!method || c.method === method.toUpperCase()) && (typeof pattern === 'string' ? c.url.includes(pattern) : pattern.test(c.url)));
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const raw = init?.body;
    let body: string | null = null;
    let bytes = 0;
    let form: Record<string, string> | null = null;
    if (typeof raw === 'string') {
      body = raw;
      bytes = Buffer.byteLength(raw);
      if ((headers['content-type'] ?? '').includes('x-www-form-urlencoded')) form = Object.fromEntries(new URLSearchParams(raw));
    } else if (raw instanceof FormData) {
      form = {};
      for (const [key, value] of raw.entries()) form[key] = typeof value === 'string' ? value : `fichier:${value.type}:${value.size}`;
      body = '[formulaire]';
    } else if (raw instanceof Uint8Array) {
      bytes = raw.byteLength;
      body = `[${bytes} octets]`;
    }
    const call: Recorded = { method, url, headers, body, bytes, form };
    this.calls.push(call);
    const route = this.routes.find((r) => r.method === method && (typeof r.pattern === 'string' ? url.includes(r.pattern) : r.pattern.test(url)));
    if (!route) return new Response(JSON.stringify({ error: { message: `route inconnue ${method} ${url}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
    const responder = route.replies[Math.min(route.hits, route.replies.length - 1)]!;
    route.hits += 1;
    const reply = typeof responder === 'function' ? responder(call, route.hits) : responder;
    const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
    const status = reply.status ?? 200;
    // Une réponse 204 ou 308 sans corps : le constructeur de Response refuse un corps vide sur 204.
    return new Response(status === 204 ? null : text, { status, headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) } });
  }) as typeof fetch;
}

/** Échanges de jetons : chaque appel rend le jeton d'accès suivant (et un nouveau jeton de rafraîchissement si demandé). */
export function tokenReplies(accessTokens: string[], options: { expiresIn?: number; rotate?: boolean; extra?: Record<string, unknown> } = {}): Responder {
  return (_call, hit) => ({
    json: {
      access_token: accessTokens[Math.min(hit - 1, accessTokens.length - 1)],
      expires_in: options.expiresIn ?? 3_600,
      token_type: 'Bearer',
      ...(options.rotate ? { refresh_token: `rt-tourne-${hit}` } : {}),
      ...(options.extra ?? {}),
    },
  });
}

/** Horloge réglable des tests (jetons échus sans attendre). */
export function clock(start = Date.parse('2026-10-03T12:00:00Z')) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}
