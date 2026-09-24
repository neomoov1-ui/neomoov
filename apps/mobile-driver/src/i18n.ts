import { createMobileI18n } from '@neomoov/mobile-core/i18n';

/** Textes de l'application chauffeur (espace de noms `app`). Jamais de chaîne codée en dur dans les écrans. */
export const appResources = {
  'fr-CA': {
    app: {
      welcome: 'Bienvenue, chauffeur',
      start: 'Devenir chauffeur Neomoov',
      login: 'Se connecter',
      intro: 'Zéro commission : vos packs de courses prépayés, vos clients vous appartiennent, règlement chaque semaine.',
      stepOne: "Étape 1 du cahier des charges : écran de démarrage. La connexion et l'admission arrivent aux étapes 3 et 11.",
    },
  },
  en: {
    app: {
      welcome: 'Welcome, driver',
      start: 'Become a Neomoov driver',
      login: 'Sign in',
      intro: 'Zero commission: prepaid ride packs, your customers stay yours, weekly settlement.',
      stepOne: 'Specification step 1: start screen. Sign-in and onboarding arrive at steps 3 and 11.',
    },
  },
};

export const i18n = createMobileI18n(appResources);
