import { cookies } from 'next/headers';
import { isLanguage, type Language } from './i18n-resources';

/** Langue de la requête courante (témoin `lang` posé par le sélecteur de langue), `fr-CA` par défaut. Côté serveur seulement. */
export async function currentLanguage(): Promise<Language> {
  const store = await cookies();
  const value = store.get('lang')?.value;
  return isLanguage(value) ? value : 'fr-CA';
}
