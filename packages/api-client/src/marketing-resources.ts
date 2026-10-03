/**
 * Marketing automatisé de My Hub (phase 1 « entreprise autonome ») : espaces et connecteurs, calendrier de contenu
 * (lecture, modification, approbation, refus, publication, média), tâches de référencement, lancement des agents ;
 * publication multiréseau (composer, lot importé, programmation en lot, « À relayer », commentaires par réseau).
 */
import type {
  ContentItemView, ContentListQuery, ContentPlanRequest, ContentUpdateInput, ConversationView, MarketingPlanResult, MarketingSpaceView, PublicationAdaptResult, PublicationComposeInput, PublicationGroupView,
  PublicationImportResult, PublicationItemView, PublicationListQuery, PublicationScheduleInput, PublicationScheduleResult, PublicationsImport, RelayDoneInput, RelayListView, SeoPlanResult, SeoTaskView, SocialInboxSummaryView,
} from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

export function marketingResource(t: Transport) {
  return {
    spaces: () => t.get<MarketingSpaceView[]>('/admin/marketing/spaces'),
    content: (query: Partial<ContentListQuery> = {}) => t.get<ContentItemView[]>('/admin/marketing/content', { query }),
    item: (itemId: string) => t.get<ContentItemView>(`/admin/marketing/content/${id(itemId)}`),
    /** Chemin du média (PNG, MP4 ou gabarit HTML) : à charger avec le jeton, jamais par un lien public. */
    mediaPath: (itemId: string) => `/admin/marketing/content/${id(itemId)}/media`,
    updateItem: (itemId: string, body: ContentUpdateInput) => t.patch<ContentItemView>(`/admin/marketing/content/${id(itemId)}`, body),
    approveItem: (itemId: string) => t.post<ContentItemView>(`/admin/marketing/content/${id(itemId)}/approve`, {}),
    rejectItem: (itemId: string, reason: string) => t.post<ContentItemView>(`/admin/marketing/content/${id(itemId)}/reject`, { reason }),
    publishItem: (itemId: string) => t.post<ContentItemView>(`/admin/marketing/content/${id(itemId)}/publish`, {}),
    planContent: (body: ContentPlanRequest = {}) => t.post<MarketingPlanResult>('/admin/marketing/content/plan', body, { timeoutMs: 120_000 }),
    seoTasks: (query: { status?: string; limit?: number } = {}) => t.get<SeoTaskView[]>('/admin/marketing/seo/tasks', { query }),
    planSeo: (body: { weekStart?: string; force?: boolean } = {}) => t.post<SeoPlanResult>('/admin/marketing/seo/plan', body, { timeoutMs: 120_000 }),
    approveSeoTask: (taskId: string) => t.post<SeoTaskView>(`/admin/marketing/seo/tasks/${id(taskId)}/approve`, {}),
    rejectSeoTask: (taskId: string, reason: string) => t.post<SeoTaskView>(`/admin/marketing/seo/tasks/${id(taskId)}/reject`, { reason }),
    // Publication multiréseau (3 octobre 2026).
    publications: (query: Partial<PublicationListQuery> = {}) => t.get<PublicationGroupView[]>('/admin/marketing/publications', { query }),
    publication: (groupId: string) => t.get<PublicationGroupView>(`/admin/marketing/publications/${id(groupId)}`),
    compose: (body: PublicationComposeInput) => t.post<PublicationGroupView>('/admin/marketing/publications', body, { timeoutMs: 60_000 }),
    /** Lot au format docs/marketing/lancement-50-publications.schema.json (100 Ko au plus par appel : envoyer un gros lot par tranches, l'import est rejouable). */
    importPublications: (body: PublicationsImport) => t.post<PublicationImportResult>('/admin/marketing/publications/import', body, { timeoutMs: 120_000 }),
    schedulePublications: (body: PublicationScheduleInput) => t.post<PublicationScheduleResult>('/admin/marketing/publications/schedule', body, { timeoutMs: 120_000 }),
    adaptPublication: (body: { title: string; body: string; cta?: PublicationComposeInput['cta']; spaces: string[] }) => t.post<PublicationAdaptResult>('/admin/marketing/publications/adapt', body, { timeoutMs: 120_000 }),
    relay: (query: { date?: string } = {}) => t.get<RelayListView>('/admin/marketing/relay', { query }),
    markRelayed: (itemId: string, body: RelayDoneInput = {}) => t.post<PublicationItemView>(`/admin/marketing/content/${id(itemId)}/relayed`, body),
    /** Chemin du fichier à télécharger (visuel, vidéo ou miniature), nommé avec le réseau et la taille. */
    downloadPath: (itemId: string, asset: 'main' | 'thumbnail' = 'main') => `/admin/marketing/content/${id(itemId)}/download${asset === 'thumbnail' ? '?asset=thumbnail' : ''}`,
    socialSummary: () => t.get<SocialInboxSummaryView>('/admin/marketing/social/summary'),
    sendSocialReply: (messageId: string) => t.post<ConversationView>(`/admin/marketing/social/messages/${id(messageId)}/send`, {}),
  };
}
