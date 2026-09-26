import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { HubShell } from '@/components/hub/shell';
import { currentLanguage } from '@/lib/language.server';
import { USER_COOKIE, type HubUser } from '@/lib/server/gateway';

export const metadata: Metadata = { title: 'My Hub Neomoov', robots: { index: false, follow: false } };

/**
 * Garde de My Hub : sans session du personnel (témoin de profil posé par la passerelle), retour à la connexion. Le
 * témoin de profil n'ouvre que l'interface ; chaque donnée reste autorisée par l'API avec le jeton (rôles vérifiés côté
 * serveur), et une session révoquée renvoie à la connexion au premier appel. Le témoin de renouvellement, limité au
 * chemin `/api`, n'est pas visible ici.
 */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const raw = store.get(USER_COOKIE)?.value;
  if (!raw) redirect('/hub/connexion');
  let user: HubUser;
  try {
    user = JSON.parse(raw) as HubUser;
  } catch {
    redirect('/hub/connexion');
  }
  const language = await currentLanguage();
  return <HubShell user={user} language={language}>{children}</HubShell>;
}
