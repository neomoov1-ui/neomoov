import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { HubShell } from '@/components/hub/shell';
import { LoginRedirect } from '@/components/hub/login-redirect';
import { parseHubUserCookie } from '@/lib/hub-user-cookie';
import { currentLanguage } from '@/lib/language.server';
import { USER_COOKIE } from '@/lib/server/gateway';

export const metadata: Metadata = { title: 'My Hub Neomoov', robots: { index: false, follow: false } };

/**
 * Garde de My Hub : sans session du personnel (témoin de profil posé par la passerelle), retour à la connexion. Le
 * témoin de profil n'ouvre que l'interface ; chaque donnée reste autorisée par l'API avec le jeton (rôles vérifiés côté
 * serveur), et une session révoquée renvoie à la connexion au premier appel. Le témoin de renouvellement, limité au
 * chemin `/api`, n'est pas visible ici. Étape 21 : la session peut aussi être celle d'un membre d'organisation (code
 * SMS) ; le cadre le conduit alors vers l'espace de son organisation. Revue du 2 octobre 2026 (constat web 18) : un
 * témoin mal formé vaut une absence de session, et la connexion se fait par `LoginRedirect`, qui garde le lien profond
 * et réessaie une fois depuis le site lui-même (témoins `SameSite=Strict` absents d'un lien venu d'ailleurs).
 */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const user = parseHubUserCookie(store.get(USER_COOKIE)?.value);
  if (!user) return <LoginRedirect />;
  const language = await currentLanguage();
  return <HubShell user={user} language={language}>{children}</HubShell>;
}
