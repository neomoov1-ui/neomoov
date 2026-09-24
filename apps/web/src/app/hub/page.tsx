import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { HubContent } from '@/components/hub-content';

/** Garde minimale (étape 1) : un témoin `hub_session` non vide ouvre la page ; remplacée par l'authentification réelle à l'étape 3. */
export default async function HubPage() {
  const store = await cookies();
  if (!store.get('hub_session')?.value) redirect('/hub/connexion');
  return <HubContent />;
}
