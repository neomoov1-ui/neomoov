import { Button, Field } from '@neomoov/mobile-core/components';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/AddressField';
import { PickupPicker } from '@/components/PickupPicker';
import { RideMap } from '@/components/RideMap';
import { ErrorState, Loading, Notice, Screen } from '@/components/ui';
import { pickupProblem } from '@/features/booking/logic';
import { useBooking } from '@/features/booking/store';
import { api, errorMessage } from '@/lib/api';
import { useAppConfig, usePlaces } from '@/lib/queries';

const FLIGHT = /^[A-Z0-9]{2}\d{1,4}$/;

/**
 * Réservation, écran 1 sur 3 : départ (position ou adresse), destination (autocomplétion, lieux enregistrés), date et
 * heure au moins 2 heures après (D32), numéro de vol. « Voir les prix » demande les devis de toutes les catégories.
 */
export default function BookScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const places = usePlaces();
  const draft = useBooking();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const near = useMemo(() => draft.origin?.coordinates, [draft.origin?.coordinates]);

  if (config.isLoading) return <Loading />;
  if (!config.data) return <Screen title={t('book.title')}><ErrorState message={errorMessage(config.error)} onRetry={() => void config.refetch()} /></Screen>;
  const booking = config.data.booking;
  const flight = draft.flightNumber.trim().toUpperCase();
  const flightInvalid = flight.length > 0 && !FLIGHT.test(flight);

  async function getPrices() {
    setError(null);
    if (!draft.origin || !draft.destination) return setError(t('book.missingPlaces'));
    if (!draft.pickupAt) return setError(t('book.missingTime'));
    const problem = pickupProblem(new Date(draft.pickupAt), new Date(), booking);
    if (problem) return setError(t(problem === 'too_soon' ? 'book.tooSoon' : 'book.tooFar'));
    setBusy(true);
    try {
      const quotes = await api.quotes.create({
        origin: draft.origin,
        destination: draft.destination,
        stops: [],
        requestedAt: draft.pickupAt,
        options: { flex: draft.options.flex, priority: draft.options.priority, childSeat: draft.options.childSeat, luggage: draft.options.luggage },
      });
      draft.update({ quotes, category: quotes.quotes[0]?.category ?? null, vehicleId: null });
      router.push('/book/category');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen subtitle={t('book.step', { step: 1 })} title={t('book.title')} footer={<Button label={t('book.getPrice')} onPress={() => void getPrices()} disabled={busy || flightInvalid} />}>
      <RideMap origin={draft.origin?.coordinates ?? null} destination={draft.destination?.coordinates ?? null} height={180} />
      <AddressField label={t('book.from')} value={draft.origin} onChange={(origin) => draft.update({ origin, quotes: null })} savedPlaces={places.data ?? []} allowCurrentLocation />
      <AddressField label={t('book.to')} value={draft.destination} onChange={(destination) => draft.update({ destination, quotes: null })} savedPlaces={places.data ?? []} near={near} />
      <PickupPicker booking={booking} value={draft.pickupAt} onChange={(pickupAt) => draft.update({ pickupAt, quotes: null })} />
      <Field
        label={t('book.flight')}
        hint={t('book.flightHint')}
        value={draft.flightNumber}
        onChangeText={(flightNumber) => draft.update({ flightNumber: flightNumber.toUpperCase() })}
        autoCapitalize="characters"
        maxLength={6}
        {...(flightInvalid ? { error: t('book.flightInvalid') } : {})}
      />
      {busy ? <Notice>{t('category.recalculating')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
