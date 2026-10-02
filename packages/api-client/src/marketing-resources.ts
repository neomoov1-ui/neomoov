/**
 * Marketing automatisé de My Hub (phase 1 « entreprise autonome ») : espaces et connecteurs, calendrier de contenu
 * (lecture, modification, approbation, refus, publication, média), tâches de référencement, lancement des agents.
 */
import type { ContentItemView, ContentListQuery, ContentPlanRequest, ContentUpdateInput, MarketingPlanResult, MarketingSpaceView, SeoPlanResult, SeoTaskView } from '@neomoov/domain';
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
  };
}
