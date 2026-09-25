import { MAX_QUOTE_STOPS, type AvailableVehicle, type Place } from '@neomoov/domain';
import { Button, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AddressField } from '@/components/AddressField';
import { CategoryCard } from '@/components/CategoryCard';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { ErrorState, Notice, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { categoryCards } from '@/features/booking/logic';
import { useBooking, type BookingOptions } from '@/features/booking/store';
import { api, errorMessage } from '@/lib/api';
import { toE164 } from '@/lib/phone';
import { keys, useAppConfig, usePlaces } from '@/lib/queries';

/**
 * Réservation, écran 2 sur 3 : catégories avec prix total de l'API, détail dépliable, options et arrêts qui redemandent
 * le devis (prix recalculé par l'API), réservation pour un tiers, et choix précis du véhicule parmi ceux libres sur le
 * créneau (D37).
 */
export default function CategoryScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const places = usePlaces();
  const draft = useBooking();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingStop, setAddingStop] = useState(false);
  const latestRequest = useRef(0);
  const cards = useMemo(() => (draft.quotes && config.data ? categoryCards(draft.quotes, config.data.categories) : []), [draft.quotes, config.data]);
  const selected = cards.find((c) => c.code === draft.category) ?? cards[0] ?? null;
  const vehicles = useQuery({
    queryKey: keys.vehicles(selected?.quote.id ?? ''),
    queryFn: () => api.quotes.vehicles(selected!.quote.id),
    enabled: Boolean(selected?.quote.id && draft.quotes?.requestedAt),
  });

  if (!draft.quotes || !draft.origin || !draft.destination) return <Redirect href="/book" />;

  /** Nouveau devis avec les options et les arrêts donnés : le prix affiché est toujours celui de l'API. */
  async function requote(patch: { options?: BookingOptions; stops?: Place[] }) {
    const options = patch.options ?? draft.options;
    const stops = patch.stops ?? draft.stops;
    draft.update({ options, stops });
    if (!draft.origin || !draft.destination || !draft.pickupAt) return;
    // Deux changements rapides : la réponse d'une demande dépassée n'écrase pas le prix des derniers choix.
    const request = ++latestRequest.current;
    setBusy(true);
    setError(null);
    try {
      const quotes = await api.quotes.create({
        origin: draft.origin,
        destination: draft.destination,
        stops,
        requestedAt: draft.pickupAt,
        options: { flex: options.flex, priority: options.priority, childSeat: options.childSeat, luggage: options.luggage, ...(options.favouriteDriverId ? { favouriteDriverId: options.favouriteDriverId } : {}) },
      });
      if (request === latestRequest.current) draft.update({ quotes, vehicleId: null });
    } catch (e) {
      if (request === latestRequest.current) setError(errorMessage(e));
    } finally {
      if (request === latestRequest.current) setBusy(false);
    }
  }

  const setOption = (name: keyof Omit<BookingOptions, 'favouriteDriverId'>, value: boolean) => requote({ options: { ...draft.options, [name]: value } });
  const passengerPhoneInvalid = draft.forSomeoneElse && draft.passengerPhone.trim().length >= 10 && !toE164(draft.passengerPhone);

  return (
    <Screen back subtitle={t('book.step', { step: 2 })} title={t('category.title')} footer={<Button label={t('category.continue')} onPress={() => router.push('/book/confirm')} disabled={busy || !selected} />}>
      {draft.quotes.estimated ? <Notice tone="warning">{t('category.estimated')}</Notice> : null}
      <View style={styles.cards} accessibilityRole="radiogroup">
        {cards.map((card) => (
          <CategoryCard key={card.code} card={card} selected={card.code === selected?.code} onSelect={() => draft.update({ category: card.code, vehicleId: null })} />
        ))}
      </View>
      {selected ? <PriceBreakdown quote={selected.quote} /> : null}
      {busy ? <Notice>{t('category.recalculating')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}

      <SectionTitle>{t('category.options')}</SectionTitle>
      <ToggleRow label={t('category.childSeat')} value={draft.options.childSeat} onChange={(v) => void setOption('childSeat', v)} />
      <ToggleRow label={t('category.luggage')} value={draft.options.luggage} onChange={(v) => void setOption('luggage', v)} />
      <ToggleRow label={t('category.flex')} value={draft.options.flex} onChange={(v) => void setOption('flex', v)} />
      <ToggleRow label={t('category.priority')} value={draft.options.priority} onChange={(v) => void setOption('priority', v)} />

      <SectionTitle>{t('category.stops')}</SectionTitle>
      {draft.stops.map((stop, index) => (
        <View key={`${stop.address}-${index}`} style={styles.stop}>
          <Text style={styles.stopText}>{`${t('category.stopLabel', { n: index + 1 })} · ${stop.address}`}</Text>
          <Pressable accessibilityRole="button" onPress={() => void requote({ stops: draft.stops.filter((_, i) => i !== index) })} hitSlop={8}>
            <Text style={styles.link}>{t('category.removeStop')}</Text>
          </Pressable>
        </View>
      ))}
      {addingStop ? (
        <AddressField
          label={t('category.stopLabel', { n: draft.stops.length + 1 })}
          value={null}
          savedPlaces={places.data ?? []}
          near={draft.origin.coordinates}
          onChange={(place) => {
            if (!place) return;
            setAddingStop(false);
            void requote({ stops: [...draft.stops, place] });
          }}
        />
      ) : draft.stops.length < MAX_QUOTE_STOPS ? (
        <Pressable accessibilityRole="button" onPress={() => setAddingStop(true)}>
          <Text style={styles.link}>{t('category.addStop')}</Text>
        </Pressable>
      ) : (
        <Text style={styles.hint}>{t('category.maxStops')}</Text>
      )}

      <SectionTitle>{t('category.someoneElse')}</SectionTitle>
      <ToggleRow label={t('category.forSomeoneElse')} hint={t('category.passengerHint')} value={draft.forSomeoneElse} onChange={(forSomeoneElse) => draft.update({ forSomeoneElse })} />
      {draft.forSomeoneElse ? (
        <>
          <Field label={t('category.passengerName')} value={draft.passengerName} onChangeText={(passengerName) => draft.update({ passengerName })} maxLength={120} textContentType="name" testID="passenger-name-input" />
          <Field
            label={t('category.passengerPhone')}
            value={draft.passengerPhone}
            onChangeText={(passengerPhone) => draft.update({ passengerPhone })}
            keyboardType="phone-pad"
            maxLength={16}
            testID="passenger-phone-input"
            {...(passengerPhoneInvalid ? { error: t('auth.invalidPhone') } : {})}
          />
        </>
      ) : null}

      {draft.quotes.requestedAt ? (
        <>
          <SectionTitle>{t('category.vehicles')}</SectionTitle>
          <Text style={styles.hint}>{t('category.vehiclesIntro')}</Text>
          <VehicleOption label={t('category.anyVehicle')} selected={draft.vehicleId === null} onPress={() => draft.update({ vehicleId: null })} />
          {vehicles.isError ? <ErrorState message={errorMessage(vehicles.error)} onRetry={() => void vehicles.refetch()} /> : null}
          {vehicles.data && vehicles.data.length === 0 ? <Text style={styles.hint}>{t('category.noVehicles')}</Text> : null}
          {(vehicles.data ?? []).map((v) => (
            <VehicleOption key={v.vehicleId} vehicle={v} selected={draft.vehicleId === v.vehicleId} onPress={() => draft.update({ vehicleId: v.vehicleId })} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function VehicleOption({ vehicle, label, selected, onPress }: { vehicle?: AvailableVehicle; label?: string; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const title = vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : (label ?? '');
  const detail = vehicle ? `${vehicle.colour} · ${t('category.driverRating', { name: vehicle.driver.firstName ?? t('category.driverFallback'), rating: vehicle.driver.rating.toFixed(2) })}` : null;
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.vehicle, selected && styles.vehicleSelected]}>
      <View style={styles.vehicleText}>
        <Text style={styles.vehicleTitle}>{title}</Text>
        {detail ? <Text style={styles.hint}>{detail}</Text> : null}
      </View>
      {vehicle?.isFavourite ? <Text style={styles.badge}>{t('category.favourite')}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing.sm },
  hint: { fontSize: typography.sizes.xs, color: colors.muted },
  link: { color: colors.blueDark, fontWeight: '700', paddingVertical: spacing.xs },
  stop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.sm },
  stopText: { flex: 1, fontSize: typography.sizes.sm, color: colors.ink },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, borderWidth: 2, borderColor: 'transparent' },
  vehicleSelected: { borderColor: colors.blue },
  vehicleText: { flex: 1, gap: 2 },
  vehicleTitle: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  badge: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.white, backgroundColor: colors.green, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
});
