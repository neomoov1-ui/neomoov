/**
 * Mise en place de l'agent vocal chez Vapi (compte 12, `docs/voice-agent.md`) : crée ou met à jour les assistants
 * « Neomoov accueil », « Neomoov SOS » et « Neomoov commercial » (prompts, outils, webhook `/v1/webhooks/vapi` avec le
 * secret en en-tête),
 * rattache l'assistant d'accueil au numéro Twilio importé et inscrit l'assistant SOS dans le réglage
 * `voice.sos_assistant_id`. Rejouable. Lit `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_PHONE_NUMBER_ID`,
 * `TWILIO_FROM_NUMBER` et `APP_BASE_URL` dans l'environnement ; n'affiche jamais une valeur secrète.
 *
 *   pnpm --filter @neomoov/api vapi:setup                     # applique
 *   pnpm --filter @neomoov/api vapi:setup -- --dry-run        # montre la configuration (secret masqué), sans rien envoyer
 *   options : --model=<modèle Anthropic accepté par Vapi> --voice=<fournisseur>:<voix> --static-transfer --force-sos-setting
 *
 * Sur le serveur : docker compose -f infra/compose.prod.yml run --rm --no-deps api node dist/scripts/vapi-setup.js
 */
import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { VapiAdminClient } from '../adapters/real/vapi-admin.js';
import { AppModule } from '../app.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { SettingsService } from '../common/settings.service.js';
import { loadEnv } from '../config/env.js';
import { DB, type Database } from '../infra/db.module.js';
import { DEFAULT_MODEL, DEFAULT_VOICE, inboundAssistant, redactAssistant, salesAssistant, sosAssistant, type AssistantBuildOptions } from '../modules/voice/vapi-assistants.js';
import { syncVapi } from '../modules/voice/vapi-sync.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const dryRun = flag('dry-run');
const env = loadEnv();
if (!env.VAPI_API_KEY) {
  console.error('VAPI_API_KEY manquante (clé privée Vapi, tableau de bord, API Keys) : voir docs/voice-agent.md.');
  process.exit(2);
}
if (!env.VAPI_WEBHOOK_SECRET) {
  console.error('VAPI_WEBHOOK_SECRET manquant : sans lui, le webhook refuse tous les messages de Vapi. Le poser (infra/scripts/env-set.sh VAPI_WEBHOOK_SECRET --generate) puis relancer.');
  if (!dryRun) process.exit(2);
}

const voiceOption = option('voice');
const voice = voiceOption ? { provider: voiceOption.split(':')[0]!, voiceId: voiceOption.split(':').slice(1).join(':') } : { ...DEFAULT_VOICE };
if (!voice.provider || !voice.voiceId) {
  console.error('--voice attend <fournisseur>:<identifiant de voix>, par exemple azure:fr-CA-SylvieNeural.');
  process.exit(2);
}

