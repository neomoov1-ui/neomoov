import type { RideView } from '@neomoov/domain';
import { Body, Button, Card, Sheet } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text, View } from 'react-native';
import { RideMap } from '@/components/RideMap';
import { ErrorState, Loading, Notice, Row, Screen } from '@/components/ui';
import { MessagesPanel } from '@/features/ride/MessagesPanel';
import { NegotiationPanel } from '@/features/ride/NegotiationPanel';
import { RatingForm } from '@/features/ride/RatingForm';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { isClosed, keys, queryClient, useAppConfig, useRide } from '@/lib/queries';
import { useRideLive } from '@/lib/realtime';

const ACTIVE: ReadonlyArray<RideView['state']> = ['assigned', 'en_route', 'arrived', 'in_progress'];
const CANCELLABLE: ReadonlyArray<RideView['state']> = ['requested', 'offering', 'assigned', 'en_route', 'arrived'];

/**
 * Suivi d'une course (6.1) : état en direct par le socket (repli HTTP toutes les 5 secondes), position du chauffeur,
 * chauffeur et véhicule, messagerie masquée, partage, urgence, annulation avec frais annoncés, prix final, évaluation.
 */
export default function RideScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = id ?? '';
  const config = useAppConfig();
  // Le suivi en direct s'arrête quand la course est close (état lu dans le cache, mis à jour par le socket ou le repli HTTP).
  const cached = queryClient.getQueryData<RideView>(keys.ride(rideId));
  const realtime = useRideLive(rideId, !(cached && isClosed(cached)));
  const query = useRide(rideId, !realtime.connected);
  const [sheet, setSheet] = useState<'cancel' | 'sos' | null>(null);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ride = query.data;
  if (query.isLoading) return <Loading />;
  if (!ride) return <Screen back title={t('ride.title')}><ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} /></Screen>;

  const money = (cents: number) => formatMoney(cents, language);
  const assignedAt = ride.timestamps.assigned ? new Date(ride.timestamps.assigned).getTime() : null;
  const freeWindow = (config.data?.booking.freeCancellationSeconds ?? 120) * 1000;
  const cancelFree = assignedAt === null || Date.now() - assignedAt <= freeWindow;
  const cancelFee = config.data?.booking.cancellationFeeCents ?? 500;
  const showNegotiation = Boolean(config.data?.features.negotiation && ride.negotiation && (ride.state === 'requested' || ride.state === 'offering'));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = () =>
    run(async () => {
      await api.rides.cancel(rideId, { reason: 'changed_plans' });
      setSheet(null);
      setNotice(t('ride.cancelled'));
      await queryClient.invalidateQueries({ queryKey: keys.ride(rideId) });
      await queryClient.invalidateQueries({ queryKey: keys.rides });
    });

  const sos = () =>
    run(async () => {
      await api.rides.sos(rideId, realtime.driverPosition ? { coordinates: { lat: realtime.driverPosition.lat, lng: realtime.driverPosition.lng } } : {});
      setSheet(null);
      setNotice(t('ride.sosSent'));
    });

  const share = () =>
    run(async () => {
      const url = ride.trackingUrl ?? (await api.rides.share(rideId)).trackingUrl;
      await Share.share({ message: t('ride.shareMessage', { url }) });
    });

  return (
    <Screen back subtitle={t('ride.title')} title={t(`ride.states.${ride.state}`)} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <RideMap origin={ride.origin.coordinates} destination={ride.destination.coordinates} driver={ACTIVE.includes(ride.state) && realtime.driverPosition ? realtime.driverPosition : null} />
      {!realtime.connected && !isClosed(ride) ? <Text style={styles.muted}>{t('ride.realtimeOff')}</Text> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <Card style={styles.card}>
        {ride.requestedAt ? <Row label={t('confirm.pickup')} value={formatDateTime(ride.requestedAt, language)} /> : null}
        <Row label={t('confirm.route')} value={`${ride.origin.address} → ${ride.destination.address}`} />
        <Row label={ride.finalPriceCents !== null ? t('ride.finalPrice') : t('confirm.price')} value={money(ride.finalPriceCents ?? ride.negotiation?.agreedTotalCents ?? ride.quote.totalCents)} strong />
      </Card>

      {(ride.state === 'requested' || ride.state === 'offering') && ride.type === 'scheduled' ? <Notice>{t('ride.scheduledInfo')}</Notice> : null}
      {ride.state === 'offering' && ride.type === 'immediate' ? <Notice>{t('ride.searching')}</Notice> : null}
      {ride.state === 'no_driver' ? <Notice tone="warning">{t('ride.noDriver')}</Notice> : null}
      {showNegotiation && config.data ? <NegotiationPanel ride={ride} config={config.data} /> : null}

      {ride.driver ? (
        <Card style={styles.card}>
          <Text style={styles.label}>{t('ride.driver')}</Text>
          <Text style={styles.driverName}>{ride.driver.firstName}</Text>
          <Body muted>{t('ride.rating', { rating: ride.driver.rating.toFixed(2), count: ride.driver.rideCount })}</Body>
          <Body>{t('ride.vehicle', { make: ride.driver.vehicle.make, model: ride.driver.vehicle.model, colour: ride.driver.vehicle.colour })}</Body>
          <Text style={styles.plate}>{t('ride.plate', { plate: ride.driver.vehicle.plate })}</Text>
        </Card>
      ) : null}

      {!isClosed(ride) ? (
        <View style={styles.actions}>
          {ride.driver ? <Button label={t('ride.message')} variant="ghost" onPress={() => setMessagesOpen((v) => !v)} /> : null}
          <Button label={t('ride.share')} variant="ghost" onPress={() => void share()} disabled={busy} />
          {ACTIVE.includes(ride.state) ? <Button label={t('ride.sos')} variant="danger" onPress={() => setSheet('sos')} /> : null}
          {CANCELLABLE.includes(ride.state) ? <Button label={t('ride.cancel')} variant="ghost" onPress={() => setSheet('cancel')} /> : null}
        </View>
      ) : null}
      <MessagesPanel rideId={rideId} open={messagesOpen && !isClosed(ride)} />

      {ride.state === 'completed' ? <RatingForm ride={ride} /> : null}
      {ride.state === 'rated' ? <Notice tone="success">{t('ride.thanks')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}

      <Sheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} title={t('ride.cancel')} closeLabel={t('core:close')}>
        <Body>{cancelFree ? t('ride.cancelFree') : t('ride.cancelFee', { amount: money(cancelFee) })}</Body>
        <Button label={t('ride.cancelConfirm')} variant="danger" onPress={() => void cancel()} disabled={busy} />
      </Sheet>
      <Sheet visible={sheet === 'sos'} onClose={() => setSheet(null)} title={t('ride.sos')} closeLabel={t('core:close')}>
        <Body>{t('ride.sosConfirm')}</Body>
        <Button label={t('ride.sos')} variant="danger" onPress={() => void sos()} disabled={busy} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  label: { fontSize: typography.sizes.xs, color: colors.muted, fontWeight: '700', textTransform: 'uppercase' },
  driverName: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night },
  plate: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.blueDark, letterSpacing: 1 },
  actions: { gap: spacing.sm },
  muted: { fontSize: typography.sizes.xs, color: colors.muted },
});
