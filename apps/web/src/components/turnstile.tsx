'use client';

/**
 * Protection anti-robots (Cloudflare Turnstile). Sans clé de site (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), en développement,
 * un jeton de développement est fourni tout de suite : l'API l'accepte seulement hors production et sans clé secrète.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/ui/kit';

const SITE_KEY = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '';
/** En-tête du jeton de défi attendu par l'API sur les routes protégées après plusieurs échecs. */
export const ANTI_BOT_HEADER = 'x-turnstile-token';
/** Codes d'erreur de l'API qui demandent le défi : jeton absent, ou jeton refusé. */
const CHALLENGE_CODES = new Set(['TURNSTILE_REQUIRED', 'TURNSTILE_FAILED']);

/**
 * Défi anti-robots à la demande de l'API (revue du 2 octobre 2026) : connexion à My Hub, codes SMS de la réservation,
 * devis publics. Rien n'est affiché tant que l'API ne répond pas `TURNSTILE_REQUIRED` (ou `TURNSTILE_FAILED`) ; le
 * défi apparaît alors et la tentative suivante porte son jeton, qui ne sert qu'une fois (nouveau défi ensuite). Sans
 * clé de site, aucun défi : un message invite à réessayer plus tard.
 */
export function useAntiBotChallenge() {
  const [required, setRequired] = useState<'required' | 'failed' | null>(null);
  const [round, setRound] = useState(0);
  const [ready, setReady] = useState(false);
  const token = useRef<string | null>(null);
  const onToken = useCallback((value: string | null) => {
    token.current = value;
    setReady(Boolean(value));
  }, []);
  return {
    required,
    round,
    onToken,
    /** Défi affiché, jeton pas encore obtenu : la tentative attend (sauf sans clé de site, où aucun défi ne viendra). */
    blocking: Boolean(required && SITE_KEY && !ready),
    /** Vrai si l'erreur de l'API demandait le défi : il s'affiche, l'action est à refaire. */
    handle(error: unknown): boolean {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code !== 'string' || !CHALLENGE_CODES.has(code)) return false;
      setRequired(code === 'TURNSTILE_FAILED' ? 'failed' : 'required');
      return true;
    },
    /** En-têtes de la tentative : le jeton du défi s'il y en a un, consommé (le défi suivant repart à zéro). */
    headers(): Record<string, string> {
      const value = token.current;
      if (!value) return {};
      token.current = null;
      setReady(false);
      setRound((r) => r + 1);
      return { [ANTI_BOT_HEADER]: value };
    },
  };
}

/** Défi demandé par l'API, ou message d'attente sans clé de site ; rien tant qu'il n'est pas demandé. */
export function AntiBotChallenge({ challenge, language }: { challenge: ReturnType<typeof useAntiBotChallenge>; language: string }) {
  const { t } = useTranslation();
  if (!challenge.required) return null;
  if (!SITE_KEY) return <Notice tone="warning">{t('antiBot.unavailable')}</Notice>;
  return (
    <div className="flex flex-col gap-2">
      <Notice tone="warning">{t(challenge.required === 'failed' ? 'antiBot.failed' : 'antiBot.required')}</Notice>
      <Turnstile key={challenge.round} onToken={challenge.onToken} language={language} />
    </div>
  );
}
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; language?: string }) => string;
  remove: (id: string) => void;
}

export function Turnstile({ onToken, language }: { onToken: (token: string | null) => void; language: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY) {
      onToken('dev-token');
      return;
    }
    let widget: string | null = null;
    const mount = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!api || !ref.current) return;
      widget = api.render(ref.current, { sitekey: SITE_KEY, callback: (token) => onToken(token), 'expired-callback': () => onToken(null), language });
    };
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) mount();
    else {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.async = true;
      script.onload = mount;
      document.head.appendChild(script);
    }
    return () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && widget) api.remove(widget);
    };
  }, [onToken, language]);
  return SITE_KEY ? <div ref={ref} className="min-h-16" /> : null;
}
