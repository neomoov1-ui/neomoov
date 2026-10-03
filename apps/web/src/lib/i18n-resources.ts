/**
 * Langues et textes d'interface du web, sans dépendance à React : ce module peut être importé par les composants
 * serveur (mise en page, pages). L'instance i18next côté client est créée dans `i18n.ts`.
 * Jamais de chaîne codée en dur dans les composants. My Hub et les pages publiques ont leurs fichiers de textes.
 */
import { enumTexts, hubTexts } from './i18n-hub';
import { orgTexts } from './i18n-org';
import { fleetTexts } from './i18n-fleet';
import { siteTexts } from './i18n-site';

export const SUPPORTED_LANGUAGES = ['fr-CA', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const resources = {
  'fr-CA': {
    translation: {
      app: { name: 'Neomoov', slogan: 'Avancez vers demain.', tagline: 'Une application conçue par le client pour les chauffeurs.' },
      nav: { home: 'Accueil', hub: 'My Hub', book: 'Réserver', drivers: 'Devenir chauffeur', rights: 'Vos droits', language: 'Langue' },
      home: {
        title: 'Transport de personnes à Montréal, prix fixe garanti',
        subtitle: 'Réservez au moins 2 heures à l\'avance. Véhicules électriques de luxe, chauffeurs professionnels vérifiés, prix tout compris affiché avant de confirmer.',
        cta: 'Réserver une course',
        hub: 'Accéder à My Hub',
        status: 'État de la plateforme',
      },
      hub: hubTexts['fr-CA'],
      org: orgTexts['fr-CA'],
      fleet: fleetTexts['fr-CA'],
      enum: enumTexts['fr-CA'],
      ...siteTexts['fr-CA'],
      status: { api: 'API', database: 'base de données', redis: 'Redis', queues: 'files', ok: 'en service', degraded: 'dégradée', error: 'en panne', not_configured: 'non configuré', memory: 'en mémoire' },
      meta: { description: 'Transport de personnes à Montréal, prix fixe garanti, véhicules électriques, chauffeurs vérifiés.' },
      common: { loading: 'Chargement…', error: 'Une erreur est survenue.' },
      // Défi anti-robots demandé par l'API après plusieurs échecs (revue Q1 du 3 octobre 2026).
      antiBot: { required: 'Pour continuer, confirmez que vous n\'êtes pas un robot, puis réessayez.', failed: 'La vérification anti-robots a échoué : recommencez le défi, puis réessayez.', unavailable: 'Trop d\'essais depuis cette connexion : réessayez dans une heure.' },
    },
  },
  en: {
    translation: {
      app: { name: 'Neomoov', slogan: 'Move toward tomorrow.', tagline: 'An app designed by the customer, for drivers.' },
      nav: { home: 'Home', hub: 'My Hub', book: 'Book', drivers: 'Drive with us', rights: 'Your rights', language: 'Language' },
      home: {
        title: 'Rides in Montreal with a guaranteed fixed price',
        subtitle: 'Book at least 2 hours ahead. Luxury electric vehicles, vetted professional drivers, all-inclusive price shown before you confirm.',
        cta: 'Book a ride',
        hub: 'Open My Hub',
        status: 'Platform status',
      },
      hub: hubTexts.en,
      org: orgTexts.en,
      fleet: fleetTexts.en,
      enum: enumTexts.en,
      ...siteTexts.en,
      status: { api: 'API', database: 'database', redis: 'Redis', queues: 'queues', ok: 'up', degraded: 'degraded', error: 'down', not_configured: 'not configured', memory: 'in memory' },
      meta: { description: 'Rides in Montreal with a guaranteed fixed price, electric vehicles and vetted drivers.' },
      common: { loading: 'Loading…', error: 'Something went wrong.' },
      antiBot: { required: 'To continue, confirm you are not a robot, then try again.', failed: 'The anti-bot check failed: complete the challenge again, then try again.', unavailable: 'Too many attempts from this connection: please try again in an hour.' },
    },
  },
} as const;

export function isLanguage(value: string | undefined): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
