'use client';

import type { MfaEnrollment, StaffLoginResponse } from '@neomoov/domain';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/components/language-switch';
import { Action, Card, Field, Input, Notice } from '@/components/ui/kit';
import { ApiError, staffStep } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';

type Step = { kind: 'password' } | { kind: 'code'; mfaToken: string; backup: boolean } | { kind: 'enroll'; mfaToken: string; enrollment: MfaEnrollment } | { kind: 'backupCodes'; codes: string[] };

/**
 * Connexion du personnel : courriel et mot de passe, puis second facteur obligatoire. Première connexion : inscription
 * TOTP (QR et clé), premier code, puis codes de secours affichés une seule fois. Les jetons ne quittent jamais le
 * serveur web (témoins `httpOnly` posés par la passerelle).
 */
export function HubLogin({ language }: { language: Language }) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = params.get('next');
  const next = requested && /^\/hub(\/[\w/-]*)?$/.test(requested) ? requested : '/hub';

  const fail = (e: unknown) => {
    if (!(e instanceof ApiError)) return setError(t('hub.login.errors.generic'));
    if (e.code === 'INVALID_TRANSIENT_TOKEN' || e.code === 'MFA_ENROLLMENT_NOT_STARTED') {
      setStep({ kind: 'password' });
      return setError(t('hub.login.errors.expired'));
    }
    if (e.status === 423) return setError(t('hub.login.errors.locked'));
    if (e.status === 429) return setError(t('hub.login.errors.rateLimited'));
    if (e.status === 401 || e.status === 400) return setError(t('hub.login.errors.invalid'));
    setError(t('hub.login.errors.generic'));
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

  const enter = () => {
    router.replace(next);
    router.refresh();
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await staffStep<StaffLoginResponse>('login', { email: email.trim(), password });
      setPassword('');
      setCode('');
      if (res.status === 'mfa_enrollment_required') {
        const enrollment = await staffStep<MfaEnrollment>('enroll', { mfaToken: res.mfaToken });
        setStep({ kind: 'enroll', mfaToken: res.mfaToken, enrollment });
      } else {
        setStep({ kind: 'code', mfaToken: res.mfaToken, backup: false });
      }
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind === 'code') {
      void run(async () => {
        if (step.backup) await staffStep('backup', { mfaToken: step.mfaToken, backupCode: code.trim() });
        else await staffStep('verify', { mfaToken: step.mfaToken, code: code.trim() });
        enter();
      });
    } else if (step.kind === 'enroll') {
      void run(async () => {
        const res = await staffStep<{ backupCodes?: string[] }>('confirm', { mfaToken: step.mfaToken, code: code.trim() });
        setStep({ kind: 'backupCodes', codes: res.backupCodes ?? [] });
      });
    }
  };

  const codeField = (label: string, backup = false) => (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          name={backup ? 'backup-code' : 'one-time-code'}
          autoComplete="one-time-code"
          inputMode={backup ? 'text' : 'numeric'}
          pattern={backup ? '[A-Za-z0-9]{4}-[A-Za-z0-9]{4}' : '[0-9]{6}'}
          maxLength={backup ? 9 : 6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      )}
    </Field>
  );

  const heading = (title: string, subtitle: string) => (
    <div>
      <h1 className="text-xl text-brand-night">{title}</h1>
      <p className="mt-1 text-sm text-slate-700">{subtitle}</p>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-mist px-4 py-10">
      <div className="flex w-full max-w-md items-center justify-between">
        <span className="font-heading text-2xl font-bold text-brand-blue-dark">neomoov</span>
        <LanguageSwitch current={language} />
      </div>
      <main id="contenu" className="w-full max-w-md">
        <Card>
          {params.get('expired') === '1' && step.kind === 'password' && !error ? <div className="mb-3"><Notice tone="warning">{t('hub.login.expired')}</Notice></div> : null}
          {step.kind === 'password' ? (
            <form onSubmit={submitPassword} className="flex flex-col gap-4">
              {heading(t('hub.login.title'), t('hub.login.subtitle'))}
              <Field label={t('hub.login.email')}>{(p) => <Input {...p} type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
              <Field label={t('hub.login.password')}>{(p) => <Input {...p} type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.submit')}</Action>
            </form>
          ) : null}

          {step.kind === 'code' ? (
            <form onSubmit={submitCode} className="flex flex-col gap-4">
              {heading(t('hub.login.mfaTitle'), t('hub.login.mfaSubtitle'))}
              {codeField(step.backup ? t('hub.login.backupCode') : t('hub.login.code'), step.backup)}
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.verify')}</Action>
              <Action tone="ghost" onClick={() => { setCode(''); setStep({ ...step, backup: !step.backup }); }}>{step.backup ? t('hub.login.useCode') : t('hub.login.useBackup')}</Action>
            </form>
          ) : null}

          {step.kind === 'enroll' ? (
            <form onSubmit={submitCode} className="flex flex-col gap-4">
              {heading(t('hub.login.enrollTitle'), t('hub.login.enrollSubtitle'))}
              {/* SVG produit par l'API (bibliothèque de QR côté serveur), jamais par une saisie. */}
              <div role="img" aria-label="QR" className="mx-auto w-48 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: step.enrollment.qrSvg }} />
              <div>
                <p className="text-xs font-semibold text-slate-700">{t('hub.login.enrollSecret')}</p>
                <code className="mt-1 block break-all rounded bg-slate-100 p-2 text-sm" data-testid="totp-secret">{step.enrollment.secret}</code>
              </div>
              {codeField(t('hub.login.code'))}
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.enrollConfirm')}</Action>
            </form>
          ) : null}

          {step.kind === 'backupCodes' ? (
            <div className="flex flex-col gap-4">
              {heading(t('hub.login.backupTitle'), t('hub.login.backupSubtitle'))}
              <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="backup-codes">
                {step.codes.map((c) => <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</li>)}
              </ul>
              <Action onClick={enter}>{t('hub.login.backupSaved')}</Action>
            </div>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
