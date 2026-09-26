import type { Metadata } from 'next';
import { Rights } from '@/components/rights';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

/**
 * Suppression du compte sans l'application (adresse déclarée à Google Play et dans les fiches des magasins) : démarche,
 * données supprimées et gardées, puis vérification du numéro et confirmation. Même composant que `/droits`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.rights.deletion.title} · Neomoov`, description: texts.rights.deletion.subtitle };
}

export default function DeleteAccountPage() {
  return <Rights mode="deletion" />;
}
