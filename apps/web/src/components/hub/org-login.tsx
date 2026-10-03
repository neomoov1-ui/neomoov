'use client';

/**
 * Étape 21 : connexion d'un membre d'organisation cliente à My Hub par code SMS (comptes existants seulement ; un compte
 * se crée par le lien d'invitation). Les jetons restent côté serveur (témoins `httpOnly` posés par la passerelle).
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AntiBotChallenge, useAntiBotChallenge } from '@/components/turnstile';
import { Action, Field, Input, Notice } from '@/components/ui/kit';
import { ApiError, orgStep } from '@/lib/hub-api';
import { toE164 } from '@/lib/site-api';

export function OrgLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e164 = toE164(phone);
  const language = i18n.language === 'en' ? 'en' : 'fr';
  // Défi anti-robots demandé par l'API après plusieurs demandes de code depuis cette adresse (revue Q1).
  const challenge = useAntiBotChallenge();

  const fail = (e: unknown) => {
    if (!(e instanceof ApiError)) return setError(t('org.login.errors.generic'));
    if (challenge.handle(e)) return;
    if (e.code === 'TERMS_NOT_ACCEPTED' || e.code === 'PRIVACY_POLICY_VERSION_OUTDATED') return setError(t('org.login.noAccount'));
    if (e.status === 429) return setError(t('org.login.errors.rateLimited'));
    if (e.status === 400 || e.status === 401) return setError(sent ? t('org.login.errors.code') : t('org.login.errors.phone'));
    setError(t('org.login.errors.generic'));
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!e164) return setError(t('org.login.errors.phone'));
    if (!sent) {
      void run(async () => {
        await orgStep('request', { phone: e164, language }, challenge.headers());
        setSent(true);
      });
    } else {
      void run(async () => {
        await orgStep('verify', { phone: e164, code: code.trim(), language });
        onSignedIn();
      });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl text-brand-night">{t('org.login.title')}</h1>
        <p className="mt-1 text-sm text-slate-700">{t('org.login.subtitle')}</p>
      </div>
      <Field label={t('org.login.phone')} hint={t('org.login.phoneHint')}>
        {(p) => <Input {...p} type="tel" name="tel" autoComplete="tel" required autoFocus disabled={sent} value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      {sent ? (
        <Field label={t('org.login.code')}>
          {(p) => <Input {...p} name="one-time-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!sent ? <AntiBotChallenge challenge={challenge} language={language} /> : null}
      <Action type="submit" busy={busy} disabled={busy || !e164 || (sent && code.trim().length !== 6) || (!sent && challenge.blocking)}>{sent ? t('org.login.verify') : t('org.login.send')}</Action>
      {sent ? <Action tone="ghost" onClick={() => { setSent(false); setCode(''); setError(null); }}>{t('org.login.resend')}</Action> : null}
    </form>
  );
}
