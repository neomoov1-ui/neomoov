'use client';

/**
 * Sans session lisible, la garde de My Hub passe par ici au lieu d'une redirection du serveur (revue du 2 octobre 2026,
 * constat web 18) :
 * - le lien profond est gardé : la connexion reçoit `next` (le serveur ne connaît pas le chemin dans une mise en page) ;
 * - arrivée depuis un autre site (lien d'un courriel, d'une messagerie) : les témoins `SameSite=Strict` n'ont pas été
 *   envoyés avec cette navigation. Un seul nouvel essai lancé par la page elle-même (même site) les envoie ; si la
 *   session existe, la page s'affiche, sinon la connexion. Le compteur vit dans `sessionStorage` (par onglet).
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { hubReturnPath } from '@/lib/hub-user-cookie';

const RETRY_KEY = 'nm_hub_same_site_retry';
/** Un essai compte pour le même chemin pendant 15 secondes : une session expirée plus tard réessaie à son tour. */
const RETRY_WINDOW_MS = 15_000;

export function LoginRedirect() {
  const { t } = useTranslation();
  useEffect(() => {
    const here = window.location.pathname;
    const login = `/hub/connexion?next=${encodeURIComponent(hubReturnPath(here))}`;
    let retried = true;
    try {
      const [path, at] = (window.sessionStorage.getItem(RETRY_KEY) ?? '').split('|');
      retried = path === here && Date.now() - Number(at) < RETRY_WINDOW_MS;
      if (retried) window.sessionStorage.removeItem(RETRY_KEY);
      else window.sessionStorage.setItem(RETRY_KEY, `${here}|${Date.now()}`);
    } catch {
      // Stockage indisponible (navigation privée stricte) : pas de nouvel essai, directement la connexion.
    }
    window.location.replace(retried ? login : window.location.href);
  }, []);
  return (
    <p role="status" className="p-6 text-sm">
      <a href="/hub/connexion" className="underline">{t('hub.common.loading')}</a>
    </p>
  );
}
