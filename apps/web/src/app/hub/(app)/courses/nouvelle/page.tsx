'use client';

import type { AdminClient, Place, QuoteView, QuotesResponse } from '@neomoov/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/address-field';
import { useCanWrite, useDebounced, useErrorText, useLang } from '@/components/hub/common';
import { QuoteList } from '@/components/quote-list';
import { Action, Card, Field, Input, Notice, PageTitle, Select, Textarea } from '@/components/ui/kit';
import { montrealToIso } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import { toE164 } from '@/lib/site-api';

const OPTIONS = { flex: false, priority: false, childSeat: false, luggage: false };

/** Heure proposée par défaut : dans 2 h 30, arrondie aux 5 minutes, à l'heure de Montréal. */
function defaultPickup(): { date: string; time: string } {
  const at = new Date(Date.now() + 150 * 60_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Création d'une course par téléphone : devis au prix garanti, client existant ou fiche minimale, paiement au chauffeur. */
export default function NewRidePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const initial = useMemo(defaultPickup, []);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [quotes, setQuotes] = useState<QuotesResponse | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [mode, setMode] = useState<'guest' | 'existing'>('guest');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestLanguage, setGuestLanguage] = useState<'fr' | 'en'>('fr');
  const [clientQuery, setClientQuery] = useState('');
  const [clientUserId, setClientUserId] = useState('');
  const [method, setMethod] = useState<'cash' | 'terminal'>('cash');
  const [special, setSpecial] = useState('');
  const [flight, setFlight] = useState('');

  const search = useCallback((input: string, sessionToken: string) => hubApi.places.autocomplete(input, { sessionToken }), []);
  const details = useCallback((placeId: string, sessionToken: string) => hubApi.places.details(placeId, sessionToken), []);
  const clientSearch = useDebounced(clientQuery.trim());
  const clients = useQuery({ queryKey: ['hub', 'clients-pick', clientSearch], queryFn: () => hubApi.admin.clients({ pageSize: 20, ...(clientSearch ? { q: clientSearch } : {}) }), enabled: mode === 'existing' });

  const quoting = useMutation({
    mutationFn: () => hubApi.quotes.create({ origin: origin!, destination: destination!, stops: [], requestedAt: montrealToIso(date, time), options: OPTIONS }),
    onSuccess: (res) => {
      setQuotes(res);
      setQuote(res.quotes[0] ?? null);
    },
  });

  const creating = useMutation({
    mutationFn: () => {
      const phone = toE164(guestPhone);
      return hubApi.admin.createRide({
        quoteId: quote!.id,
        ...(mode === 'guest' ? { guest: { name: guestName.trim(), phone: phone ?? guestPhone, language: guestLanguage } } : { clientUserId }),
        paymentMethod: method,
        paymentChoice: 'pay_driver_after',
        ...(special.trim() ? { specialRequests: special.trim() } : {}),
        ...(flight.trim() ? { flightNumber: flight.trim().toUpperCase().replace(/\s/g, '') } : {}),
      });
    },
    onSuccess: (ride) => router.push(`/hub/courses/${ride.id}`),
  });

  if (!writable) return <Notice tone="warning">{t('hub.common.forbidden')}</Notice>;
  const clientReady = mode === 'guest' ? guestName.trim().length >= 2 && toE164(guestPhone) !== null : Boolean(clientUserId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageTitle title={t('hub.newRide.title')} subtitle={t('hub.newRide.subtitle')} />
      <Card title={t('book.steps.trip')}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (origin && destination) quoting.mutate(); }}>
          <AddressField name="origin" label={t('hub.newRide.origin')} hint={t('hub.newRide.addressHint')} value={origin} onChange={(p) => { setOrigin(p); setQuotes(null); }} search={search} details={details} />
          <AddressField name="destination" label={t('hub.newRide.destination')} hint={t('hub.newRide.addressHint')} value={destination} onChange={(p) => { setDestination(p); setQuotes(null); }} search={search} details={details} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('book.date')}>{(p) => <Input {...p} type="date" required value={date} onChange={(e) => { setDate(e.target.value); setQuotes(null); }} />}</Field>
            <Field label={t('book.time')}>{(p) => <Input {...p} type="time" required step={300} value={time} onChange={(e) => { setTime(e.target.value); setQuotes(null); }} />}</Field>
          </div>
          {quoting.isError ? <Notice tone="danger">{errorText(quoting.error)}</Notice> : null}
          <div><Action type="submit" busy={quoting.isPending} disabled={!origin || !destination || quoting.isPending}>{quoting.isPending ? t('hub.newRide.quoting') : t('hub.newRide.quote')}</Action></div>
        </form>
      </Card>

      {quotes ? (
        <Card title={t('hub.newRide.pickCategory')}>
          <QuoteList quotes={quotes.quotes} selected={quote?.id ?? null} onSelect={setQuote} language={lang} name="category" />
        </Card>
      ) : null}

      {quote ? (
        <Card title={t('hub.newRide.client')}>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (clientReady) creating.mutate(); }}>
            <fieldset className="flex gap-4">
              <legend className="sr-only">{t('hub.newRide.client')}</legend>
              {(['guest', 'existing'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="client-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-brand-blue-dark" />
                  {t(`hub.newRide.${m}`)}
                </label>
              ))}
            </fieldset>
            {mode === 'guest' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('hub.newRide.guestName')}>{(p) => <Input {...p} required minLength={2} maxLength={120} autoComplete="off" value={guestName} onChange={(e) => setGuestName(e.target.value)} />}</Field>
                <Field label={t('hub.newRide.guestPhone')} error={guestPhone && !toE164(guestPhone) ? t('book.errors.phone') : null}>{(p) => <Input {...p} type="tel" required value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />}</Field>
                <Field label={t('hub.newRide.language')}>
                  {(p) => (
                    <Select {...p} value={guestLanguage} onChange={(e) => setGuestLanguage(e.target.value as 'fr' | 'en')}>
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                    </Select>
                  )}
                </Field>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('hub.common.search')}>{(p) => <Input {...p} type="search" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />}</Field>
                <Field label={t('hub.newRide.existing')}>
                  {(p) => (
                    <Select {...p} required value={clientUserId} onChange={(e) => setClientUserId(e.target.value)}>
                      <option value="">…</option>
                      {(clients.data?.items ?? []).map((c: AdminClient) => <option key={c.userId} value={c.userId}>{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone} · {c.phone}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <Field label={t('hub.newRide.payment')}>
              {(p) => (
                <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'terminal')}>
                  <option value="cash">{t('enum.paymentMethod.cash')}</option>
                  <option value="terminal">{t('enum.paymentMethod.terminal')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('hub.newRide.specialRequests')}>{(p) => <Textarea {...p} maxLength={500} value={special} onChange={(e) => setSpecial(e.target.value)} />}</Field>
            <Field label={t('hub.newRide.flightNumber')}>{(p) => <Input {...p} maxLength={8} value={flight} onChange={(e) => setFlight(e.target.value)} />}</Field>
            {creating.isError ? <Notice tone="danger">{errorText(creating.error)}</Notice> : null}
            <div><Action type="submit" busy={creating.isPending} disabled={!clientReady || creating.isPending}>{t('hub.newRide.create')}</Action></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
