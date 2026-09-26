'use client';

/**
 * Protection anti-robots (Cloudflare Turnstile). Sans clé de site (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), en développement,
 * un jeton de développement est fourni tout de suite : l'API l'accepte seulement hors production et sans clé secrète.
 */
import { useEffect, useRef } from 'react';

const SITE_KEY = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '';
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
