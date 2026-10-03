/**
 * Jeton de rafraîchissement d'un réseau, obtenu une fois sur le poste du fondateur (3 octobre 2026) :
 *
 *   pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=google-business|youtube|google-calendar|linkedin|x|tiktok
 *   options : --port=53682 (adresse de retour http://127.0.0.1:<port>/rappel, à déclarer chez le réseau)
 *             --rappel=https://… (adresse https déclarée chez le réseau : l'adresse obtenue est collée dans le terminal)
 *             --dossier=<dossier des clés> (défaut : C:\Users\PC\cles-neomoov)
 *
 * Lit l'ID et le secret du client OAuth dans l'environnement du poste (variables du réseau, voir
 * docs/marketing/connecteurs.md), ouvre l'écran d'autorisation, échange le code et écrit le jeton dans
 * `<dossier>/<fournisseur>-refresh-token.txt`, sans jamais l'afficher ni toucher à un fichier `.env`. Affiche ensuite les
 * identifiants utiles (compte et établissement de la fiche, chaîne, pages LinkedIn administrées) et la commande qui pose
 * la valeur sur le serveur.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { loadDotenvFromRoot } from '../config/env.js';
import {
  authorizeUrl, createPkce, exchangeCode, keysDirectory, OAUTH_SCRIPT_PROVIDERS, parseRedirect, PROVIDER_SPECS, waitForCode, writeTokenFile,
  type OAuthScriptProvider, type ProviderSpec, type TokenSet,
} from './oauth-authorization.js';

const SERVER = 'root@78.138.58.92';
const ENV_SET = '/opt/neomoov/infra/scripts/env-set.sh';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** Navigateur par défaut du poste (l'adresse est aussi affichée, à copier si rien ne s'ouvre). */
function openBrowser(url: string): void {
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(command, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Rien à faire : l'adresse est affichée.
  }
}

/** Commande PowerShell qui pose la valeur du fichier sur le serveur, sans l'afficher. */
const setCommand = (path: string, variable: string, recreate = true) => `Get-Content -Raw "${path}" | ssh ${SERVER} ${ENV_SET} ${variable}${recreate ? ' --recreate api worker' : ''}`;

async function getJson(url: string, token: string, headers: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      console.log(`  (lecture refusée : HTTP ${response.status} sur ${new URL(url).host}${new URL(url).pathname} ; API pas encore activée ou accès pas encore accordé ?)`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.log(`  (lecture impossible : ${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

/** Identifiants utiles lus avec le jeton d'accès tout neuf (aucun n'est secret). */
async function showIdentifiers(provider: OAuthScriptProvider, tokens: TokenSet): Promise<void> {
  if (provider === 'google-business') {
    console.log('\nComptes et établissements de la fiche (GOOGLE_BUSINESS_ACCOUNT_ID, GOOGLE_BUSINESS_LOCATION_ID) :');
    const accounts = await getJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', tokens.accessToken);
    for (const account of (accounts?.['accounts'] as Array<{ name?: string; accountName?: string }> | undefined) ?? []) {
      console.log(`  compte ${account.name} (${account.accountName ?? 'sans nom'})`);
      const locations = await getJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`, tokens.accessToken);
      for (const location of (locations?.['locations'] as Array<{ name?: string; title?: string }> | undefined) ?? []) console.log(`    établissement ${location.name} : ${location.title ?? ''}`);
    }
  } else if (provider === 'youtube') {
    const channels = await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', tokens.accessToken);
    const channel = (channels?.['items'] as Array<{ id?: string; snippet?: { title?: string } }> | undefined)?.[0];
    console.log(channel ? `\nChaîne autorisée : ${channel.snippet?.title ?? ''} (${channel.id}). Vérifiez que c'est bien la chaîne Neomoov.` : '\nAucune chaîne lue : vérifiez le compte choisi à l\'écran d\'autorisation.');
  } else if (provider === 'linkedin') {
    console.log('\nPages LinkedIn que vous administrez (LINKEDIN_ORGANIZATION_ID : le nombre après urn:li:organization:) :');
    const acls = await getJson('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', tokens.accessToken, { 'LinkedIn-Version': '202606', 'X-Restli-Protocol-Version': '2.0.0' });
    for (const element of (acls?.['elements'] as Array<{ organization?: string }> | undefined) ?? []) console.log(`  ${element.organization}`);
  } else if (provider === 'x') {
    const me = await getJson('https://api.x.com/2/users/me', tokens.accessToken);
    const data = me?.['data'] as { username?: string } | undefined;
    if (data?.username) console.log(`\nCompte X autorisé : @${data.username}. Vérifiez que c'est bien le compte Neomoov.`);
  } else if (provider === 'tiktok' && tokens.scope) {
    console.log(`\nPortées accordées par TikTok : ${tokens.scope}`);
  }
}

