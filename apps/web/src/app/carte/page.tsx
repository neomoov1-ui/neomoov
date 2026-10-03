import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CardPage } from '@/components/card-entry';
import { cardPageLanguage } from '@/lib/server/card-session';

export const dynamic = 'force-dynamic';

// Lien à usage unique ouvert par l'application : jamais indexé, jamais transmis en référent.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Page de saisie de carte (étape 26) : ouverte par l'application dans le navigateur intégré avec une session signée de
 * 10 minutes à usage unique (`/carte?v=2#session=…`). Revue du 2 octobre 2026 (sécurité 16) : la session est dans le
 * fragment, que le serveur ne reçoit pas ; la page la lit dans le navigateur, l'efface de l'adresse et la fait vérifier
 * par l'API (dans un corps de requête) avant d'afficher le formulaire de Square. Sans en-tête du site, l'utilisateur
 * ne quitte pas le parcours.
 */
export default async function CardRoute({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  const requestHeaders = await headers();
  const language = cardPageLanguage(typeof lang === 'string' ? lang : null, requestHeaders.get('accept-language'));
  return (
    <main id="contenu" className="mx-auto max-w-md px-4 py-8">
      <CardPage language={language} />
    </main>
  );
}
