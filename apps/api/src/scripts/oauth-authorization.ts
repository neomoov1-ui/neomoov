/**
 * Autorisation OAuth 2.0 faite une fois sur le poste du fondateur (3 octobre 2026), pour obtenir le jeton de
 * rafraîchissement d'un réseau : écran d'autorisation ouvert dans le navigateur, code reçu sur
 * `http://127.0.0.1:<port>/rappel` (ou collé dans le terminal quand le réseau exige une adresse https enregistrée),
 * échange du code (avec PKCE), jeton écrit dans un fichier du dossier des clés (`C:\Users\PC\cles-neomoov`), jamais
 * affiché ni écrit dans un `.env` (règle des agents : aucun outil ne lit ni ne modifie un `.env`). Le fondateur pose
 * ensuite la valeur sur le serveur par `env-set.sh`, depuis le fichier, sans la voir.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OAUTH_SCRIPT_PROVIDERS = ['google-business', 'youtube', 'google-calendar', 'linkedin', 'x', 'tiktok'] as const;
export type OAuthScriptProvider = (typeof OAUTH_SCRIPT_PROVIDERS)[number];

export interface ProviderSpec {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Séparateur des portées dans l'adresse (espace, ou virgule chez TikTok). */
  scopeSeparator: string;
  /** Variables d'environnement du client OAuth (lues dans l'environnement du poste). */
  clientIdVar: string;
  clientSecretVar: string;
  /** Le secret est facultatif (client public de X). */
  secretOptional?: boolean;
  /** Variable de serveur qui recevra le jeton de rafraîchissement. */
  refreshVar: string;
  /** Nom du paramètre de l'identifiant du client (`client_key` chez TikTok). */
  clientParam: string;
  /** PKCE : défi en base64url (norme) ou en hexadécimal (TikTok, application de bureau) ; aucun chez LinkedIn. */
  pkce: 'base64url' | 'hex' | null;
  /** Identifiants du client à l'échange : dans le corps, ou en Basic (X, client confidentiel). */
  tokenAuth: 'body' | 'basic';
  extraParams?: Record<string, string>;
}

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const google = (label: string, scopes: string[], prefix: string): ProviderSpec => ({
  label, authorizeUrl: GOOGLE_AUTHORIZE, tokenUrl: GOOGLE_TOKEN, scopes, scopeSeparator: ' ', clientIdVar: `${prefix}_CLIENT_ID`, clientSecretVar: `${prefix}_CLIENT_SECRET`, refreshVar: `${prefix}_REFRESH_TOKEN`,
  clientParam: 'client_id', pkce: 'base64url', tokenAuth: 'body',
  // Jeton de rafraîchissement : accès hors ligne et nouvel accord demandé à chaque fois (sinon Google n'en rend pas).
  extraParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
});

export const PROVIDER_SPECS: Readonly<Record<OAuthScriptProvider, ProviderSpec>> = {
  'google-business': google('Fiche Google', ['https://www.googleapis.com/auth/business.manage'], 'GOOGLE_BUSINESS'),
  youtube: google('YouTube', ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'], 'YOUTUBE'),
  'google-calendar': google('Google Agenda', ['https://www.googleapis.com/auth/calendar.events'], 'GOOGLE_CALENDAR'),
  linkedin: {
    label: 'LinkedIn', authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['w_organization_social', 'r_organization_social', 'rw_organization_admin'], scopeSeparator: ' ', clientIdVar: 'LINKEDIN_CLIENT_ID', clientSecretVar: 'LINKEDIN_CLIENT_SECRET',
    refreshVar: 'LINKEDIN_REFRESH_TOKEN', clientParam: 'client_id', pkce: null, tokenAuth: 'body',
  },
  x: {
    label: 'X', authorizeUrl: 'https://x.com/i/oauth2/authorize', tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'], scopeSeparator: ' ', clientIdVar: 'X_CLIENT_ID', clientSecretVar: 'X_CLIENT_SECRET', secretOptional: true,
    refreshVar: 'X_REFRESH_TOKEN', clientParam: 'client_id', pkce: 'base64url', tokenAuth: 'basic',
  },
  tiktok: {
    label: 'TikTok', authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/', tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.upload', 'video.list'], scopeSeparator: ',', clientIdVar: 'TIKTOK_CLIENT_KEY', clientSecretVar: 'TIKTOK_CLIENT_SECRET',
    refreshVar: 'TIKTOK_REFRESH_TOKEN', clientParam: 'client_key', pkce: 'hex', tokenAuth: 'body',
  },
};

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Vérificateur PKCE (43 à 128 caractères) et défi SHA-256 (base64url, ou hexadécimal pour TikTok). */
export function createPkce(encoding: 'base64url' | 'hex', verifier = randomBytes(48).toString('base64url')): Pkce {
  const digest = createHash('sha256').update(verifier).digest();
  return { verifier, challenge: encoding === 'hex' ? digest.toString('hex') : digest.toString('base64url') };
}