async function authorize(provider: OAuthScriptProvider, spec: ProviderSpec, clientId: string, clientSecret: string | null): Promise<TokenSet> {
  const state = randomBytes(16).toString('hex');
  const pkce = spec.pkce ? createPkce(spec.pkce) : null;
  const pasted = option('rappel');
  if (pasted) {
    // Adresse https enregistrée chez le réseau : le navigateur y arrive avec le code, que le fondateur colle ici.
    const url = authorizeUrl(spec, { clientId, redirectUri: pasted, state, pkce });
    console.log(`\nOuverture de l'écran d'autorisation ${spec.label} (si rien ne s'ouvre, copiez cette adresse dans le navigateur) :\n${url}\n`);
    openBrowser(url);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Après l\'accord, collez ici l\'adresse complète de la page d\'arrivée, puis Entrée : ');
    rl.close();
    const parsed = parseRedirect(answer);
    if (parsed.error) throw new Error(`Autorisation refusée par le réseau (${parsed.error})`);
    if (!parsed.code || (parsed.state && parsed.state !== state)) throw new Error('Adresse collée sans code, ou d\'une autre demande : relancez la commande.');
    return exchangeCode(spec, { clientId, clientSecret, code: parsed.code, redirectUri: pasted, pkce });
  }
  const port = Number(option('port') ?? 53682);
  const { code, redirectUri } = await waitForCode(port, state, (redirect) => {
    const url = authorizeUrl(spec, { clientId, redirectUri: redirect, state, pkce });
    console.log(`\nOuverture de l'écran d'autorisation ${spec.label}. Adresse de retour à déclarer chez le réseau : ${redirect}`);
    console.log(`Si rien ne s'ouvre, copiez cette adresse dans le navigateur :\n${url}\n`);
    openBrowser(url);
  });
  return exchangeCode(spec, { clientId, clientSecret, code, redirectUri, pkce });
}

async function main(): Promise<void> {
  const provider = option('fournisseur') as OAuthScriptProvider | undefined;
  if (!provider || !OAUTH_SCRIPT_PROVIDERS.includes(provider)) {
    console.error(`Usage : pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=${OAUTH_SCRIPT_PROVIDERS.join('|')} [--port=53682] [--rappel=https://…] [--dossier=…]`);
    process.exit(2);
  }
  const spec = PROVIDER_SPECS[provider];
  loadDotenvFromRoot();
  const clientId = process.env[spec.clientIdVar]?.trim();
  const clientSecret = process.env[spec.clientSecretVar]?.trim() || null;
  if (!clientId || (!clientSecret && !spec.secretOptional)) {
    console.error(`${spec.label} : ${[!clientId ? spec.clientIdVar : null, !clientSecret && !spec.secretOptional ? spec.clientSecretVar : null].filter(Boolean).join(' et ')} absent(s) de l'environnement du poste (docs/marketing/connecteurs.md).`);
    process.exit(2);
  }
  const tokens = await authorize(provider, spec, clientId, clientSecret);
  const directory = keysDirectory(option('dossier'));
  console.log('');
  if (tokens.refreshToken) {
    const path = await writeTokenFile(directory, `${provider}-refresh-token`, tokens.refreshToken);
    console.log(`Jeton de rafraîchissement ${spec.label} écrit dans ${path} (${tokens.refreshToken.length} caractères, valeur non affichée).`);
    if (tokens.refreshExpiresIn) console.log(`Il expire le ${new Date(Date.now() + tokens.refreshExpiresIn * 1_000).toISOString().slice(0, 10)} : refaire cette commande avant (une alerte au personnel le rappellera).`);
    console.log(`\nPour le poser sur le serveur (PowerShell, valeur jamais affichée) :\n  ${setCommand(path, spec.refreshVar)}`);
    if (provider === 'x' || provider === 'tiktok') console.log(`Attention : ${spec.label} remplace ce jeton au premier usage. Posez-le à un seul endroit (le serveur), puis supprimez le fichier.`);
  } else if (provider === 'linkedin') {
    // LinkedIn ne donne un jeton de rafraîchissement qu'aux applications agréées : jeton d'accès de 60 jours.
    const path = await writeTokenFile(directory, 'linkedin-access-token', tokens.accessToken);
    const expires = new Date(Date.now() + (tokens.expiresIn ?? 5_184_000) * 1_000).toISOString().slice(0, 10);
    console.log(`LinkedIn n'a pas donné de jeton de rafraîchissement : jeton d'accès écrit dans ${path} (valeur non affichée), valable jusqu'au ${expires}.`);
    console.log(`\nPour le poser sur le serveur (PowerShell) :\n  ${setCommand(path, 'LINKEDIN_ACCESS_TOKEN', false)}`);
    console.log(`  ssh -t ${SERVER} ${ENV_SET} LINKEDIN_ACCESS_TOKEN_EXPIRES_AT --recreate api worker   (saisir ${expires})`);
  } else {
    console.error(`${spec.label} n'a pas rendu de jeton de rafraîchissement : vérifiez les portées et, chez Google, l'accès hors ligne ; relancez la commande.`);
    process.exitCode = 1;
  }
  await showIdentifiers(provider, tokens);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
