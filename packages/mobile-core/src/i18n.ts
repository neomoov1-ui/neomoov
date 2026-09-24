import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['fr-CA', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Textes communs aux deux applications ; chaque application ajoute ses propres espaces de noms. */
export const coreResources = {
  'fr-CA': {
    core: {
      appName: 'Neomoov',
      slogan: 'Avancez vers demain.',
      tagline: 'Une application conçue par le client pour les chauffeurs.',
      continue: 'Continuer',
      back: 'Retour',
      cancel: 'Annuler',
      confirm: 'Confirmer',
      close: 'Fermer',
      loading: 'Chargement…',
      error: 'Une erreur est survenue. Réessayez.',
      language: 'Langue',
      leadTime: 'Réservez au moins 2 heures à l\'avance.',
    },
  },
  en: {
    core: {
      appName: 'Neomoov',
      slogan: 'Move toward tomorrow.',
      tagline: 'An app designed by the customer, for drivers.',
      continue: 'Continue',
      back: 'Back',
      cancel: 'Cancel',
      confirm: 'Confirm',
      close: 'Close',
      loading: 'Loading…',
      error: 'Something went wrong. Please try again.',
      language: 'Language',
      leadTime: 'Book at least 2 hours ahead.',
    },
  },
} as const;

type Resources = Record<Language, Record<string, Record<string, string>>>;

/** Crée une instance i18n avec les textes communs et ceux de l'application (fusionnés par langue). */
export function createMobileI18n(appResources: Resources, language: Language = 'fr-CA'): i18n {
  const instance = i18next.createInstance();
  const resources = Object.fromEntries(SUPPORTED_LANGUAGES.map((lng) => [lng, { ...coreResources[lng], ...appResources[lng] }]));
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'fr-CA',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'app',
    ns: ['core', 'app'],
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

export function isLanguage(value: string | undefined | null): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
