import { Button } from '@neomoov/mobile-core/components';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RideListItem } from '@/components/RideListItem';
import { Empty, ErrorState, Loading, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { isClosed, useRides } from '@/lib/queries';

/** Réservations à venir et courses en cours (les plus proches d'abord). */
export default function ReservationsScreen() {
  const { t } = useTranslation();
  const rides = useRides();
  const upcoming = (rides.data ?? []).filter((r) => !isClosed(r)).sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? ''));
  return (
    <Screen title={t('reservations.title')} onRefresh={() => void rides.refetch()} refreshing={rides.isRefetching}>
      {rides.isLoading ? <Loading /> : null}
      {rides.isError ? <ErrorState message={errorMessage(rides.error)} onRetry={() => void rides.refetch()} /> : null}
      {rides.data && upcoming.length === 0 ? <Empty message={t('reservations.empty')} action={<Button label={t('reservations.book')} onPress={() => router.push('/book')} />} /> : null}
      {upcoming.map((ride) => (
        <RideListItem key={ride.id} ride={ride} />
      ))}
    </Screen>
  );
}
