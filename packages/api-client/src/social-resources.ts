/**
 * Réseaux sociaux de My Hub (3 octobre 2026) : les dix comptes de Neomoov (état, connexion, revalidation, déconnexion,
 * mode, lien public, approbation de l'application), écran d'autorisation OAuth, formulaire Telegram, choix de la page ;
 * liens publics de la page Contact (sans clé).
 */
import type { SocialAccountUpdateInput, SocialAccountView, SocialConnectStart, SocialLinksView, SocialSpace, SocialTelegramConnectInput } from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

export function socialResource(t: Transport) {
  return {
    accounts: () => t.get<SocialAccountView[]>('/admin/social'),
    /** Adresse de l'écran d'autorisation du réseau, à ouvrir dans le navigateur (retour sur My Hub, Réseaux sociaux). */
    connect: (space: SocialSpace) => t.get<SocialConnectStart>(`/admin/social/${id(space)}/connect`),
    connectTelegram: (body: SocialTelegramConnectInput) => t.post<SocialAccountView>('/admin/social/telegram/connect', body, { timeoutMs: 30_000 }),
    setLink: (space: SocialSpace, profileUrl: string) => t.post<SocialAccountView>(`/admin/social/${id(space)}/link`, { profileUrl }),
    select: (space: SocialSpace, accountId: string) => t.post<SocialAccountView>(`/admin/social/${id(space)}/select`, { accountId }),
    validate: (space: SocialSpace) => t.post<SocialAccountView>(`/admin/social/${id(space)}/validate`, {}, { timeoutMs: 30_000 }),
    update: (space: SocialSpace, body: SocialAccountUpdateInput) => t.patch<SocialAccountView>(`/admin/social/${id(space)}`, body),
    disconnect: (space: SocialSpace) => t.delete<SocialAccountView>(`/admin/social/${id(space)}`),
    /** Liens de la page Contact : comptes reliés, validés et marqués « afficher sur le site ». */
    publicLinks: () => t.get<SocialLinksView>('/public/social-links'),
  };
}
