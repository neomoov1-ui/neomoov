'use client';

/** Page « Devenir chauffeur » : arguments, conditions, et préinscription (prospect de l'API publique, anti-robots, consentement). */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '@/components/turnstile';
import { Action, Card, Checkbox, Field, Input, Notice, Textarea } from '@/components/ui/kit';
import { ApiError, publicApi, toE164 } from '@/lib/site-api';

export function DriverSignup() {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', city: 'Montréal', message: '' });
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onToken = useCallback((value: string | null) => setToken(value), []);
  const phone = toE164(form.phone);
  const benefits = t('driversPage.benefits', { returnObjects: true }) as string[];
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit() {
    if (!phone || !consent || !token) return;
    setBusy(true);
    setError(null);
    try {
      await publicApi.public.lead({
        kind: 'driver', firstName: form.firstName.trim(), phone, language: i18n.language === 'en' ? 'en' : 'fr', antiBotToken: token, consent: true,
        ...(form.lastName.trim() ? { lastName: form.lastName.trim() } : {}), ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}), ...(form.message.trim() ? { message: form.message.trim() } : {}),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'ANTI_BOT_FAILED' ? t('driversPage.errors.antiBot') : e instanceof ApiError && e.status === 429 ? t('driversPage.errors.rateLimited') : t('driversPage.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 py-8 md:grid-cols-2">
      <section>
        <h1 className="text-3xl leading-tight text-brand-night md:text-4xl">{t('driversPage.title')}</h1>
        <p className="mt-3 text-lg">{t('driversPage.subtitle')}</p>
        <ul className="mt-5 flex list-disc flex-col gap-2 pl-5">{benefits.map((b) => <li key={b}>{b}</li>)}</ul>
        <p className="mt-5 text-sm text-slate-700">{t('driversPage.requirements')}</p>
      </section>
      <Card title={t('driversPage.form')}>
        {sent ? (
          <div role="status" className="flex flex-col gap-2">
            <Notice tone="success">{t('driversPage.sent')}</Notice>
            <p className="text-sm">{t('driversPage.sentBody')}</p>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('driversPage.firstName')}>{(p) => <Input {...p} required autoComplete="given-name" maxLength={80} value={form.firstName} onChange={set('firstName')} />}</Field>
              <Field label={t('driversPage.lastName')}>{(p) => <Input {...p} autoComplete="family-name" maxLength={80} value={form.lastName} onChange={set('lastName')} />}</Field>
            </div>
            <Field label={t('driversPage.phone')} error={form.phone && !phone ? t('book.errors.phone') : null}>{(p) => <Input {...p} type="tel" required autoComplete="tel" value={form.phone} onChange={set('phone')} />}</Field>
            <Field label={t('driversPage.email')}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={254} value={form.email} onChange={set('email')} />}</Field>
            <Field label={t('driversPage.city')}>{(p) => <Input {...p} autoComplete="address-level2" maxLength={80} value={form.city} onChange={set('city')} />}</Field>
            <Field label={t('driversPage.message')}>{(p) => <Textarea {...p} maxLength={2000} value={form.message} onChange={set('message')} />}</Field>
            <Checkbox required checked={consent} onChange={(e) => setConsent(e.target.checked)} label={t('driversPage.consent')} />
            <Turnstile onToken={onToken} language={i18n.language === 'en' ? 'en' : 'fr'} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <div><Action type="submit" busy={busy} disabled={busy || !phone || !consent || !token || !form.firstName.trim()}>{busy ? t('driversPage.sending') : t('driversPage.submit')}</Action></div>
          </form>
        )}
      </Card>
    </div>
  );
}
