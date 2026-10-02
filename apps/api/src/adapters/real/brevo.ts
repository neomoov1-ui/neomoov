/**
 * Infolettre Brevo réelle (phase 1 « entreprise autonome ») : chaque contenu `newsletter` devient une campagne
 * courriel en brouillon (`POST /v3/emailCampaigns`, liste `BREVO_NEWSLETTER_LIST_ID`, expéditeur `BREVO_SENDER_*`) ;
 * l'envoi reste une décision humaine dans Brevo tant que le fondateur n'a pas tranché l'envoi automatique. Les mesures
 * viennent des statistiques de la campagne. La clé ne quitte jamais l'objet.
 */
import { AppError } from '../../common/app-error.js';
import type { PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { escapeHtml, textToHtml } from './wordpress.js';

export interface BrevoOptions {
  apiKey: string;
  listId: number;
  senderEmail: string;
  senderName: string;
  fetchImpl?: typeof fetch;
}

const API = 'https://api.brevo.com/v3';

interface BrevoCampaign {
  id: number;
  statistics?: { globalStats?: { sent?: number; delivered?: number; uniqueViews?: number; uniqueClicks?: number; viewed?: number; clickers?: number } };
}

/** Courriel simple de l'infolettre : titre, texte de l'agent en HTML, lien de désinscription obligatoire (Loi anti-pourriel). */
export function newsletterHtml(title: string, body: string, ctaUrl: string | null): string {
  const cta = ctaUrl ? `<p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 20px;background:#0a2431;color:#c4f45c;text-decoration:none;border-radius:6px;font-weight:bold">Réserver sur neomoov.net</a></p>` : '';
  return `<!doctype html><html lang="fr-CA"><body style="font-family:Arial,sans-serif;color:#10171f;max-width:640px;margin:0 auto;padding:24px">
<p style="font-size:22px;font-weight:bold;letter-spacing:-0.5px">neomoov</p>
<h1 style="font-size:24px">${escapeHtml(title)}</h1>
${textToHtml(body)}
${cta}
<p style="font-size:12px;color:#667">Vous recevez ce courriel parce que vous êtes inscrit à l'infolettre Neomoov (Groupe NSK inc., Montréal). <a href="{{ unsubscribe }}">Se désabonner</a></p>
</body></html>`;
}

export class BrevoNewsletterPublisher implements SocialPublisher {
  readonly name = 'brevo';
  readonly configured = true;
  readonly space = 'newsletter' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BrevoOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, space: this.space, listId: this.options.listId, configured: true };
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        method: init.method ?? 'GET',
        headers: { 'api-key': this.options.apiKey, accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError('SOCIAL_PROVIDER_ERROR', `Brevo injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T & { message?: string }) : ({} as T & { message?: string });
    if (!response.ok) throw new AppError('SOCIAL_PROVIDER_ERROR', `Brevo ${response.status} sur ${path} : ${data.message ?? text.slice(0, 200)}`, 502);
    return data;
  }

  /** Toujours un brouillon : la plateforme ne déclenche aucun envoi d'infolettre (décision du fondateur attendue). */
  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const title = input.title ?? input.text.split('\n')[0]!.slice(0, 120);
    const data = await this.request<BrevoCampaign>('/emailCampaigns', {
      method: 'POST',
      body: {
        name: `${title} (${input.itemId.slice(0, 8)})`, subject: title, sender: { name: this.options.senderName, email: this.options.senderEmail }, type: 'classic',
        htmlContent: newsletterHtml(title, input.body, input.ctaUrl), recipients: { listIds: [this.options.listId] },
      },
    });
    return { externalId: String(data.id), url: `https://app.brevo.com/marketing-campaign/classic/${data.id}/setup`, draft: true };
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const data = await this.request<BrevoCampaign>(`/emailCampaigns/${encodeURIComponent(ref.externalId)}?statistics=globalStats`);
    const stats = data.statistics?.globalStats ?? {};
    return { reach: stats.delivered ?? stats.sent ?? 0, interactions: stats.uniqueViews ?? stats.viewed ?? 0, clicks: stats.uniqueClicks ?? stats.clickers ?? 0, collectedAt: new Date(), raw: { ...stats } };
  }

  /** Une infolettre n'a pas de commentaires : les réponses des lecteurs arrivent par courriel (relation client). */
  async comments(): Promise<SocialComment[]> {
    return [];
  }

  async replyComment(): Promise<{ externalId: string }> {
    throw new AppError('SOCIAL_UNSUPPORTED', 'Aucune réponse possible sur une infolettre', 422);
  }
}
