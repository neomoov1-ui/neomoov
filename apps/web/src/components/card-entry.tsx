'use client';

/**
 * Formulaire de carte de la page `/carte` (étape 26) : le Web Payments SDK de Square affiche les champs de carte dans
 * ses propres cadres et produit un jeton (vérification 3-D Secure comprise, intention `STORE`) ; seul ce jeton est
 * envoyé au serveur web, qui le confirme auprès de l'API. Carte enregistrée : retour à l'application par lien profond.
 * Fournisseur simulé (développement, démonstration) : bouton qui enregistre une carte de test, sans formulaire.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Card, Notice } from '@/components/ui/kit';
import type { CardSessionState } from '@/lib/server/card-session';

interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: Array<{ message?: string }>;
}
interface SquareCard {
  attach(target: string): Promise<void>;
  tokenize(verificationDetails?: Record<string, unknown>): Promise<SquareTokenResult>;
  destroy(): Promise<boolean>;
}
interface SquarePayments {
  card(): Promise<SquareCard>;
  setLocale?(locale: string): Promise<void>;
}
interface SquareGlobal {
  payments(applicationId: string, locationId: string): SquarePayments;
}
declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

/** Adresses du Web Payments SDK (mêmes que l'adaptateur de l'API). */
const SDK_URLS = { production: 'https://web.squarecdn.com/v1/square.js', sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js' } as const;
/** Jeton de carte de test du simulateur (refusé par Square en production). */
const MOCK_SOURCE = 'cnon:card-nonce-ok';

type Phase = 'loading' | 'ready' | 'saving' | 'saved' | 'failed';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing && window.Square) return resolve();
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('sdk')), { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export function CardEntry({ language, state, session }: { language: 'fr-CA' | 'en'; state: CardSessionState; session: string | null }) {
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(language);
  const info = state.state === 'ok' ? state.info : null;
  const square = info?.provider === 'square' && info.squareApplicationId && info.squareLocationId && info.squareEnvironment ? info : null;
  const [phase, setPhase] = useState<Phase>(square ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [saved, setSaved] = useState<{ brand: string; last4: string } | null>(null);
  const cardRef = useRef<SquareCard | null>(null);

  useEffect(() => {
    if (!square) return;
    let cancelled = false;
    (async () => {
      try {
        await loadScript(SDK_URLS[square.squareEnvironment!]);
        if (!window.Square) throw new Error('sdk');
        const payments = window.Square.payments(square.squareApplicationId!, square.squareLocationId!);
        await payments.setLocale?.(language).catch(() => undefined);
        const card = await payments.card();
        if (cancelled) {
          await card.destroy();
          return;
        }
        await card.attach('#card-container');
        cardRef.current = card;
        setPhase('ready');
      } catch {
        if (!cancelled) {
          setPhase('failed');
          setError(t('cardForm.sdkError'));
        }
      }
    })();
    return () => {
      cancelled = true;
      void cardRef.current?.destroy().catch(() => undefined);
      cardRef.current = null;
    };
    // Le formulaire est créé une seule fois pour la session affichée.
  }, []);

  async function submit() {
    if (!info || !session) return;
    setError(null);
    setPhase('saving');
    let sourceId = MOCK_SOURCE;
    if (square) {
      const card = cardRef.current;
      if (!card) return setPhase('ready');
      // Vérification de l'acheteur (3-D Secure) faite par le SDK au moment de la tokenisation : intention d'enregistrer.
      const result = await card.tokenize({ intent: 'STORE', customerInitiated: true, sellerKeyedIn: false, billingContact: { countryCode: 'CA' } }).catch(() => null);
      if (!result || result.status !== 'OK' || !result.token) {
        setPhase('ready');
        setError(t('cardForm.invalidCard'));
        return;
      }
      sourceId = result.token;
    }
    const res = await fetch('/api/carte', { method: 'POST', headers: { 'content-type': 'application/json', 'x-neomoov-card': '1' }, body: JSON.stringify({ session, sourceId }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { code?: string; card?: { brand: string; last4: string } | null; debitMethod?: { brand: string; last4: string } | null } | undefined;
    if (res?.ok) {
      setSaved(body?.card ?? body?.debitMethod ?? null);
      setPhase('saved');
      window.setTimeout(() => window.location.assign(info.returnUrl), 1_500);
      return;
    }
    if (body?.code === 'CARD_SESSION_EXPIRED') {
      setExpired(true);
      setPhase('failed');
      return;
    }
    setPhase('ready');
    setError(t(body?.code === 'PAYMENT_DECLINED' ? 'cardForm.declined' : body?.code === 'CARD_SESSION_INVALID' ? 'cardForm.invalid' : 'cardForm.generic'));
  }

  const title = info?.purpose === 'driver_debit' ? t('cardForm.titleDriver') : t('cardForm.title');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl text-brand-night">{title}</h1>
        {info ? <p className="text-sm text-slate-600">{info.purpose === 'driver_debit' ? t('cardForm.subtitleDriver') : t('cardForm.subtitle')}</p> : null}
      </div>
      {state.state !== 'ok' ? <Notice tone={state.state === 'unavailable' ? 'danger' : 'warning'}>{t(`cardForm.${state.state}`)}</Notice> : null}
      {expired ? <Notice tone="warning">{t('cardForm.expired')}</Notice> : null}
      {info && info.provider !== 'square' && info.provider !== 'mock' ? <Notice tone="warning">{t('cardForm.notSupported')}</Notice> : null}
      {info && phase === 'saved' ? (
        <Card>
          <p role="status" className="text-lg font-semibold text-brand-night">{t('cardForm.saved')}</p>
          {saved ? <p className="text-sm text-slate-600">{t('cardForm.savedBody', { brand: saved.brand.toUpperCase(), last4: saved.last4 })}</p> : null}
          <a className="mt-3 inline-block font-semibold text-brand-blue underline" href={info.returnUrl}>{t('cardForm.back')}</a>
        </Card>
      ) : null}
      {info && !expired && phase !== 'saved' && (square || info.provider === 'mock') ? (
        <Card>
          {square ? <div id="card-container" className="min-h-24" aria-busy={phase === 'loading'} /> : <Notice>{t('cardForm.testMode')}</Notice>}
          {phase === 'loading' ? <p role="status" className="text-sm text-slate-600">{t('common.loading')}</p> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="mt-3 flex flex-col gap-2">
            <Action onClick={() => void submit()} busy={phase === 'saving'} disabled={phase !== 'ready'}>
              {phase === 'saving' ? t('cardForm.saving') : square ? t('cardForm.save') : t('cardForm.testCard')}
            </Action>
            <p className="text-xs text-slate-500">{t('cardForm.secure')}</p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
