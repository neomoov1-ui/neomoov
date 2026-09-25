/**
 * Crée un membre du personnel de My Hub, ou met à jour celui qui porte déjà ce courriel ou ce téléphone (nom, rôles
 * ajoutés, mot de passe remplacé : c'est la voie de secours pour le seul administrateur), sans passer par l'API :
 *
 *   STAFF_PASSWORD='…' pnpm --filter @neomoov/api create-staff --email admin@neomoov.net --phone +15145550100 --first Christopher --last N. --roles admin
 *
 * Le mot de passe vient de la variable STAFF_PASSWORD (jamais d'un argument, visible dans l'historique du shell). Le
 * second facteur est inscrit à la première connexion sur My Hub.
 */
import 'reflect-metadata';
import { staffCreateSchema } from '@neomoov/domain';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { loadEnv } from '../config/env.js';
import { StaffAuthService } from '../modules/auth/staff-auth.service.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const password = process.env['STAFF_PASSWORD'];
if (!password) {
  console.error('STAFF_PASSWORD manquant dans l\'environnement.');
  process.exit(2);
}
const parsed = staffCreateSchema.safeParse({
  email: arg('email'),
  phone: arg('phone'),
  firstName: arg('first'),
  lastName: arg('last'),
  roles: (arg('roles') ?? 'admin').split(',').map((r) => r.trim()),
  language: arg('language') ?? 'fr',
  password,
});
if (!parsed.success) {
  console.error('Arguments invalides :', parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; '));
  process.exit(2);
}

const env = loadEnv();
const logger = createLogger('create-staff', 'warn');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
let exitCode = 0;
try {
  const user = await app.get(StaffAuthService).createStaff(parsed.data);
  console.log(`Membre du personnel prêt : ${user.email} (${parsed.data.roles.join(', ')}), identifiant ${user.id}. Second facteur à inscrire à la première connexion.`);
} catch (error) {
  const e = error as { code?: string; message?: string };
  console.error(`Échec${e.code ? ` (${e.code})` : ''} : ${e.message ?? String(error)}`);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
