/**
 * Mise en place du modèle de données HubSpot (étape 25, étude 06) : groupe « Neomoov », propriétés personnalisées des
 * contacts, des entreprises et des transactions, pipelines « Ventes B2B » et « Formation chauffeurs » avec leurs
 * étapes. Rejouable : ce qui existe est laissé ou complété, jamais détruit. Le jeton (`HUBSPOT_ACCESS_TOKEN`, lu dans
 * `.env`) n'est jamais affiché.
 *
 *   pnpm --filter @neomoov/api crm:setup               # applique
 *   pnpm --filter @neomoov/api crm:setup -- --dry-run  # annonce ce qui serait fait, sans rien écrire
 */
import { HubSpotCrmProvider, type HubSpotSetupReport } from '../adapters/real/hubspot.real.js';
import { loadEnv } from '../config/env.js';

const dryRun = process.argv.includes('--dry-run');
const env = loadEnv();
if (!env.HUBSPOT_ACCESS_TOKEN) {
  console.error('HUBSPOT_ACCESS_TOKEN manquant dans le fichier .env (jeton de l\'application privée HubSpot) : voir docs/crm.md, étape 3.');
  process.exit(2);
}

const ACTIONS: Record<HubSpotSetupReport['action'], string> = { created: 'créé', updated: 'mis à jour', unchanged: 'déjà en place', skipped: 'ignoré', planned: 'à faire' };
const KINDS: Record<HubSpotSetupReport['kind'], string> = { group: 'groupe', property: 'propriété', pipeline: 'pipeline', stage: 'étape' };

const provider = new HubSpotCrmProvider(env.HUBSPOT_ACCESS_TOKEN, { portalId: env.HUBSPOT_PORTAL_ID ?? null });
let exitCode = 0;
try {
  console.log(dryRun ? 'Simulation : rien ne sera écrit chez HubSpot.' : 'Mise en place du modèle Neomoov chez HubSpot…');
  const report = await provider.setup({ dryRun });
  for (const line of report) console.log(`[${ACTIONS[line.action]}] ${KINDS[line.kind]} ${line.objectType}.${line.name}${line.detail ? ` (${line.detail})` : ''}`);
  const count = (action: HubSpotSetupReport['action']) => report.filter((l) => l.action === action).length;
  console.log(`\n${dryRun ? 'Simulation' : 'Mise en place'} terminée : ${count('created')} créé(s), ${count('updated')} mis à jour, ${count('unchanged')} déjà en place, ${count('skipped')} ignoré(s)${dryRun ? `, ${count('planned')} à faire` : ''}.`);
  if (env.HUBSPOT_PORTAL_ID) {
    const id = encodeURIComponent(env.HUBSPOT_PORTAL_ID);
    console.log(`Vérifier dans HubSpot : contacts https://app.hubspot.com/contacts/${id}/objects/0-1/views/all/list ; transactions https://app.hubspot.com/contacts/${id}/objects/0-3/views/all/list ; propriétés https://app.hubspot.com/property-settings/${id}/properties`);
  } else {
    console.log('Vérifier dans HubSpot : Paramètres, Propriétés (groupe « Neomoov ») et Objets, Transactions, Pipelines.');
  }
} catch (error) {
  const e = error as { code?: string; message?: string; details?: { status?: number } };
  console.error(`Échec${e.code ? ` (${e.code})` : ''} : ${e.message ?? String(error)}`);
  if (e.details?.status === 401 || e.details?.status === 403) console.error('Jeton refusé ou portées insuffisantes : vérifier HUBSPOT_ACCESS_TOKEN et les portées de l\'application privée (docs/crm.md, étape 3).');
  exitCode = 1;
}
process.exit(exitCode);
