'use client';

/**
 * Rejoindre une organisation (étape 19) : la personne invitée se connecte par texto (compte créé au besoin), puis
 * accepte l'invitation. Le code arrive par le lien (`?code=`) ou se saisit ; l'API vérifie qu'il lui est adressé.
 */
import type { AppConfig, MembershipView } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebBrand } from '@/components/brand-context';
import { OtpSignIn } from '@/components/otp-sign-in';
import { Action, Card, Field, Input, Notice } from '@/components/ui/kit';
import { createGuestApi, errorCode } from '@/lib/site-api';

export function Join({ initialCode }: { initialCode: string }) {
  const { t } = useTranslation();
  // Conditions et politique de la marque de l'hôte (étape 22).
  const brand = useWebBrand();
  const guest = useRef(createGuestApi()).current;
  const config = useQuery<AppConfig>({ queryKey: ['config'], queryFn: () => guest.api.config.get(), staleTime: 300_000 });
  const [code, setCode] = useState(initialCode);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<MembershipView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      setJoined(await guest.api.me.acceptInvitation(code.trim()));
    } catch (e) {
      const c = errorCode(e);
      setError(c === 'INVITATION_NOT_FOR_YOU' ? t('join.errors.notForYou') : c === 'INVITATION_EXPIRED' ? t('join.errors.expired') : c === 'INVITATION_ALREADY_USED' ? t('join.errors.used') : t('join.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-3xl text-brand-night">{t('join.title')}</h1>
        <p className="mt-1 text-slate-700">{t('join.subtitle')}</p>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {joined ? (
        <div className="flex flex-col gap-3">
          <Notice tone="success">{t('join.done', { role: joined.roleName })}</Notice>
          {/* Étape 21 : l'espace de l'organisation dans My Hub, par la connexion « Organisation » (code SMS). */}
          <a href="/hub/connexion?espace=organisation" className="font-semibold text-brand-blue-dark underline">{t('join.openHub')}</a>
        </div>
      ) : (
        <Card>
          {signedIn ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void accept(); }}>
              <Field label={t('join.code')}>{(p) => <Input {...p} required minLength={20} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
              <div><Action type="submit" busy={busy} disabled={busy || code.trim().length < 20}>{t('join.accept')}</Action></div>
            </form>
          ) : (
            <OtpSignIn guest={guest} onSignedIn={() => setSignedIn(true)} {...(config.data ? { terms: { termsUrl: brand.termsUrl, privacyUrl: brand.privacyUrl, version: config.data.legal.privacyPolicyVersion } } : {})} />
          )}
        </Card>
      )}
    </div>
  );
}
