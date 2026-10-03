import type { PaymentChoice, RidePreferences } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Choices, ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { amountDueFor, effectivePaymentChoice, paymentOptions, quoteExpired, quoteFitsChoice, quoteRequestOf, samePrice } from '@/features/booking/logic';
import { useBooking } from '@/features/booking/store';
import { api, errorCode, errorMessage } from '@/lib/api';
import { serverNow } from '@/lib/clock';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { displayPhone, toE164 } from '@/lib/phone';
import { keys, queryClient, useAppConfig, usePreferences } from '@/lib/queries';

const DEFAULT_PREFERENCES: RidePreferences = { conversation: 'indifferent', music: 'indifferent', temperature: 'neutral', luggageHelp: false };

/**
 * Erreurs qui appellent un nouveau devis : prix expiré, paiement par carte fermé depuis le devis (modes relus), ou crédits
 * réservés par une autre course entre le devis et la confirmation (revue du 2 octobre 2026, constat 3).
 */
const REQUOTE_CODES = new Set(['QUOTE_EXPIRED', 'CARD_PAYMENTS_UNAVAILABLE', 'CREDITS_INSUFFICIENT']);

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
  const [needsCard, setNeedsCard] = useState(false);
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
  // Montant à payer dans le mode choisi : payée au chauffeur, le total (les crédits ne valent qu'en prépaiement).
  const amountDue = amountDueFor(quote, paymentChoice);
  const passengerPhone = draft.forSomeoneElse ? toE164(draft.passengerPhone) : null;
  const passenger = draft.forSomeoneElse && passengerPhone && draft.passengerName.trim().length >= 2 ? { name: draft.passengerName.trim(), phone: passengerPhone } : null;
  const passengerIncomplete = draft.forSomeoneElse && !passenger;

  async function book() {
    if (!quote || !draft.origin || !draft.destination || !draft.pickupAt || !paymentChoice || !paymentMethod) return;
    const route = { origin: draft.origin, destination: draft.destination, stops: draft.stops, pickupAt: draft.pickupAt, options: draft.options };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Devis expiré ou sur le point de l'être (revue du 2 octobre 2026, constat mobile 4) : nouveau devis d'abord. Même
      // prix : la réservation part avec lui ; prix changé : il est montré au client, qui confirme de nouveau. La clé
      // d'idempotence est gardée : si une tentative précédente a créé la course, l'API la renvoie au lieu d'en créer une autre.
      // Même chemin quand le devis ne convient pas au mode de paiement choisi (revue du 2 octobre 2026, constat 2) : payée au
      // chauffeur, la course part d'un devis demandé avec `paymentChoice` (aucun crédit déduit, montant affiché inchangé).
      let priced = quote;
      if (quoteExpired(quote, serverNow()) || !quoteFitsChoice(quote, draft.quotedPaymentChoice, paymentChoice)) {
        const fresh = await api.quotes.create(quoteRequestOf(route, paymentChoice));
        const next = fresh.quotes.find((q) => q.category === quote.category);
        draft.update({ quotes: fresh, quotedPaymentChoice: paymentChoice });
        if (!next || !samePrice(quote, next, paymentChoice)) {
          setNotice(t('confirm.requoted'));
          return;
        }
        priced = next;
      }
      const flight = draft.flightNumber.trim().toUpperCase();
      const ride = await api.rides.create(
        {
          quoteId: priced.id,
          type: 'scheduled',
          requestedAt: draft.pickupAt,
          paymentChoice,
          paymentMethod,
          maxConsentedCents: priced.maxConsentedCents,
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
      if (REQUOTE_CODES.has(errorCode(e) ?? '')) {
        // Prix expiré ou carte fermée : nouveau devis, même catégorie ; le client revoit le prix et les modes de paiement
        // avant de confirmer.
        // Le mode de paiement choisi accompagne le nouveau devis : payée au chauffeur, la course ne déduit aucun crédit.
        // Même demande que l'écran des catégories (chauffeur favori compris).
        const quotes = await api.quotes.create(quoteRequestOf(route, paymentChoice)).catch(() => null);
        if (quotes) {
          draft.update({ quotes, quotedPaymentChoice: paymentChoice });
          draft.renewKey();
          setNotice(errorMessage(e));
        } else setError(errorMessage(e));
      } else {
        setError(errorMessage(e));
        // Étape 26 : prépaiement sans carte enregistrée, accès direct à l'ajout d'une carte.
        setNeedsCard(errorCode(e) === 'PAYMENT_METHOD_REQUIRED');
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
      <ToggleRow label={t('confirm.assistanceAnimal')} hint={t('confirm.assistanceAnimalHint')} value={preferences.assistanceAnimal ?? false} onChange={(assistanceAnimal) => setPreference({ assistanceAnimal })} testID="assistance-animal" />
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
          {paymentChoice === 'pay_driver_after' && quote.creditsAppliedCents > 0 ? <Notice tone="info">{t('confirm.creditsNotApplied', { amount: formatMoney(quote.totalCents, language) })}</Notice> : null}
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
        {amountDue !== quote.totalCents ? (
          <>
            <Row label={t('confirm.creditsApplied')} value={formatMoney(amountDue - quote.totalCents, language)} />
            <Row label={t('confirm.amountDue')} value={formatMoney(amountDue, language)} strong />
          </>
        ) : null}
        <Body muted>{t('confirm.maxConsented', { amount: formatMoney(quote.maxConsentedCents, language) })}</Body>
      </Card>
      {passengerIncomplete ? <Notice tone="warning">{t('category.passengerIncomplete')}</Notice> : null}
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
      {error && needsCard ? <Button label={t('confirm.addCard')} variant="ghost" onPress={() => router.push('/payment-methods')} testID="confirm-add-card" /> : null}
    </Screen>
  );
}
