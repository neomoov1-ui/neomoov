import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ErrorState, Row } from '@/components/ui';
import { useBooking } from '@/features/booking/store';
import { sortFavorites } from '@/features/growth/logic';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useFavorites } from '@/lib/queries';

/**
 * « Mes chauffeurs » (5.10) : chauffeurs favoris du client, réservation avec l'un d'eux (le devis le demande et ajoute le
 * supplément du favori s'il est libre, sinon l'option est ignorée par l'API) et retrait de la liste.
 */
export function MyDrivers() {
  const { t } = useTranslation();
  const favorites = useFavorites();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(driverId: string) {
    setBusy(driverId);
    setError(null);
    try {
      await api.me.removeFavorite(driverId);
      await queryClient.invalidateQueries({ queryKey: keys.favorites });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function bookWith(driverId: string) {
    const draft = useBooking.getState();
    draft.update({ options: { ...draft.options, favouriteDriverId: driverId }, quotes: null });
    router.push('/book');
  }

  if (favorites.isError) return <ErrorState message={errorMessage(favorites.error)} onRetry={() => void favorites.refetch()} />;
  const list = sortFavorites(favorites.data ?? []);
  if (!favorites.isLoading && list.length === 0) return <Body muted>{t('profile.myDriversSoon')}</Body>;
  return (
    <View style={styles.list}>
      {list.map((f) => (
        <Card key={f.driverId} style={styles.card}>
          <Row label={f.firstName ?? t('favorites.driverFallback')} value={t('favorites.rating', { rating: f.rating.toFixed(2) })} strong />
          {f.vehicle ? <Body muted>{`${f.vehicle.make} ${f.vehicle.model} · ${f.vehicle.colour}`}</Body> : null}
          <Body muted>{t('favorites.ridesTogether', { count: f.ridesTogether })}</Body>
          {f.available ? null : <Body muted>{t('favorites.unavailable')}</Body>}
          <View style={styles.buttons}>
            {f.available ? <Button label={t('favorites.bookWith')} variant="secondary" onPress={() => bookWith(f.driverId)} style={styles.flex} testID={`favorite-book-${f.driverId}`} /> : null}
            <Button label={t('favorites.remove')} variant="ghost" onPress={() => void remove(f.driverId)} disabled={busy !== null} style={styles.flex} />
          </View>
        </Card>
      ))}
      {error ? <ErrorState message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { gap: spacing.xs },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
