'use client';

/**
 * Rejoindre une flotte comme chauffeur (étape 23) : la personne invitée par texto se connecte par code (même téléphone
 * que l'invitation), puis accepte ; son profil chauffeur (existant ou nouveau) est rattaché à l'organisation. Le jeton
 * arrive par le lien du texto (`?token=`) ou se saisit ; l'API vérifie qu'il lui est adressé.
 */
import type { AppConfig } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OtpSignIn } from '@/components/otp-sign-in';
import { Action, Card, Field, Input, Notice } from '@/components/ui/kit';
import { createGuestApi, errorCode } from '@/lib/site-api';

interface Attachment {
  organizationName: string;
  created: boolean;
}

export function DriverJoin({ initialToken }: { initialToken: string }) {
  const { t } = useTranslation();
  const guest = useRef(createGuestApi()).current;
  const config = useQuery<AppConfig>({ queryKey: ['config'], queryFn: () => guest.api.config.get(), staleTime: 300_000 });
  const [token, setToken] = useState(initialToken);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      setJoined(await guest.api.post<Attachment>('/driver-invitations/accept', { token: token.trim() }));
    } catch (e) {
      const c = errorCode(e);
      setError(c === 'INVITATION_NOT_FOR_YOU' ? t('fleet.join.errors.notForYou') : c === 'INVITATION_EXPIRED' ? t('fleet.join.errors.expired') : c === 'INVITATION_ALREADY_USED' ? t('fleet.join.errors.used') : t('fleet.join.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-3xl text-brand-night">{t('fleet.join.title')}</h1>
        <p className="mt-1 text-slate-700">{t('fleet.join.subtitle')}</p>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {joined ? (
        <Notice tone="success">{t(joined.created ? 'fleet.join.doneNew' : 'fleet.join.done', { organization: joined.organizationName })}</Notice>
      ) : (
        <Card>
          {signedIn ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void accept(); }}>
              <Field label={t('fleet.join.token')}>{(p) => <Input {...p} required minLength={10} value={token} onChange={(e) => setToken(e.target.value)} />}</Field>
              <div><Action type="submit" busy={busy} disabled={busy || token.trim().length < 10}>{t('fleet.join.accept')}</Action></div>
            </form>
          ) : (
            <OtpSignIn guest={guest} onSignedIn={() => setSignedIn(true)} {...(config.data ? { terms: { termsUrl: config.data.legal.termsUrl, privacyUrl: config.data.legal.privacyUrl, version: config.data.legal.privacyPolicyVersion } } : {})} />
          )}
        </Card>
      )}
      <p className="text-xs text-slate-600">{t('fleet.scope')}</p>
    </div>
  );
}
