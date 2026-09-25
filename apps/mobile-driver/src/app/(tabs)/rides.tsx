import type { ScheduledRideView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Empty, ErrorState, Loading, Notice, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useDriverRides, useScheduled } from '@/lib/queries';

/**
 * Courses (6.2) : course en cours, courses planifiées (réservées pour le chauffeur, à confirmer obligatoirement, et
 * disponibles de sa catégorie), dernières courses.
 */
export default function RidesScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const rides = useDriverRides();
  const scheduled = useScheduled();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents, language);

  async function act(rideId: string, action: () => Promise<unknown>) {
    setBusy(rideId);
    setError(null);
    try {
      await action();
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.scheduled }), queryClient.invalidateQueries({ queryKey: keys.home }), queryClient.invalidateQueries({ queryKey: keys.rides })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const list = scheduled.data ?? [];
  const reserved = list.filter((r) => r.state === 'assigned' || r.assignment !== null);
  const available = list.filter((r) => !reserved.includes(r));

  const card = (r: ScheduledRideView, mine: boolean) => (
    <Card key={r.id} style={styles.card}>
      <Row label={formatDateTime(r.requestedAt, language)} value={money(r.driverFareCents)} strong />
      <Body>{r.origin.address}</Body>
      <Body muted>{r.destination.address}</Body>
      <Body muted>{t(`methods.${r.paymentMethod}`)}</Body>
      {mine && r.assignment?.confirmedAt ? <Notice tone="success">{t('rides.confirmed')}</Notice> : null}
      {mine && r.assignment && !r.assignment.confirmedAt ? (
        <>
          <Notice tone="warning">{t('rides.toConfirm')}</Notice>
          <View style={styles.row}>
            <Button label={t('rides.confirm')} onPress={() => void act(r.id, () => api.driver.confirmScheduled(r.id))} disabled={busy === r.id} style={styles.flex} />
            <Button label={t('rides.decline')} variant="ghost" onPress={() => void act(r.id, () => api.driver.declineScheduled(r.id))} disabled={busy === r.id} style={styles.flex} />
          </View>
        </>
      ) : null}
      {!mine ? <Button label={t('rides.claim')} variant="secondary" onPress={() => void act(r.id, () => api.driver.claimScheduled(r.id))} disabled={busy === r.id} /> : null}
    </Card>
  );

  return (
    <Screen title={t('rides.title')} onRefresh={() => void Promise.all([rides.refetch(), scheduled.refetch()])} refreshing={rides.isRefetching || scheduled.isRefetching}>
      {error ? <ErrorState message={error} /> : null}
      {rides.data?.active ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: rides.data!.active!.id } })}>
          <Card style={styles.card}>
            <SectionTitle>{t('rides.active')}</SectionTitle>
            <Body>{rides.data.active.origin.address}</Body>
            <Body muted>{rides.data.active.destination.address}</Body>
          </Card>
        </Pressable>
      ) : null}

      <SectionTitle>{t('rides.scheduledTitle')}</SectionTitle>
      <Body muted>{t('rides.reminder')}</Body>
      {scheduled.isLoading ? <Loading /> : null}
      {scheduled.error ? <ErrorState message={errorMessage(scheduled.error)} onRetry={() => void scheduled.refetch()} /> : null}
      {reserved.length ? <Body>{t('rides.reserved')}</Body> : null}
      {reserved.map((r) => card(r, true))}
      {available.length ? <Body>{t('rides.available')}</Body> : null}
      {available.map((r) => card(r, false))}
      {scheduled.isFetched && !list.length ? <Empty message={t('rides.none')} /> : null}

      <SectionTitle>{t('rides.recent')}</SectionTitle>
      {(rides.data?.items ?? []).slice(0, 20).map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: r.id } })}>
          <Card style={styles.card}>
            <Row label={r.requestedAt ? formatDateTime(r.requestedAt, language) : ''} value={r.finalPriceCents !== null ? money(r.finalPriceCents) : ''} strong />
            <Body muted>{`${r.origin.address} → ${r.destination.address}`}</Body>
            <Body muted>{t(`ride.states.${r.state as 'completed'}`, { defaultValue: r.state })}</Body>
          </Card>
        </Pressable>
      ))}
      {rides.isFetched && !(rides.data?.items ?? []).length ? <Empty message={t('rides.noRecent')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
