'use client';

/**
 * Saisie d'une course par téléphone ou au comptoir, partagée par la plateforme (`/hub/courses/nouvelle`) et par
 * l'espace organisation (`/hub/organisation/courses/nouvelle`, étape 23) : devis au prix garanti, client existant (plateforme
 * seulement) ou fiche minimale, paiement au chauffeur. Les règles (préavis, catégories, animal) sont celles de l'API.
 */
import type { AdminClient, AdminCreateRide, Place, QuoteRequest, QuoteView, QuotesResponse, RideView } from '@neomoov/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/address-field';
import { useDebounced, useErrorText, useLang } from '@/components/hub/common';
import { QuoteList } from '@/components/quote-list';
import { Action, Card, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui/kit';
import { montrealToIso } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import { toE164 } from '@/lib/site-api';

const OPTIONS = { flex: false, priority: false, childSeat: false, luggage: false, pet: false };

/** Heure proposée par défaut : dans 2 h 30, arrondie aux 5 minutes, à l'heure de Montréal. */
export function defaultPickup(now = Date.now()): { date: string; time: string } {
  const at = new Date(now + 150 * 60_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export interface NewRideApi {
  quote: (body: QuoteRequest) => Promise<QuotesResponse>;
  create: (body: AdminCreateRide) => Promise<RideView>;
  /** Recherche des comptes clients (plateforme seulement) ; absente : fiche minimale seulement. */
  searchClients?: (q: string) => Promise<AdminClient[]>;
}

export function NewRideForm({ api, scope, onCreated }: { api: NewRideApi; scope: string; onCreated: (ride: RideView) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const initial = useMemo(() => defaultPickup(), []);
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
  // Animal de compagnie en cage (D8) : seules Neo XL et Neo Prestige sont alors tarifées.
  const [pet, setPet] = useState(false);
  const searchClients = api.searchClients;

  const search = useCallback((input: string, sessionToken: string) => hubApi.places.autocomplete(input, { sessionToken }), []);
  const details = useCallback((placeId: string, sessionToken: string) => hubApi.places.details(placeId, sessionToken), []);
  const clientSearch = useDebounced(clientQuery.trim());
  const clients = useQuery({ queryKey: ['hub', scope, 'clients-pick', clientSearch], queryFn: () => searchClients!(clientSearch), enabled: mode === 'existing' && Boolean(searchClients) });

  const quoting = useMutation({
    mutationFn: () => api.quote({ origin: origin!, destination: destination!, stops: [], requestedAt: montrealToIso(date, time), options: { ...OPTIONS, pet } }),
    onSuccess: (res) => {
      setQuotes(res);
      setQuote(res.quotes[0] ?? null);
    },
  });

  const creating = useMutation({
    mutationFn: () => {
      const phone = toE164(guestPhone);
      return api.create({
        quoteId: quote!.id,
        ...(mode === 'guest' ? { guest: { name: guestName.trim(), phone: phone ?? guestPhone, language: guestLanguage } } : { clientUserId }),
        paymentMethod: method,
        paymentChoice: 'pay_driver_after',
        ...(special.trim() ? { specialRequests: special.trim() } : {}),
        ...(flight.trim() ? { flightNumber: flight.trim().toUpperCase().replace(/\s/g, '') } : {}),
      });
    },
    onSuccess: onCreated,
  });

  const clientReady = mode === 'guest' ? guestName.trim().length >= 2 && toE164(guestPhone) !== null : Boolean(clientUserId);

  return (
    <>
      <Card title={t('book.steps.trip')}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (origin && destination) quoting.mutate(); }}>
          <AddressField name="origin" label={t('hub.newRide.origin')} hint={t('hub.newRide.addressHint')} value={origin} onChange={(p) => { setOrigin(p); setQuotes(null); }} search={search} details={details} />
          <AddressField name="destination" label={t('hub.newRide.destination')} hint={t('hub.newRide.addressHint')} value={destination} onChange={(p) => { setDestination(p); setQuotes(null); }} search={search} details={details} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('book.date')}>{(p) => <Input {...p} type="date" required value={date} onChange={(e) => { setDate(e.target.value); setQuotes(null); }} />}</Field>
            <Field label={t('book.time')}>{(p) => <Input {...p} type="time" required step={300} value={time} onChange={(e) => { setTime(e.target.value); setQuotes(null); }} />}</Field>
          </div>
          <Checkbox label={t('book.pet')} checked={pet} onChange={(e) => { setPet(e.target.checked); setQuotes(null); }} />
          {pet ? <p className="text-xs text-slate-600">{t('book.petHint')}</p> : null}
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
            {searchClients ? (
              <fieldset className="flex gap-4">
                <legend className="sr-only">{t('hub.newRide.client')}</legend>
                {(['guest', 'existing'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="client-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-brand-blue-dark" />
                    {t(`hub.newRide.${m}`)}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {mode === 'guest' || !searchClients ? (
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
                      {(clients.data ?? []).map((c) => <option key={c.userId} value={c.userId}>{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone} · {c.phone}</option>)}
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
    </>
  );
}
