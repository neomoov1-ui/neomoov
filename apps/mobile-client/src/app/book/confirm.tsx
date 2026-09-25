import type { PaymentChoice, PaymentMethod, RidePreferences } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Choices, ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { useBooking } from '@/features/booking/store';
import { api, errorCode, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useAppConfig, usePreferences } from '@/lib/queries';

const DEFAULT_PREFERENCES: RidePreferences = { conversation: 'indifferent', music: 'indifferent', temperature: 'neutral', luggageHelp: false };

/** Modes proposés (D35) : prépaiement selon la plateforme, ou paiement au chauffeur (espèces, terminal). */
function methodsFor(choice: PaymentChoice): PaymentMethod[] {
  if (choice === 'pay_driver_after') return ['cash', 'terminal'];
  return ['card_app', ...(Platform.OS === 'ios' ? (['apple_pay'] as const) : Platform.OS === 'android' ? (['google_pay'] as const) : []), 'interac'];
}

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
  const methods = methodsFor(draft.paymentChoice).filter((m) => draft.paymentChoice !== 'pay_driver_after' || !vehicle || vehicle.paymentMethods.includes(m));
  const category = config.data?.categories.find((c) => c.code === quote.category);

  async function book() {
    if (!quote || !draft.pickupAt) return;
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
          paymentChoice: draft.paymentChoice,
          paymentMethod: methods.includes(draft.paymentMethod) ? draft.paymentMethod : methods[0]!,
          maxConsentedCents: quote.maxConsentedCents,
          preferences,
          ...(flight ? { flightNumber: flight } : {}),
          ...(draft.specialRequests.trim() ? { specialRequests: draft.specialRequests.trim() } : {}),
          ...(draft.vehicleId ? { vehicleId: draft.vehicleId } : {}),
        },
        draft.idempotencyKey,
      );
      draft.reset();
      await queryClient.invalidateQueries({ queryKey: keys.rides });
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
    } catch (e) {
      if (errorCode(e) === 'QUOTE_EXPIRED' && draft.origin && draft.destination) {
        // Prix expiré : nouveau devis, même catégorie ; le client revoit le prix avant de confirmer.
        const quotes = await api.quotes.create({ origin: draft.origin, destination: draft.destination, stops: [], requestedAt: draft.pickupAt, options: { flex: draft.options.flex, priority: draft.options.priority, childSeat: draft.options.childSeat, luggage: draft.options.luggage } }).catch(() => null);
        if (quotes) {
          draft.update({ quotes });
          draft.renewKey();
          setNotice(t('errors.codes.QUOTE_EXPIRED'));
        } else setError(errorMessage(e));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back subtitle={t('book.step', { step: 3 })} title={t('confirm.title')} footer={<Button label={busy ? t('confirm.booking') : t('confirm.book')} onPress={() => void book()} disabled={busy} />}>
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
      <Choices
        value={draft.paymentChoice}
        onChange={(paymentChoice) => draft.update({ paymentChoice, paymentMethod: methodsFor(paymentChoice)[0]! })}
        options={[{ value: 'prepaid' as PaymentChoice, label: t('confirm.prepaid') }, { value: 'pay_driver_after' as PaymentChoice, label: t('confirm.payAfter') }]}
      />
      <Choices value={methods.includes(draft.paymentMethod) ? draft.paymentMethod : (methods[0] ?? null)} onChange={(paymentMethod) => draft.update({ paymentMethod })} options={methods.map((m) => ({ value: m, label: t(`confirm.methods.${m}`) }))} />
      {draft.paymentChoice === 'prepaid' ? <Notice tone="warning">{t('confirm.prepaidBeta')}</Notice> : null}

      <SectionTitle>{t('confirm.summary')}</SectionTitle>
      <Card>
        <Row label={t('confirm.pickup')} value={formatDateTime(draft.pickupAt, language)} />
        <Row label={t('confirm.route')} value={`${draft.origin.address} → ${draft.destination.address}`} />
        <Row label={t('confirm.category')} value={category?.name ?? quote.category} />
        {vehicle ? <Row label={t('confirm.vehicle')} value={`${vehicle.make} ${vehicle.model} ${vehicle.colour}`} /> : null}
        <Row label={t('confirm.price')} value={formatMoney(quote.totalCents, language)} strong />
        <Body muted>{t('confirm.maxConsented', { amount: formatMoney(quote.maxConsentedCents, language) })}</Body>
      </Card>
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
