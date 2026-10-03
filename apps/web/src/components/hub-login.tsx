'use client';

import { NEOMOOV_BRAND, type MfaEnrollment, type StaffLoginResponse } from '@neomoov/domain';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark, useWebBrand } from '@/components/brand-context';
import { LanguageSwitch } from '@/components/language-switch';
import { OrgLogin } from '@/components/hub/org-login';
import { Action, Card, Field, Input, Notice, cx, focus } from '@/components/ui/kit';
import { ApiError, staffStep } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';

type Step = { kind: 'password' } | { kind: 'code'; mfaToken: string; backup: boolean } | { kind: 'enroll'; mfaToken: string; enrollment: MfaEnrollment } | { kind: 'backupCodes'; codes: string[] };
type Tab = 'staff' | 'organization';
type Visual = 'login' | 'mfa' | 'enroll' | 'backup';

/**
 * Visuels Neomoov des pages de connexion : un par étape, photos recadrées sans texte des visuels du fondateur
 * (`public/auth`, WebP de 120 à 180 Ko). Réservés à la marque Neomoov : un hôte en marque blanche garde la page sobre.
 */
const VISUALS: Record<Visual, { src: string; position: string }> = {
  login: { src: '/auth/login.webp', position: 'object-[55%_50%]' },
  mfa: { src: '/auth/mfa.webp', position: 'object-[45%_50%]' },
  enroll: { src: '/auth/enroll.webp', position: 'object-[50%_40%]' },
  backup: { src: '/auth/backup.webp', position: 'object-[50%_55%]' },
};

/**
 * Connexion du personnel : courriel et mot de passe, puis second facteur obligatoire. Première connexion : inscription
 * TOTP (QR et clé), premier code, puis codes de secours affichés une seule fois. Les jetons ne quittent jamais le
 * serveur web (témoins `httpOnly` posés par la passerelle). Étape 21 : onglet « Organisation » pour les membres des
 * organisations clientes (code SMS), vers l'espace de leur organisation.
 */
export function HubLogin({ language }: { language: Language }) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const brand = useWebBrand();
  const neomoov = !brand.logoUrl && brand.displayName === NEOMOOV_BRAND.displayName;
  const [tab, setTab] = useState<Tab>(params.get('espace') === 'organisation' || params.get('next')?.startsWith('/hub/organisation') ? 'organization' : 'staff');
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = params.get('next');
  const next = requested && /^\/hub(\/[\w/-]*)?$/.test(requested) ? requested : '/hub';
  const visual: Visual = step.kind === 'password' ? 'login' : step.kind === 'code' ? 'mfa' : step.kind === 'enroll' ? 'enroll' : 'backup';
  const TABS: Tab[] = ['staff', 'organization'];
  // Onglets WAI-ARIA : seul l'onglet actif reçoit le focus par Tab ; les flèches, Origine et Fin changent d'onglet.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    const target = e.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!target) return;
    e.preventDefault();
    setTab(target);
    setError(null);
    document.getElementById(`login-tab-${target}`)?.focus();
  };

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
    <div className={cx('min-h-screen bg-brand-mist', neomoov && 'lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]')}>
      {neomoov ? <AuthVisual kind={visual} /> : null}
      <div className="flex flex-col items-center justify-center gap-4 px-4 py-10 lg:min-h-screen">
        <div className="flex w-full max-w-md items-center justify-between">
          <BrandMark className="font-heading text-2xl font-bold text-brand-blue-dark" />
          <LanguageSwitch current={language} />
        </div>
        <main id="contenu" className="w-full max-w-md">
          <Card>
            {params.get('expired') === '1' && step.kind === 'password' && !error ? <div className="mb-3"><Notice tone="warning">{t('hub.login.expired')}</Notice></div> : null}
            {step.kind === 'password' ? (
              <div role="tablist" aria-label={t('hub.login.title')} className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                {TABS.map((v) => (
                  <button key={v} id={`login-tab-${v}`} type="button" role="tab" aria-selected={tab === v} aria-controls="login-panel" tabIndex={tab === v ? 0 : -1} onKeyDown={onTabKey} onClick={() => { setTab(v); setError(null); }} className={cx('rounded px-3 py-1.5 text-sm font-semibold', focus, tab === v ? 'bg-white text-brand-night shadow-sm' : 'text-slate-700 hover:bg-white/60')}>
                    {t(`org.login.tabs.${v}`)}
                  </button>
                ))}
              </div>
            ) : null}
            {step.kind === 'password' && tab === 'organization' ? (
              <div id="login-panel" role="tabpanel" aria-labelledby="login-tab-organization">
                <OrgLogin onSignedIn={() => { router.replace(next.startsWith('/hub/organisation') ? next : '/hub/organisation'); router.refresh(); }} />
              </div>
            ) : null}
            {step.kind === 'password' && tab === 'staff' ? (
              <div id="login-panel" role="tabpanel" aria-labelledby="login-tab-staff">
                <form onSubmit={submitPassword} className="flex flex-col gap-4">
                  {heading(t('hub.login.title'), t('hub.login.subtitle'))}
                  <Field label={t('hub.login.email')}>{(p) => <Input {...p} type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
                  <Field label={t('hub.login.password')}>{(p) => <Input {...p} type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
                  {error ? <Notice tone="danger">{error}</Notice> : null}
                  <Action type="submit" busy={busy} disabled={busy}>{t('hub.login.submit')}</Action>
                </form>
              </div>
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
                <div role="img" aria-label={t('hub.login.qr')} className="mx-auto w-48 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: step.enrollment.qrSvg }} />
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
    </div>
  );
}

/** Panneau visuel : photo plein cadre, voile sombre et accroche de la marque ; bandeau en haut sur mobile, colonne sur grand écran. */
function AuthVisual({ kind }: { kind: Visual }) {
  const { t } = useTranslation();
  const visual = VISUALS[kind];
  return (
    <aside className="relative h-48 overflow-hidden bg-brand-night sm:h-60 lg:h-auto lg:min-h-screen" aria-label={t(`hub.login.visual.${kind}.title`)}>
      {/* Fichier local de `public/auth`, hors optimisation Next.js (pas de sharp dans l'image de production). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={visual.src} src={visual.src} alt="" className={cx('absolute inset-0 h-full w-full object-cover', visual.position)} decoding="async" />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-night/85 via-brand-night/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white lg:p-10">
        <p className="font-heading text-2xl font-bold leading-tight lg:text-4xl">{t(`hub.login.visual.${kind}.title`)}</p>
        <p className="mt-1 text-sm text-white/85 lg:mt-2 lg:text-lg">{t(`hub.login.visual.${kind}.subtitle`)}</p>
      </div>
      <span className="absolute right-3 top-3 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{t('hub.login.visual.caption')}</span>
    </aside>
  );
}
