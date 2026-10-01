import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CardEntry } from '@/components/card-entry';
import { cardPageLanguage, loadCardSession } from '@/lib/server/card-session';
import { API_URL } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

// Lien à usage unique ouvert par l'application : jamais indexé, jamais transmis en référent (la session est dans l'adresse).
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Page de saisie de carte (étape 26) : ouverte par l'application dans le navigateur intégré avec une session signée de
 * 15 minutes (`/carte?session=…`). La session est vérifiée par l'API avant d'afficher le formulaire de Square ; sans
 * en-tête du site, l'utilisateur ne quitte pas le parcours.
 */
export default async function CardPage({ searchParams }: { searchParams: Promise<{ session?: string | string[]; lang?: string | string[] }> }) {
  const { session, lang } = await searchParams;
  const requestHeaders = await headers();
  const language = cardPageLanguage(typeof lang === 'string' ? lang : null, requestHeaders.get('accept-language'));
  const token = typeof session === 'string' ? session : null;
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const state = await loadCardSession(token, { apiUrl: API_URL, headers: { 'accept-language': language, ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) } });
  return (
    <main id="contenu" className="mx-auto max-w-md px-4 py-8">
      <CardEntry language={language} state={state} session={state.state === 'ok' ? token : null} />
    </main>
  );
}
