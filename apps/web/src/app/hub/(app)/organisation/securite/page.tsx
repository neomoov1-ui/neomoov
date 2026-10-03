'use client';

import type { MfaEnrollment, StaffLoginResponse } from '@neomoov/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { Action, Card, Field, Input, Notice, PageTitle } from '@/components/ui/kit';
import { ApiError, orgStep } from '@/lib/hub-api';

type Step = { kind: 'idle' } | { kind: 'code'; mfaToken: string; backup: boolean } | { kind: 'enroll'; mfaToken: string; enrollment: MfaEnrollment } | { kind: 'backupCodes'; codes: string[] } | { kind: 'done' };

/**
 * Étape 21 : double authentification d'un membre d'organisation connecté par code SMS, proposée dès qu'une permission
 * sensible est nécessaire. Mêmes écrans que le personnel : inscription (QR, clé, premier code, codes de secours) ou
 * vérification du code ; la passerelle remplace la session par une session à double authentification.
 */
export default function OrgSecurityPage() {
  return <OrgPage>{() => <Security />}</OrgPage>;
}

function Security() {
  const { t } = useTranslation();
  const { home, refresh } = useOrg();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlocks = home?.mfaPermissions ?? [];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INVALID_TRANSIENT_TOKEN' || e.code === 'MFA_ENROLLMENT_NOT_STARTED')) {
        setStep({ kind: 'idle' });
        setError(t('hub.login.errors.expired'));
      } else if (e instanceof ApiError && e.status === 423) setError(t('hub.login.errors.locked'));
      else if (e instanceof ApiError && e.status === 429) setError(t('hub.login.errors.rateLimited'));
      else if (e instanceof ApiError && (e.status === 400 || e.status === 401)) setError(t('hub.login.errors.invalid'));
      else setError(t('hub.login.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  const start = () => void run(async () => {
    const res = await orgStep<StaffLoginResponse>('mfa-start');
    setCode('');
    if (res.status === 'mfa_enrollment_required') setStep({ kind: 'enroll', mfaToken: res.mfaToken, enrollment: await orgStep<MfaEnrollment>('mfa-enroll', { mfaToken: res.mfaToken }) });
    else setStep({ kind: 'code', mfaToken: res.mfaToken, backup: false });
  });

  const finish = () => {
    setStep({ kind: 'done' });
    refresh();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind === 'enroll') {
      void run(async () => {
        const res = await orgStep<{ backupCodes?: string[] }>('mfa-confirm', { mfaToken: step.mfaToken, code: code.trim() });
        setStep({ kind: 'backupCodes', codes: res.backupCodes ?? [] });
      });
    } else if (step.kind === 'code') {
      void run(async () => {
        if (step.backup) await orgStep('mfa-backup', { mfaToken: step.mfaToken, backupCode: code.trim() });
        else await orgStep('mfa-verify', { mfaToken: step.mfaToken, code: code.trim() });
        finish();
      });
    }
  };

  const codeField = (backup: boolean) => (
    <Field label={backup ? t('hub.login.backupCode') : t('hub.login.code')}>
      {(p) => <Input {...p} name={backup ? 'backup-code' : 'one-time-code'} autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'} pattern={backup ? '[A-Za-z0-9]{4}-[A-Za-z0-9]{4}' : '[0-9]{6}'} maxLength={backup ? 9 : 6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />}
    </Field>
  );

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <PageTitle title={t('org.security.title')} subtitle={t('org.security.intro')} />
      <Card>
        {step.kind === 'idle' ? (
          home?.mfa ? <Notice tone="success">{t('org.security.active')}</Notice> : (
            <div className="flex flex-col gap-3">
              {unlocks.length ? <p className="text-sm text-slate-700">{t('org.security.unlocks', { list: unlocks.join(', ') })}</p> : null}
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <div><Action busy={busy} onClick={start}>{t('org.security.start')}</Action></div>
            </div>
          )
        ) : null}
        {step.kind === 'enroll' ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{t('hub.login.enrollSubtitle')}</p>
            {/* SVG produit par l'API (bibliothèque de QR côté serveur), jamais par une saisie. */}
            <div role="img" aria-label={t('hub.login.qr')} className="mx-auto w-48 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: step.enrollment.qrSvg }} />
            <div>
              <p className="text-xs font-semibold text-slate-700">{t('hub.login.enrollSecret')}</p>
              <code className="mt-1 block break-all rounded bg-slate-100 p-2 text-sm" data-testid="totp-secret">{step.enrollment.secret}</code>
            </div>
            {codeField(false)}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.enrollConfirm')}</Action>
          </form>
        ) : null}
        {step.kind === 'code' ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{t('org.security.verifyTitle')}</p>
            {codeField(step.backup)}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.verify')}</Action>
            <Action tone="ghost" onClick={() => { setCode(''); setStep({ ...step, backup: !step.backup }); }}>{step.backup ? t('hub.login.useCode') : t('hub.login.useBackup')}</Action>
          </form>
        ) : null}
        {step.kind === 'backupCodes' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{t('hub.login.backupSubtitle')}</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="backup-codes">
              {step.codes.map((c) => <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</li>)}
            </ul>
            <Action onClick={finish}>{t('hub.login.backupSaved')}</Action>
          </div>
        ) : null}
        {step.kind === 'done' ? <Notice tone="success">{t('org.security.done')}</Notice> : null}
      </Card>
    </div>
  );
}
