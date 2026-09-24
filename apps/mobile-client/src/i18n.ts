import { createMobileI18n } from '@neomoov/mobile-core/i18n';

/** Textes de l'application client (espace de noms `app`). Jamais de chaîne codée en dur dans les écrans. */
export const appResources = {
  'fr-CA': {
    app: {
      welcome: 'Bienvenue',
      start: 'Réserver ma course',
      login: 'Se connecter',
      intro: 'Prix fixe tout compris affiché avant de confirmer, véhicules électriques de luxe, chauffeurs professionnels vérifiés.',
      stepOne: "Étape 1 du cahier des charges : écran de démarrage. La connexion et la réservation arrivent aux étapes 3 et 10.",
    },
  },
  en: {
    app: {
      welcome: 'Welcome',
      start: 'Book my ride',
      login: 'Sign in',
      intro: 'All-inclusive fixed price shown before you confirm, luxury electric vehicles, vetted professional drivers.',
      stepOne: 'Specification step 1: start screen. Sign-in and booking arrive at steps 3 and 10.',
    },
  },
};

export const i18n = createMobileI18n(appResources);