const logger = createLogger('vapi-setup', 'warn');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
let exitCode = 0;
try {
  const settings = app.get(SettingsService);
  const transferNumber = await settings.string('voice.transfer_number', '+15145550100');
  if (transferNumber === '+15145550100') console.warn('Attention : voice.transfer_number est encore la valeur de départ (+1 514 555-0100) ; à remplacer dans My Hub, Paramètres.');
  const options: AssistantBuildOptions = {
    apiBaseUrl: env.APP_BASE_URL,
    webhookSecret: env.VAPI_WEBHOOK_SECRET ?? null,
    model: option('model') ?? DEFAULT_MODEL,
    voice,
    staticTransferNumber: flag('static-transfer') ? transferNumber : null,
  };
  if (dryRun) {
    console.log('Simulation : rien ne sera envoyé à Vapi. Configuration (secret masqué) :');
    console.log(JSON.stringify({ inbound: redactAssistant(inboundAssistant(options)), sos: redactAssistant(sosAssistant(options)), sales: redactAssistant(salesAssistant(options)) }, null, 2));
  } else {
    const client = new VapiAdminClient(env.VAPI_API_KEY);
    const extraNumbers = (env.TWILIO_EXTRA_NUMBERS ?? '').split(',').map((n) => n.trim()).filter(Boolean);
    const report = await syncVapi(client, { ...options, phoneNumberId: env.VAPI_PHONE_NUMBER_ID ?? null, fromNumber: env.TWILIO_FROM_NUMBER ?? null, extraNumbers });
    const action = (a: 'created' | 'updated') => (a === 'created' ? 'créé' : 'mis à jour');
    console.log(`Assistant d'accueil ${action(report.inbound.action)} : ${report.inbound.id}`);
    console.log(`Assistant SOS ${action(report.sos.action)} : ${report.sos.id}`);
    console.log(`Assistant commercial ${action(report.sales.action)} : ${report.sales.id}`);
    if (env.VAPI_SALES_ASSISTANT_ID !== report.sales.id) console.log(`À poser dans .env : VAPI_SALES_ASSISTANT_ID=${report.sales.id} (identifiant non secret), puis recréer api et worker.`);
    for (const n of report.otherNumbers) console.log(`Numéro ${n.number ?? n.id} : assistant d'accueil ${n.action === 'assigned' ? 'rattaché' : 'déjà rattaché'} (identifiant du numéro : ${n.id}).`);
    for (const n of report.missingNumbers) console.warn(`Numéro ${n} introuvable chez Vapi : l'importer depuis Twilio (Phone Numbers, Import), puis relancer.`);
    // Appels sortants commerciaux : depuis le numéro principal (TWILIO_FROM_NUMBER) quand il est importé chez Vapi.
    const principal = [report.phoneNumber, ...report.otherNumbers].find((n) => n && (n.number ?? '').replace(/[^\d+]/g, '') === (env.TWILIO_FROM_NUMBER ?? '').replace(/[^\d+]/g, ''));
    if (principal && env.VAPI_SALES_PHONE_NUMBER_ID !== principal.id) console.log(`À poser dans .env : VAPI_SALES_PHONE_NUMBER_ID=${principal.id} (numéro principal, identifiant non secret), puis recréer api et worker.`);
    else if (!principal && !env.VAPI_SALES_PHONE_NUMBER_ID) console.log('Appels sortants : sans VAPI_SALES_PHONE_NUMBER_ID, ils partent du numéro de l\'accueil (VAPI_PHONE_NUMBER_ID).');
    if (report.phoneNumber) {
      console.log(`Numéro ${report.phoneNumber.number ?? report.phoneNumber.id} : assistant d'accueil ${report.phoneNumber.action === 'assigned' ? 'rattaché' : 'déjà rattaché'} (identifiant du numéro : ${report.phoneNumber.id}).`);
      if (!env.VAPI_PHONE_NUMBER_ID) console.log(`À poser dans .env : VAPI_PHONE_NUMBER_ID=${report.phoneNumber.id} (identifiant non secret), puis recréer api et worker.`);
    } else {
      console.warn(`Aucun numéro importé ne correspond à TWILIO_FROM_NUMBER ni à VAPI_PHONE_NUMBER_ID. Numéros vus chez Vapi : ${report.candidates.map((c) => `${c.number ?? '?'} (${c.id})`).join(', ') || 'aucun'}. Importer le numéro Twilio dans Vapi (Phone Numbers, Import Twilio) puis relancer.`);
    }
    const current = await settings.string('voice.sos_assistant_id', '');
    if (!current || flag('force-sos-setting')) {
      const db = app.get<Database>(DB).db;
      await db
        .insert(schema.settings)
        .values({ key: 'voice.sos_assistant_id', scope: 'global', value: report.sos.id, description: 'Assistant Vapi qui appelle le fondateur en cas de SOS (vide : pas d\'appel)' })
        .onConflictDoUpdate({ target: [schema.settings.key, schema.settings.scope], set: { value: report.sos.id, updatedAt: sql`now()` } });
      console.log(`Réglage voice.sos_assistant_id posé : ${report.sos.id}.`);
    } else if (current !== report.sos.id) {
      console.warn(`Réglage voice.sos_assistant_id = ${current}, différent de l'assistant SOS ${report.sos.id} : relancer avec --force-sos-setting pour le remplacer.`);
    }
    const founder = await settings.string('alerts.founder_phone', '');
    if (!founder) console.warn('alerts.founder_phone est vide : aucun appel SOS ne partira tant que le numéro du fondateur n\'est pas dans My Hub, Paramètres.');
    console.log('Essai : appeler le numéro, demander un prix, réserver, puis dire « c\'est une urgence » (transfert vers voice.transfer_number). Journal des appels : My Hub, Agents, voice_call_center.');
  }
} catch (error) {
  const e = error as { code?: string; message?: string };
  console.error(`Échec${e.code ? ` (${e.code})` : ''} : ${e.message ?? String(error)}`);
  if (e.code === 'VAPI_REQUEST_FAILED') console.error('Si Vapi refuse un champ (modèle, voix, propriété inconnue), ajuster --model ou --voice, ou adapter vapi-assistants.ts au message ci-dessus.');
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
