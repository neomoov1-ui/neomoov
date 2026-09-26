import type { PaymentChoice, RidePreferences } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Choices, ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { effectivePaymentChoice, paymentOptions } from '@/features/booking/logic';
import { useBooking } from '@/features/booking/store';
import { api, errorCode, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { displayPhone, toE164 } from '@/lib/phone';
import { keys, queryClient, useAppConfig, usePreferences } from '@/lib/queries';

const DEFAULT_PREFERENCES: RidePreferences = { conversation: 'indifferent', music: 'indifferent', temperature: 'neutral', luggageHelp: false };

/** Erreurs qui appellent un nouveau devis : prix expiré, ou paiement par carte fermé depuis le devis (modes relus). */
const REQUOTE_CODES = new Set(['QUOTE_EXPIRED', 'CARD_PAYMENTS_UNAVAILABLE']);

/**
 * Réservation, écran 3 sur 3 : commodités et demandes spéciales (message D45, préférences pré-remplies depuis le profil),
 * mode de paiement, récapitulatif, confirmation. La demande porte une clé d'idempotence : une nouvelle tentative après
 * une coupure réseau ne crée pas de seconde course.
 */
export default function ConfirmScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const config = useAppConfig();
  const saved = usePreferences();
  const draft = useBooking();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const quote = draft.quotes?.quotes.find((q) => q.category === draft.category) ?? null;
  const vehicles = useQuery({ queryKey: keys.vehicles(quote?.id ?? ''), queryFn: () => api.quotes.vehicles(quote!.id), enabled: Boolean(quote?.id && draft.vehicleId) });
  const vehicle = vehicles.data?.find((v) => v.vehicleId === draft.vehicleId) ?? null;

  useEffect(() => {
    if (!draft.preferences && saved.data) draft.update({ preferences: saved.data });
  }, [saved.data, draft]);

  if (!draft.quotes || !quote || !draft.origin || !draft.destination || !draft.pickupAt) return <Redirect href="/book" />;
  const preferences = draft.preferences ?? saved.data ?? DEFAULT_PREFERENCES;
  const setPreference = (patch: Partial<RidePreferences>) => draft.update({ preferences: { ...preferences, ...patch } });
  // Modes du devis (API) seulement : carte retirée quand le paiement réel n'est pas branché, paiement au chauffeur
  // limité à ce qu'acceptent les chauffeurs (ou celui du véhicule choisi).
  const payment = paymentOptions(draft.quotes.paymentMethods, Platform.OS, vehicle?.paymentMethods ?? null);
  const paymentChoice = effectivePaymentChoice(payment, draft.paymentChoice);
  const methods = paymentChoice === 'prepaid' ? payment.prepaid : paymentChoice === 'pay_driver_after' ? payment.payAfter : [];
  const paymentMethod = methods.includes(draft.paymentMethod) ? draft.paymentMethod : (methods[0] ?? null);
  const choiceOptions: Array<{ value: PaymentChoice; label: string }> = [
    ...(payment.prepaid.length > 0 ? [{ value: 'prepaid' as const, label: t('confirm.prepaid') }] : []),
    ...(payment.payAfter.length > 0 ? [{ value: 'pay_driver_after' as const, label: t('confirm.payAfter') }] : []),
  ];
  const category = config.data?.categories.find((c) => c.code === quote.category);
  const passengerPhone = draft.forSomeoneElse ? toE164(draft.passengerPhone) : null;
  const passenger = draft.forSomeoneElse && passengerPhone && draft.passengerName.trim().length >= 2 ? { name: draft.passengerName.trim(), phone: passengerPhone } : null;
  const passengerIncomplete = draft.forSomeoneElse && !passenger;

  async function book() {
    if (!quote || !draft.pickupAt || !paymentChoice || !paymentMethod) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const flight = draft.flightNumber.trim().toUpperCase();
      const ride = await api.rides.create(
        {
          quoteId: quote.id,
          type: 'scheduled',
          requestedAt: draft.pickupAt,
          paymentChoice,
          paymentMethod,
          maxConsentedCents: quote.maxConsentedCents,
          preferences,
          ...(flight ? { flightNumber: flight } : {}),
          ...(draft.specialRequests.trim() ? { specialRequests: draft.specialRequests.trim() } : {}),
          ...(draft.vehicleId ? { vehicleId: draft.vehicleId } : {}),
          ...(passenger ? { passenger } : {}),
        },
        draft.idempotencyKey,
      );
      draft.reset();
      await queryClient.invalidateQueries({ queryKey: keys.rides });
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
    } catch (e) {
      if (REQUOTE_CODES.has(errorCode(e) ?? '') && draft.origin && draft.destination) {
        // Prix expiré ou carte fermée : nouveau devis, même catégorie ; le client revoit le prix et les modes de paiement
        // avant de confirmer.
        const quotes = await api.quotes.create({ origin: draft.origin, destination: draft.destination, stops: draft.stops, requestedAt: draft.pickupAt, options: { flex: draft.options.flex, priority: draft.options.priority, childSeat: draft.options.childSeat, luggage: draft.options.luggage } }).catch(() => null);
        if (quotes) {
          draft.update({ quotes });
          draft.renewKey();
          setNotice(errorMessage(e));
        } else setError(errorMessage(e));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back subtitle={t('book.step', { step: 3 })} title={t('confirm.title')} footer={<Button label={busy ? t('confirm.booking') : t('confirm.book')} onPress={() => void book()} disabled={busy || passengerIncomplete || !paymentMethod} />}>
      <Body>{t('confirm.amenitiesMessage')}</Body>
      <Notice tone="success">{t('confirm.included')}</Notice>
      <Choices label={t('confirm.conversation')} value={preferences.conversation} onChange={(conversation) => setPreference({ conversation })} options={(['silence', 'chat', 'indifferent'] as const).map((v) => ({ value: v, label: t(`confirm.conversationValues.${v}`) }))} />
      <Choices label={t('confirm.music')} value={preferences.music} onChange={(music) => setPreference({ music })} options={(['none', 'soft', 'client_choice', 'indifferent'] as const).map((v) => ({ value: v, label: t(`confirm.musicValues.${v}`) }))} />
      {preferences.music === 'client_choice' ? <Field label={t('confirm.musicGenre')} value={preferences.musicGenre ?? ''} onChangeText={(musicGenre) => setPreference({ musicGenre })} maxLength={60} /> : null}
      <Choices label={t('confirm.temperature')} value={preferences.temperature} onChange={(temperature) => setPreference({ temperature })} options={(['cool', 'neutral', 'warm'] as const).map((v) => ({ value: v, label: t(`confirm.temperatureValues.${v}`) }))} />
      <Choices
        label={t('confirm.driverLanguage')}
        value={preferences.driverLanguage ?? 'any'}
        onChange={(v) => setPreference(v === 'any' ? { driverLanguage: undefined } : { driverLanguage: v })}
        options={(['fr', 'en', 'any'] as const).map((v) => ({ value: v, label: t(`confirm.languageValues.${v}`) }))}
      />
      <ToggleRow label={t('confirm.luggageHelp')} value={preferences.luggageHelp} onChange={(luggageHelp) => setPreference({ luggageHelp })} />
      <ToggleRow label={t('confirm.accessibility')} value={preferences.accessibility ?? false} onChange={(accessibility) => setPreference({ accessibility })} />
      <Field label={t('confirm.specialRequests')} hint={t('confirm.specialRequestsHint')} value={draft.specialRequests} onChangeText={(specialRequests) => draft.update({ specialRequests })} multiline maxLength={500} />

      <SectionTitle>{t('confirm.payment')}</SectionTitle>
      {paymentChoice === null ? (
        <Notice tone="warning">{t('confirm.noPaymentMethod')}</Notice>
      ) : (
        <>
          <Choices
            value={paymentChoice}
            onChange={(choice) => draft.update({ paymentChoice: choice, paymentMethod: (choice === 'prepaid' ? payment.prepaid : payment.payAfter)[0]! })}
            options={choiceOptions}
          />
          <Choices value={paymentMethod} onChange={(method) => draft.update({ paymentMethod: method })} options={methods.map((m) => ({ value: m, label: t(`confirm.methods.${m}`) }))} />
          {paymentChoice === 'prepaid' ? <Notice tone="warning">{t('confirm.prepaidBeta')}</Notice> : null}
        </>
      )}

      <SectionTitle>{t('confirm.summary')}</SectionTitle>
      <Card>
        <Row label={t('confirm.pickup')} value={formatDateTime(draft.pickupAt, language)} />
        <Row label={t('confirm.route')} value={[draft.origin.address, ...draft.stops.map((s) => s.address), draft.destination.address].join(' → ')} />
        {passenger ? <Row label={t('confirm.passenger')} value={`${passenger.name} · ${displayPhone(passenger.phone)}`} /> : null}
        <Row label={t('confirm.category')} value={category?.name ?? quote.category} />
        {vehicle ? <Row label={t('confirm.vehicle')} value={`${vehicle.make} ${vehicle.model} ${vehicle.colour}`} /> : null}
        <Row label={t('confirm.price')} value={formatMoney(quote.totalCents, language)} strong />
        <Body muted>{t('confirm.maxConsented', { amount: formatMoney(quote.maxConsentedCents, language) })}</Body>
      </Card>
      {passengerIncomplete ? <Notice tone="warning">{t('category.passengerIncomplete')}</Notice> : null}
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
