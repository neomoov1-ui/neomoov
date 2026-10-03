'use client';

/**
 * Réservation web sans compte (`/reserver`, intégrable en iframe) : trajet et heure (préavis minimal de la
 * configuration), prix garanti par catégorie (API publique), vérification du numéro par SMS (compte créé au besoin),
 * prix confirmé avec le compte, paiement au chauffeur (modes renvoyés par le devis), confirmation et lien de suivi.
 * Finalisation (3 octobre 2026) : animal d'assistance (préférence transmise au chauffeur), code promo (vérifié par l'API
 * avec le devis) et code de parrainage (enregistré sur le compte avant la première course), prérenseignés par l'adresse.
 */
import type { AppConfig, PaymentMethod, Place, QuoteRequest, QuoteView, QuotesResponse, RidePreferences, RideView } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/address-field';
import { useWebBrand } from '@/components/brand-context';
import { OtpSignIn } from '@/components/otp-sign-in';
import { QuoteList } from '@/components/quote-list';
import { Action, Card, Checkbox, Field, Input, Notice, Textarea, cx, focus } from '@/components/ui/kit';
import { formatDateTime, formatMoney, montrealToIso } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { codesFromSearch, normalizePromoCode, normalizeReferralCode, promoOutcome, referralErrorKey } from '@/lib/booking-codes';
import { createGuestApi, errorCode, publicApi } from '@/lib/site-api';

const OPTIONS = { flex: false, priority: false, childSeat: false, luggage: false, pet: false };
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
  // Conditions et politique de la marque de l'hôte (étape 22) ; la version de la politique reste celle de la configuration.
  const brand = useWebBrand();
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
  // Animal de compagnie en cage (D8) : seules les catégories qui l'acceptent sont tarifées.
  const [pet, setPet] = useState(false);
  // Animal d'assistance : jamais un motif de refus ni un supplément ; seulement une information pour le chauffeur.
  const [assistanceAnimal, setAssistanceAnimal] = useState(false);
  const [promo, setPromo] = useState('');
  const [referral, setReferral] = useState('');
  // Code de parrainage déjà enregistré sur ce compte (une nouvelle tentative de confirmation ne le renvoie pas).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ride, setRide] = useState<RideView | null>(null);
  const [trackingPath, setTrackingPath] = useState<string | null>(null);
  const idempotencyKey = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);

  // Codes passés par l'adresse (lien de parrainage, campagne) : prérenseignés, modifiables.
  useEffect(() => {
    const codes = codesFromSearch(window.location.search);
    if (codes.promo) setPromo(codes.promo);
    if (codes.referral) setReferral(codes.referral);
  }, []);
  const promoCode = normalizePromoCode(promo);

  const search = useCallback((input: string, sessionToken: string) => publicApi.public.autocomplete(input, sessionToken), []);
  const details = useCallback((placeId: string, sessionToken: string) => publicApi.public.placeDetails(placeId, sessionToken), []);
  const requestedAt = () => montrealToIso(date, time);
  const request = (): QuoteRequest => ({ origin: origin!, destination: destination!, stops: [], requestedAt: requestedAt(), options: { ...OPTIONS, pet, ...(promoCode ? { promoCode } : {}) } });
  const paymentMethods = payAfterMethods(quotes?.paymentMethods);
  const paymentMethod = chosenMethod && paymentMethods.includes(chosenMethod) ? chosenMethod : (paymentMethods[0] ?? null);

  const fail = (e: unknown) => {
    const code = errorCode(e);
    const referralKey = referralErrorKey(code);
    if (referralKey) return setError(t(referralKey));
    if (code === 'PROMO_CODE_UNKNOWN') return setError(t('book.errors.promoUnknown'));
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
      // Parrainage : enregistré avant la première course ; un code refusé arrête la confirmation (le message dit quoi faire).
      const referralCode = normalizeReferralCode(referral);
      if (referral.trim() && !referralCode) return setError(t('book.errors.referralUnknown'));
      if (referralCode && referralCode !== referralApplied) {
        await guest.api.me.applyReferral(referralCode);
        setReferralApplied(referralCode);
      }
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
          preferences: { ...PREFERENCES, ...(assistanceAnimal ? { assistanceAnimal: true } : {}) }, ...(special.trim() ? { specialRequests: special.trim() } : {}), ...(flightNumber ? { flightNumber } : {}),
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
            <Checkbox label={t('book.pet')} checked={pet} onChange={(e) => { setPet(e.target.checked); setStep('trip'); }} />
            {pet ? <p className="text-xs text-slate-600">{t('book.petHint')}</p> : null}
            <Checkbox label={t('book.assistanceAnimal')} checked={assistanceAnimal} onChange={(e) => setAssistanceAnimal(e.target.checked)} />
            {assistanceAnimal ? <p className="text-xs text-slate-600">{t('book.assistanceAnimalHint')}</p> : null}
            <Field label={t('book.promoCode')}>{(p) => <Input {...p} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={promo} onChange={(e) => { setPromo(e.target.value); setStep('trip'); }} />}</Field>
            {step === 'trip' ? <div><Action type="submit" busy={busy} disabled={busy || !origin || !destination}>{busy ? t('book.quoting') : t('book.getPrice')}</Action></div> : null}
          </form>
        </Card>
      ) : null}

      {step === 'price' && quotes ? (
        <Card>
          {/* Annonce au lecteur d'écran : les prix sont apparus sous le formulaire. */}
          <p role="status" className="sr-only">{t('book.pricesReady', { count: quotes.quotes.length })}</p>
          <QuoteList quotes={quotes.quotes} selected={quote?.id ?? null} onSelect={setQuote} language={lang} name="category" />
          <PromoNotice outcome={promoOutcome(quote, promoCode)} code={promoCode} language={lang} />
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
              <OtpSignIn guest={guest} onSignedIn={() => setSignedIn(true)} {...(config.data ? { terms: { termsUrl: brand.termsUrl, privacyUrl: brand.privacyUrl, version: config.data.legal.privacyPolicyVersion } } : {})} />
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
                          <input type="radio" name="payment" value={m} checked={paymentMethod === m} onChange={() => setChosenMethod(m)} className={cx('h-4 w-4 accent-brand-blue-dark', focus)} />
                          {t(`enum.paymentMethod.${m}`)}
                        </label>
                      ))}
                    </>
                  )}
                </fieldset>
                <Field label={t('book.referralCode')} hint={t('book.referralHint')}>{(p) => <Input {...p} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} value={referral} disabled={referralApplied !== null} onChange={(e) => setReferral(e.target.value)} />}</Field>
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

/** Effet du code promo sur la catégorie choisie, annoncé au lecteur d'écran (zone d'état). */
function PromoNotice({ outcome, code, language }: { outcome: ReturnType<typeof promoOutcome>; code: string; language: Language }) {
  const { t } = useTranslation();
  if (!outcome) return null;
  return (
    <div className="mt-2">
      {outcome.status === 'applied'
        ? <Notice tone="success">{t('book.promoApplied', { code, amount: formatMoney(outcome.discountCents, language) })}</Notice>
        : <Notice tone="warning">{t('book.promoNotApplied', { code })}</Notice>}
    </div>
  );
}
