import type { AvailableVehicle } from '@neomoov/domain';
import { Button } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryCard } from '@/components/CategoryCard';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { ErrorState, Notice, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { categoryCards } from '@/features/booking/logic';
import { useBooking, type BookingOptions } from '@/features/booking/store';
import { api, errorMessage } from '@/lib/api';
import { keys, useAppConfig } from '@/lib/queries';

/**
 * Réservation, écran 2 sur 3 : catégories avec prix total de l'API, détail dépliable, options qui redemandent le devis
 * (prix recalculé par l'API), et choix précis du véhicule parmi ceux libres sur le créneau (D37).
 */
export default function CategoryScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const draft = useBooking();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = useMemo(() => (draft.quotes && config.data ? categoryCards(draft.quotes, config.data.categories) : []), [draft.quotes, config.data]);
  const selected = cards.find((c) => c.code === draft.category) ?? cards[0] ?? null;
  const vehicles = useQuery({
    queryKey: keys.vehicles(selected?.quote.id ?? ''),
    queryFn: () => api.quotes.vehicles(selected!.quote.id),
    enabled: Boolean(selected?.quote.id && draft.quotes?.requestedAt),
  });

  if (!draft.quotes || !draft.origin || !draft.destination) return <Redirect href="/book" />;

  async function setOption(name: keyof Omit<BookingOptions, 'favouriteDriverId'>, value: boolean) {
    const options = { ...draft.options, [name]: value };
    draft.update({ options });
    if (!draft.origin || !draft.destination || !draft.pickupAt) return;
    setBusy(true);
    setError(null);
    try {
      const quotes = await api.quotes.create({
        origin: draft.origin,
        destination: draft.destination,
        stops: [],
        requestedAt: draft.pickupAt,
        options: { flex: options.flex, priority: options.priority, childSeat: options.childSeat, luggage: options.luggage, ...(options.favouriteDriverId ? { favouriteDriverId: options.favouriteDriverId } : {}) },
      });
      draft.update({ quotes, vehicleId: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

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
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, borderWidth: 2, borderColor: 'transparent' },
  vehicleSelected: { borderColor: colors.blue },
  vehicleText: { flex: 1, gap: 2 },
  vehicleTitle: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  badge: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.white, backgroundColor: colors.green, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
});
