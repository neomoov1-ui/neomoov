'use client';

/**
 * Réservation web sans compte (`/reserver`, intégrable en iframe) : trajet et heure (préavis minimal de la
 * configuration), prix garanti par catégorie (API publique), vérification du numéro par SMS (compte créé au besoin),
 * prix confirmé avec le compte, paiement au chauffeur (modes renvoyés par le devis), confirmation et lien de suivi.
 */
import type { AppConfig, PaymentMethod, Place, QuoteRequest, QuoteView, QuotesResponse, RidePreferences, RideView } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/address-field';
import { OtpSignIn } from '@/components/otp-sign-in';
import { QuoteList } from '@/components/quote-list';
import { Action, Card, Field, Input, Notice, Textarea, cx } from '@/components/ui/kit';
import { formatDateTime, formatMoney, montrealToIso } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { createGuestApi, errorCode, publicApi } from '@/lib/site-api';

const OPTIONS = { flex: false, priority: false, childSeat: false, luggage: false };
const PREFERENCES: RidePreferences = { conversation: 'indifferent', music: 'indifferent', temperature: 'neutral', luggageHelp: false };
type Step = 'trip' | 'price' | 'contact' | 'done';

/**
 * Le web n'encaisse rien : seulement le paiement au chauffeur après la course (D35), et seulement les modes que renvoie
 * le devis (`paymentMethods` : ceux qu'au moins un chauffeur accepte). La carte se prépaie dans l'application.
 */
const PAY_AFTER_METHODS: readonly PaymentMethod[] = ['cash', 'interac', 'terminal'];
const payAfterMethods = (offered: readonly PaymentMethod[] | undefined) => PAY_AFTER_METHODS.filter((m) => offered?.includes(m));

function localParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function Booking() {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const guest = useRef(createGuestApi()).current;
  const config = useQuery<AppConfig>({ queryKey: ['config'], queryFn: () => guest.api.config.get(), staleTime: 300_000 });
  const minLeadMs = (config.data?.booking.minLeadSeconds ?? 7200) * 1000;
  const earliest = useMemo(() => {
    const at = new Date(Date.now() + minLeadMs + 15 * 60_000);
    at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0);
    return at;
  }, [minLeadMs]);

  const [step, setStep] = useState<Step>('trip');
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const initial = localParts(earliest);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [quotes, setQuotes] = useState<QuotesResponse | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [special, setSpecial] = useState('');
  const [flight, setFlight] = useState('');
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ride, setRide] = useState<RideView | null>(null);
  const [trackingPath, setTrackingPath] = useState<string | null>(null);
  const idempotencyKey = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);

  const search = useCallback((input: string, sessionToken: string) => publicApi.public.autocomplete(input, sessionToken), []);
  const details = useCallback((placeId: string, sessionToken: string) => publicApi.public.placeDetails(placeId, sessionToken), []);
  const requestedAt = () => montrealToIso(date, time);
  const request = (): QuoteRequest => ({ origin: origin!, destination: destination!, stops: [], requestedAt: requestedAt(), options: OPTIONS });
  const paymentMethods = payAfterMethods(quotes?.paymentMethods);
  const paymentMethod = chosenMethod && paymentMethods.includes(chosenMethod) ? chosenMethod : (paymentMethods[0] ?? null);

  const fail = (e: unknown) => {
    const code = errorCode(e);
    setError(code === 'LEAD_TIME_TOO_SHORT' ? t('book.errors.lead') : code === 'RATE_LIMITED' ? t('book.errors.rateLimited') : e instanceof Error && e.message ? e.message : t('book.errors.generic'));
  };

  async function getPrices() {
    setError(null);
    if (!origin || !destination) return setError(t('book.errors.address'));
    if (new Date(requestedAt()).getTime() < Date.now() + minLeadMs) return setError(t('book.errors.lead'));
    setBusy(true);
    try {
      const res = await publicApi.public.quotes(request());
      if (!res.quotes.length) return setError(t('book.errors.quote'));
      setQuotes(res);
      setQuote(res.quotes[0]!);
      setStep('price');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!quote || !quotes || !paymentMethod) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (firstName.trim()) await guest.api.me.update({ firstName: firstName.trim(), ...(lastName.trim() ? { lastName: lastName.trim() } : {}) }).catch(() => undefined);
      // Le devis affiché venait de l'API publique (sans compte) : le prix est recalculé avec le compte, mêmes règles.
      const own = await guest.api.quotes.create({ ...request(), category: quote.category });
      const priced = own.quotes.find((q) => q.category === quote.category);
      if (!priced) return setError(t('book.errors.quote'));
      if (priced.totalCents !== quote.totalCents) setNotice(t('book.requoted', { amount: formatMoney(priced.totalCents, lang) }));
      // Modes relus avec le compte : un mode retiré depuis le premier devis n'est pas envoyé, la liste est mise à jour.
      if (!payAfterMethods(own.paymentMethods).includes(paymentMethod)) {
        setQuotes({ ...quotes, paymentMethods: own.paymentMethods });
        return setError(t('book.errors.payment'));
      }
      const flightNumber = flight.trim().toUpperCase().replace(/\s/g, '');
      const created = await guest.api.rides.create(
        {
          quoteId: priced.id, type: 'scheduled', requestedAt: requestedAt(), paymentMethod, paymentChoice: 'pay_driver_after', maxConsentedCents: priced.maxConsentedCents,
          preferences: PREFERENCES, ...(special.trim() ? { specialRequests: special.trim() } : {}), ...(flightNumber ? { flightNumber } : {}),
        },
        idempotencyKey.current,
      );
      setRide(created);
      const share = await guest.api.rides.share(created.id).catch(() => null);
      setTrackingPath(share ? `/suivi/${share.token}` : null);
      setStep('done');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const steps: Step[] = ['trip', 'price', 'contact', 'done'];
  const stepLabel = { trip: t('book.steps.trip'), price: t('book.steps.price'), contact: t('book.steps.contact'), done: t('book.steps.confirm') };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-3xl text-brand-night">{t('book.title')}</h1>
        <p className="mt-1 text-slate-700">{t('book.subtitle')}</p>
      </div>
      <ol className="flex flex-wrap gap-2 text-xs font-semibold" aria-label={t('book.title')}>
        {steps.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={cx('rounded-full px-3 py-1', s === step ? 'bg-brand-night text-white' : steps.indexOf(step) > i ? 'bg-green-100 text-green-900' : 'bg-white text-slate-700')}>
            {i + 1}. {stepLabel[s]}
          </li>
        ))}
      </ol>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="warning">{notice}</Notice> : null}

      {step === 'trip' || step === 'price' ? (
        <Card>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void getPrices(); }}>
            <AddressField name="origin" label={t('book.origin')} hint={t('book.addressHint')} value={origin} onChange={(p) => { setOrigin(p); setStep('trip'); }} search={search} details={details} />
            <AddressField name="destination" label={t('book.destination')} hint={t('book.addressHint')} value={destination} onChange={(p) => { setDestination(p); setStep('trip'); }} search={search} details={details} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('book.date')} hint={t('book.minLead', { date: formatDateTime(earliest.toISOString(), lang) })}>{(p) => <Input {...p} type="date" required min={initial.date} value={date} onChange={(e) => { setDate(e.target.value); setStep('trip'); }} />}</Field>
              <Field label={t('book.time')}>{(p) => <Input {...p} type="time" required step={300} value={time} onChange={(e) => { setTime(e.target.value); setStep('trip'); }} />}</Field>
            </div>
            {step === 'trip' ? <div><Action type="submit" busy={busy} disabled={busy || !origin || !destination}>{busy ? t('book.quoting') : t('book.getPrice')}</Action></div> : null}
          </form>
        </Card>
      ) : null}

      {step === 'price' && quotes ? (
        <Card>
          <QuoteList quotes={quotes.quotes} selected={quote?.id ?? null} onSelect={setQuote} language={lang} name="category" />
          <p className="mt-2 text-xs text-slate-600">{t('book.validity')}</p>
          <div className="mt-3"><Action onClick={() => setStep('contact')} disabled={!quote}>{t('book.choose')}</Action></div>
        </Card>
      ) : null}

      {step === 'contact' && quote ? (
        <Card title={t('book.contactTitle')}>
          <div className="flex flex-col gap-3">
            <p className="text-sm">{t(`enum.category.${quote.category}`)} · {formatDateTime(requestedAt(), lang)} · <strong>{formatMoney(quote.totalCents, lang)}</strong></p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('book.firstName')}>{(p) => <Input {...p} autoComplete="given-name" maxLength={80} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
              <Field label={t('book.lastName')}>{(p) => <Input {...p} autoComplete="family-name" maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
            </div>
            {!signedIn ? (
              <OtpSignIn guest={guest} onSignedIn={() => setSignedIn(true)} {...(config.data ? { terms: { termsUrl: config.data.legal.termsUrl, privacyUrl: config.data.legal.privacyUrl, version: config.data.legal.privacyPolicyVersion } } : {})} />
            ) : (
              <>
                <Notice tone="success">{t('book.verified')}</Notice>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-semibold">{t('book.payment')}</legend>
                  {paymentMethods.length === 0 ? <Notice tone="warning">{t('book.noPaymentMethod')}</Notice> : (
                    <>
                      <p className="text-sm">{t('book.payDriver')}</p>
                      {paymentMethods.map((m) => (
                        <label key={m} className="flex items-center gap-2 text-sm">
                          <input type="radio" name="payment" value={m} checked={paymentMethod === m} onChange={() => setChosenMethod(m)} className="accent-brand-blue-dark" />
                          {t(`enum.paymentMethod.${m}`)}
                        </label>
                      ))}
                    </>
                  )}
                </fieldset>
                <Field label={t('book.specialRequests')}>{(p) => <Textarea {...p} maxLength={500} value={special} onChange={(e) => setSpecial(e.target.value)} />}</Field>
                <Field label={t('book.flight')}>{(p) => <Input {...p} maxLength={8} value={flight} onChange={(e) => setFlight(e.target.value)} />}</Field>
                <div><Action onClick={() => void confirm()} busy={busy} disabled={busy || !paymentMethod}>{busy ? t('book.confirming') : t('book.confirm')}</Action></div>
              </>
            )}
          </div>
        </Card>
      ) : null}

      {step === 'done' && ride ? (
        <Card>
          <div className="flex flex-col gap-3" role="status">
            <h2 className="text-2xl text-brand-night">{t('book.confirmedTitle')}</h2>
            <p>{t('book.confirmedBody', { date: formatDateTime(ride.requestedAt, lang) })}</p>
            <p className="text-lg font-bold">{formatMoney(ride.quote.totalCents, lang)}</p>
            <div className="flex flex-wrap gap-2">
              {trackingPath ? <Action onClick={() => window.open(trackingPath, '_blank', 'noopener')}>{t('book.track')}</Action> : null}
              <Action tone="secondary" onClick={() => window.location.reload()}>{t('book.again')}</Action>
            </div>
            {trackingPath ? <p className="break-all text-xs text-slate-600" data-testid="tracking-link">{trackingPath}</p> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
