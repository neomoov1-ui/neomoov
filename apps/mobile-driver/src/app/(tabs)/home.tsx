import type { DriverAlert } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { describeBlocker } from '@/features/home/blockers';
import { eligibilityReasons, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { permissionLevel } from '@/lib/location';
import { changeStatus, LocationPermissionError } from '@/lib/presence';
import { keys, queryClient, useDriverRides, useHome, useOffers } from '@/lib/queries';

const STATUS_COLORS = { online: colors.green, paused: colors.warning, offline: colors.muted } as const;

/**
 * Accueil (6.2) : statut en un geste avec vérification des prérequis, raisons du refus et leur écran, course en cours,
 * pack actif et courses restantes, revenus du jour et de la semaine, prochaine planifiée, alertes. Aucun montant n'est
 * calculé ici : tout vient de `GET /driver/home`.
 */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const home = useHome();
  const rides = useDriverRides();
  const offers = useOffers(home.data?.presence.status === 'online');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const data = home.data;
  const status = data?.presence.status ?? 'offline';
  const money = (cents: number) => formatMoney(cents, language);

  async function setStatus(next: 'online' | 'paused' | 'offline') {
    setError(null);
    setRefused([]);
    // Avant la première demande « toujours », l'écran d'explication (exigence d'Apple et de Google).
    if (next !== 'offline' && Platform.OS !== 'web' && (await permissionLevel()) !== 'always') {
      router.push({ pathname: '/location-permission', params: { then: next } });
      return;
    }
    setBusy(true);
    try {
      await changeStatus(next);
      await queryClient.invalidateQueries({ queryKey: keys.home });
    } catch (e) {
      if (e instanceof LocationPermissionError) setError(t('home.permissionDenied'));
      else {
        setRefused(eligibilityReasons(e));
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const alertText = (a: DriverAlert) => {
    const params: Record<string, string | number> = { ...a.params };
    if (typeof a.params['type'] === 'string') params['type'] = t(`documents.types.${a.params['type']}`);
    if (typeof a.params['amountCents'] === 'number') params['amount'] = money(a.params['amountCents']);
    if (typeof a.params['rating'] === 'number') params['rating'] = a.params['rating'].toFixed(2);
    return t(`alerts.${a.code}`, params);
  };
  const blockers = (refused.length ? refused : (data?.blockers ?? [])).map(describeBlocker);

  return (
    <Screen title={data?.profile.firstName ? t('home.hello', { name: data.profile.firstName }) : t('home.helloAnonymous')} subtitle={data?.profile.publicNumber} onRefresh={() => void home.refetch()} refreshing={home.isRefetching}>
      {home.isLoading ? <Loading /> : null}
      {home.error ? <ErrorState message={errorMessage(home.error)} onRetry={() => void home.refetch()} /> : null}

      {data ? (
        <Card style={styles.status}>
          <View style={styles.statusLine} accessibilityLiveRegion="polite">
            <View style={[styles.dot, { backgroundColor: STATUS_COLORS[status] }]} />
            <Text style={styles.statusText} testID="presence-status">{t(`home.statuses.${status}`)}</Text>
          </View>
          <Body muted>{t(status === 'online' ? 'home.onlineHint' : status === 'paused' ? 'home.pausedHint' : 'home.offlineHint')}</Body>
          {status === 'offline' ? <Button label={t('home.goOnline')} onPress={() => void setStatus('online')} disabled={busy} testID="go-online" /> : null}
          {status === 'online' ? <Button label={t('home.pause')} variant="secondary" onPress={() => void setStatus('paused')} disabled={busy} /> : null}
          {status === 'paused' ? <Button label={t('home.resume')} onPress={() => void setStatus('online')} disabled={busy} /> : null}
          {status !== 'offline' ? <Button label={t('home.goOffline')} variant="ghost" onPress={() => void setStatus('offline')} disabled={busy} testID="go-offline" /> : null}
        </Card>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {(offers.data ?? []).length ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/offer/[id]', params: { id: offers.data![0]!.id } })}>
          <Notice tone="warning">{t('offer.title')}</Notice>
        </Pressable>
      ) : null}

      {rides.data?.active ? (
        <Card style={styles.gap}>
          <SectionTitle>{t('home.activeRide')}</SectionTitle>
          <Body>{t(`ride.states.${rides.data.active.state as 'assigned'}`)}</Body>
          <Button label={t('home.openRide')} onPress={() => router.push({ pathname: '/ride/[id]', params: { id: rides.data!.active!.id } })} />
        </Card>
      ) : null}

      {blockers.length && status === 'offline' ? (
        <Card style={styles.gap}>
          <SectionTitle>{t('home.blockersTitle')}</SectionTitle>
          {blockers.map((b, index) => (
            <View key={`${b.key}-${index}`} style={styles.blocker}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={styles.blockerText}>{t(`blockers.${b.key}`, { ...b.params, type: b.params['type'] ? t(`documents.types.${b.params['type']}`) : '' })}</Text>
              {b.fix ? <Button label={t('home.fix')} variant="ghost" onPress={() => router.push(b.fix!)} /> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {data && !data.onboarding.complete ? <Button label={t('home.finishOnboarding')} variant="secondary" onPress={() => router.push('/onboarding')} testID="finish-onboarding" /> : null}

      {data ? (
        <View style={styles.earnings}>
          {(['today', 'week'] as const).map((period) => (
            <Card key={period} style={styles.earningCard}>
              <Text style={styles.earningLabel}>{t(period === 'today' ? 'home.today' : 'home.week')}</Text>
              <Text style={styles.earningValue}>{money(data.earnings[period].totalCents)}</Text>
              <Text style={styles.earningMeta}>{t('home.rides', { count: data.earnings[period].rides })}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {data ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/packs')}>
          <Card>
            {data.pack ? (
              <>
                <Row label={t('home.pack', { name: data.pack.name })} value={data.pack.ridesRemaining === null ? t('home.packUnlimited') : t('home.packRemaining', { count: data.pack.ridesRemaining })} strong />
                <Body muted>{t('home.packExpires', { date: formatDateTime(data.pack.expiresAt, language) })}</Body>
              </>
            ) : (
              <Row label={t('home.noPack')} value="›" />
            )}
          </Card>
        </Pressable>
      ) : null}

      {data?.nextScheduled ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/rides')}>
          <Card style={styles.gap}>
            <SectionTitle>{t('home.nextScheduled')}</SectionTitle>
            <Row label={formatDateTime(data.nextScheduled.requestedAt, language)} value={money(data.nextScheduled.driverFareCents)} strong />
            <Body>{data.nextScheduled.origin.address}</Body>
            <Body muted>{data.nextScheduled.destination.address}</Body>
            {data.nextScheduled.assignment && !data.nextScheduled.assignment.confirmedAt ? <Notice tone="warning">{t('home.toConfirm')}</Notice> : null}
          </Card>
        </Pressable>
      ) : null}

      {data?.alerts.length ? (
        <>
          <SectionTitle>{t('home.alertsTitle')}</SectionTitle>
          {data.alerts.map((a, index) => (
            <Notice key={`${a.code}-${index}`} tone={a.severity === 'info' ? 'info' : 'warning'}>{alertText(a)}</Notice>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { gap: spacing.sm },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.night },
  gap: { gap: spacing.sm },
  blocker: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  blockerText: { flex: 1, fontSize: typography.sizes.sm, color: colors.ink },
  earnings: { flexDirection: 'row', gap: spacing.md },
  earningCard: { flex: 1, gap: 2 },
  earningLabel: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  earningValue: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.night, fontVariant: ['tabular-nums'] },
  earningMeta: { fontSize: typography.sizes.sm, color: colors.ink },
});
