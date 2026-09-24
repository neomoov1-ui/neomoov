/**
 * Instance i18next du navigateur (react-i18next). Réservé aux composants client : react-i18next crée un contexte React
 * à l'import, ce que la couche serveur de Next.js n'a pas. Les textes et les langues sont dans `i18n-resources.ts`.
 */
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, resources, type Language } from './i18n-resources';

export { SUPPORTED_LANGUAGES, isLanguage, resources, type Language } from './i18n-resources';

export function createI18n(language: Language = 'fr-CA'): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({ resources, lng: language, fallbackLng: 'fr-CA', supportedLngs: [...SUPPORTED_LANGUAGES], interpolation: { escapeValue: false }, initAsync: false });
  return instance;
}
