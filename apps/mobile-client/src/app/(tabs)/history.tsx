import { useTranslation } from 'react-i18next';
import { RideListItem } from '@/components/RideListItem';
import { Empty, ErrorState, Loading, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { isClosed, useRides } from '@/lib/queries';

/** Courses terminées, annulées ou sans chauffeur, les plus récentes d'abord ; les reçus PDF arrivent avec la facturation (étape 9). */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const rides = useRides();
  const past = (rides.data ?? []).filter(isClosed);
  return (
    <Screen title={t('history.title')} onRefresh={() => void rides.refetch()} refreshing={rides.isRefetching}>
      {rides.isLoading ? <Loading /> : null}
      {rides.isError ? <ErrorState message={errorMessage(rides.error)} onRetry={() => void rides.refetch()} /> : null}
      {rides.data && past.length === 0 ? <Empty message={t('history.empty')} /> : null}
      {past.map((ride) => (
        <RideListItem key={ride.id} ride={ride} />
      ))}
    </Screen>
  );
}