/** Adresse de l'écran d'autorisation. */
export function authorizeUrl(spec: ProviderSpec, input: { clientId: string; redirectUri: string; state: string; pkce: Pkce | null }): string {
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set(spec.clientParam, input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', spec.scopes.join(spec.scopeSeparator));
  url.searchParams.set('state', input.state);
  if (input.pkce) {
    url.searchParams.set('code_challenge', input.pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(spec.extraParams ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  scope: string | null;
}

/** Échange du code contre les jetons ; erreur sans aucun secret dans le message. */
export async function exchangeCode(spec: ProviderSpec, input: { clientId: string; clientSecret: string | null; code: string; redirectUri: string; pkce: Pkce | null }, fetchImpl: typeof fetch = fetch): Promise<TokenSet> {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  form.set(spec.clientParam, input.clientId);
  if (spec.tokenAuth === 'basic' && input.clientSecret) headers['authorization'] = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`;
  else if (input.clientSecret) form.set('client_secret', input.clientSecret);
  if (input.pkce) form.set('code_verifier', input.pkce.verifier);
  const response = await fetchImpl(spec.tokenUrl, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(30_000) });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof body['access_token'] === 'string' ? body['access_token'] : null;
  if (!response.ok || !accessToken) {
    const error = typeof body['error'] === 'string' ? body['error'] : `HTTP ${response.status}`;
    const description = typeof body['error_description'] === 'string' ? ` : ${body['error_description'].slice(0, 160)}` : '';
    throw new Error(`${spec.label} : échange du code refusé (${error}${description})`);
  }
  const n = (key: string) => (typeof body[key] === 'number' ? (body[key] as number) : typeof body[key] === 'string' && body[key] ? Number(body[key]) : null);
  return {
    accessToken, refreshToken: typeof body['refresh_token'] === 'string' && body['refresh_token'] ? body['refresh_token'] : null,
    expiresIn: n('expires_in'), refreshExpiresIn: n('refresh_token_expires_in') ?? n('refresh_expires_in'), scope: typeof body['scope'] === 'string' ? body['scope'] : null,
  };
}

/** Dossier des clés du poste : `--dossier`, sinon `NEOMOOV_CLES_DIR`, sinon `C:\Users\PC\cles-neomoov` (ou `~/cles-neomoov`). */
export function keysDirectory(option?: string): string {
  if (option) return option;
  if (process.env['NEOMOOV_CLES_DIR']) return process.env['NEOMOOV_CLES_DIR'];
  return process.platform === 'win32' ? 'C:\\Users\\PC\\cles-neomoov' : join(homedir(), 'cles-neomoov');
}

/** Écrit un jeton seul (sans retour à la ligne) dans `<dossier>/<nom>.txt`, droits restreints ; rend le chemin, jamais la valeur. */
export async function writeTokenFile(directory: string, name: string, value: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${name}.txt`);
  await writeFile(path, value, { encoding: 'utf8', mode: 0o600 });
  return path;
}

/** Code et état lus dans une adresse de retour collée par le fondateur (adresse https enregistrée chez le réseau). */
export function parseRedirect(pasted: string): { code: string | null; state: string | null; error: string | null } {
  const trimmed = pasted.trim();
  try {
    const url = new URL(trimmed);
    return { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error_description') ?? url.searchParams.get('error') };
  } catch {
    // Le code seul a été collé.
    return { code: trimmed || null, state: null, error: null };
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;margin:3rem;max-width:40rem"><h1>${title}</h1><p>${text}</p></body></html>`;

/**
 * Attend le retour de l'écran d'autorisation sur `http://127.0.0.1:<port>/rappel` : rend le code si l'état concorde.
 * `onListening` reçoit l'adresse de retour une fois le serveur prêt (ouverture du navigateur).
 */
export function waitForCode(port: number, state: string, onListening: (redirectUri: string) => void | Promise<void>, timeoutMs = 300_000): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    const finish = (error: Error | null, result?: { code: string; redirectUri: string }) => {
      clearTimeout(timer);
      server?.close();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Aucune réponse de l\'écran d\'autorisation après 5 minutes : relancez la commande.')), timeoutMs);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/rappel') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Adresse inconnue');
        return;
      }
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code || url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Autorisation refusée', 'Revenez au terminal pour le détail, puis relancez la commande.'));
        finish(new Error(error ? `Autorisation refusée par le réseau (${error.slice(0, 160)})` : 'Réponse sans code ou avec un état différent : relancez la commande.'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Autorisation reçue', 'Vous pouvez fermer cet onglet et revenir au terminal.'));
      finish(null, { code, redirectUri: `http://127.0.0.1:${port}/rappel` });
    });
    server.on('error', (error) => finish(error));
    server.listen(port, '127.0.0.1', () => {
      void Promise.resolve(onListening(`http://127.0.0.1:${port}/rappel`)).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    });
  });
}
