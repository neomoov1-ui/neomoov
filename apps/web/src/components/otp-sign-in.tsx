'use client';

/**
 * Vérification du numéro par code SMS (réservation web, page des droits). Les jetons restent en mémoire (client
 * `guestApi`) : rien n'est écrit dans un témoin ni dans le stockage du navigateur.
 */
import type { TokensView } from '@neomoov/domain';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Checkbox, Field, Input, Notice } from '@/components/ui/kit';
import { ApiError, toE164, type createGuestApi } from '@/lib/site-api';

type Guest = ReturnType<typeof createGuestApi>;

export function OtpSignIn({ guest, onSignedIn, terms, allowCreate = true, noAccountText, children }: {
  guest: Guest;
  onSignedIn: (tokens: TokensView) => void;
  /** Liens des conditions et de la politique, et version à accepter (création de compte). */
  terms?: { termsUrl: string; privacyUrl: string; version: string };
  allowCreate?: boolean;
  noAccountText?: string;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e164 = toE164(phone);

  const message = (e: unknown) => {
    if (!(e instanceof ApiError)) return t('book.errors.generic');
    if (e.status === 429) return t('book.errors.rateLimited');
    if (e.code === 'TERMS_NOT_ACCEPTED' || e.code === 'PRIVACY_POLICY_VERSION_OUTDATED') return allowCreate ? t('book.errors.terms') : (noAccountText ?? t('book.errors.generic'));
    if (e.status === 400 || e.status === 401) return t('book.errors.code');
    return t('book.errors.service');
  };

  async function send() {
    if (!e164) return setError(t('book.errors.phone'));
    setBusy(true);
    setError(null);
    try {
      await guest.api.auth.requestOtp(e164);
      setSent(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!e164) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await guest.api.auth.verifyOtp({
        phone: e164,
        code: code.trim(),
        language: i18n.language === 'en' ? 'en' : 'fr',
        ...(allowCreate && accepted && terms ? { acceptTerms: true, privacyPolicyVersion: terms.version } : {}),
      });
      guest.signIn(tokens.accessToken);
      onSignedIn(tokens);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-blue-dark underline">{text}</a>;
  return (
    <div className="flex flex-col gap-3">
      {children}
      <Field label={t('book.phone')} hint={t('book.phoneHint')} error={phone && !e164 ? t('book.errors.phone') : null}>
        {(p) => <Input {...p} type="tel" autoComplete="tel" required value={phone} disabled={sent} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      {!sent ? (
        <div><Action onClick={() => void send()} busy={busy} disabled={busy || !e164}>{t('book.sendCode')}</Action></div>
      ) : (
        <>
          <Field label={t('book.code')}>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          {allowCreate && terms ? (
            <Checkbox
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              label={<>{t('book.accept', { terms: '__T__', privacy: '__P__' }).split(/(__T__|__P__)/).map((part, i) => (part === '__T__' ? <span key={i}>{link(terms.termsUrl, t('book.terms'))}</span> : part === '__P__' ? <span key={i}>{link(terms.privacyUrl, t('book.privacy'))}</span> : part))}</>}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Action onClick={() => void verify()} busy={busy} disabled={busy || code.trim().length !== 6}>{t('book.verify')}</Action>
            <Action tone="ghost" onClick={() => { setSent(false); setCode(''); }}>{t('book.resend')}</Action>
          </div>
        </>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
