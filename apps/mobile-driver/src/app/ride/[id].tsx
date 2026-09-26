import type { DriverRideView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Row } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PreferenceChips } from '@/components/Preferences';
import { RideMap } from '@/components/RideMap';
import { EndOfRide } from '@/features/ride/EndOfRide';
import { CancelSheet, IncidentSheet, MessagesSheet, SosSheet } from '@/features/ride/RideSheets';
import { clock, endOfRidePending, isActive, navigationTarget, nextAction, noShowStatus, waitedSeconds, type RideAction } from '@/features/ride/steps';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { openNavigation, type NavigationApp } from '@/lib/navigation';
import { usePreferences } from '@/lib/preferences';
import { keys, queryClient, refreshDriver, useDriverRide } from '@/lib/queries';
import { useRideSubscription } from '@/lib/realtime';

type Sheet = 'messages' | 'incident' | 'cancel' | 'sos' | null;

/** Écran allumé pendant la course (téléphone sur son support) ; sans objet dans un navigateur. */
function useScreenAwake(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const tag = 'neomoov-ride';
    void activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => void deactivateKeepAwake(tag).catch(() => undefined);
  }, []);
}

/**
 * Navigation de course plein écran (6.2) : étape courante, un seul bouton pour passer à la suivante (le chauffeur ne
 * saisit rien en conduisant), navigation externe Google Maps ou Waze, message et appel masqués, compteur d'attente,
 * non-présentation, SOS, incident, annulation ; fin de course avec paiement direct et évaluation. L'écran reste allumé.
 */
export default function RideScreen() {
  useScreenAwake();
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const ride = useDriverRide(id, true);
  const dataSaver = usePreferences((s) => s.dataSaver);
  const navigationApp = usePreferences((s) => s.navigationApp);
  useRideSubscription(id, true);
  const [now, setNow] = useState(Date.now());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = ride.data;
  const money = (cents: number) => formatMoney(cents, language);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: keys.ride(id) });
      // L'accueil et les listes se mettent à jour en arrière-plan : l'étape suivante est disponible tout de suite.
      void refreshDriver();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const step = (action: RideAction) => run(() => (action === 'complete' ? api.driver.complete(id) : api.driver[action](id)));
  const navigate = (app: NavigationApp) => {
    if (!data) return;
    const target = navigationTarget(data);
    void openNavigation(app, target.coordinates, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web', { canOpen: Linking.canOpenURL, open: Linking.openURL });
  };
  const noShow = () =>
    run(async () => {
      const result = await api.driver.noShow(id);
      setNotice(t('ride.noShowDone', { amount: money(result.feeCents) }));
    });

  if (ride.isLoading) return <Loading />;
  if (!data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ErrorState message={ride.error ? errorMessage(ride.error) : t('ride.notFound')} onRetry={() => void ride.refetch()} />
          <Button label={t('ride.end.done')} variant="ghost" onPress={() => router.replace('/home')} />
        </View>
      </SafeAreaView>
    );
  }

  const action = nextAction(data.state);
  const active = isActive(data.state);
  const target = navigationTarget(data);
  const arrivedAt = data.timestamps.arrived;
  const waiting = data.state === 'arrived' ? waitedSeconds(arrivedAt, now) : 0;
  const noShowState = noShowStatus(data.job, now);
  const pending = endOfRidePending(data);
  const finished = !active;
  const who = data.job.passengerName ? t('ride.passenger', { name: data.job.passengerName }) : t('ride.client', { name: data.job.clientFirstName ?? t('ride.clientUnknown') });
  const otherApp: NavigationApp = navigationApp === 'google' ? 'waze' : 'google';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('core:back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} hitSlop={12}>
          <Ionicons name="chevron-back" size={28} color={colors.night} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.number}>{data.type === 'scheduled' && data.requestedAt ? formatDateTime(data.requestedAt, language) : ''}</Text>
          <Text accessibilityRole="header" style={styles.state} testID="ride-state">{t(`ride.states.${data.state}`)}</Text>
        </View>
        {active ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('ride.sos')} onPress={() => setSheet('sos')} style={styles.sos} testID="sos">
            <Text style={styles.sosText}>{t('ride.sos')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {active && !dataSaver ? <RideMap origin={data.origin.coordinates} destination={data.destination.coordinates} stops={data.stops.map((s) => s.coordinates)} labels={{ origin: t('ride.pickup'), destination: t('ride.dropoff'), unavailable: t('ride.mapUnavailable') }} /> : null}

        {active ? (
          <Card style={styles.card}>
            <Text style={styles.label}>{data.state === 'in_progress' ? t('ride.dropoff') : t('ride.pickup')}</Text>
            <Text style={styles.address}>{target.address}</Text>
            {data.state === 'in_progress'
              ? data.stops.map((s, index) => (
                  <Body key={`${s.address}-${index}`} muted>{`${t('ride.stop', { number: index + 1 })} : ${s.address}`}</Body>
                ))
              : null}
            <View style={styles.row}>
              <Button label={t('ride.navigateWith', { app: t(`ride.apps.${navigationApp}`) })} onPress={() => navigate(navigationApp)} style={styles.flex} testID="navigate" />
              <Button label={t(`ride.apps.${otherApp}`)} variant="ghost" onPress={() => navigate(otherApp)} />
            </View>
          </Card>
        ) : null}

        {action ? <Button label={t(`ride.actions.${action}`)} onPress={() => void step(action)} disabled={busy} style={styles.main} testID={`action-${action}`} /> : null}

        {data.state === 'arrived' ? (
          <Card style={styles.card}>
            <Row label={t('ride.wait', { time: clock(waiting) })} value={t('ride.contacts', { count: data.job.contactAttempts })} strong />
            <Button label={t('ride.contactAttempt')} variant="ghost" onPress={() => void run(() => api.driver.contact(id))} disabled={busy} />
            {noShowState.ready ? (
              <Button label={t('ride.noShow')} variant="danger" onPress={() => void noShow()} disabled={busy} testID="no-show" />
            ) : (
              <Body muted>{noShowState.secondsLeft > 0 ? t('ride.noShowIn', { time: clock(noShowState.secondsLeft) }) : t('ride.noShowContacts', { count: noShowState.contactsLeft })}</Body>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Text style={styles.who}>{who}</Text>
          <PreferenceChips preferences={data.job.preferences} />
          {data.job.flightNumber ? <Body>{t('ride.flight', { number: data.job.flightNumber })}</Body> : null}
          {data.job.specialRequests ? <Body>{`${t('ride.special')} : ${data.job.specialRequests}`}</Body> : null}
          <Body muted>{data.job.payment.direct ? t('ride.paymentDirect', { method: t(`methods.${data.paymentMethod}`) }) : t('ride.paymentApp')}</Body>
          <Body muted>{t('ride.fare', { amount: money(data.job.driverFareCents) })}</Body>
          {active ? (
            <View style={styles.row}>
              <Button label={t('ride.message')} variant="ghost" onPress={() => setSheet('messages')} style={styles.flex} />
              <Button label={t('ride.call')} variant="ghost" onPress={() => (data.job.callNumber ? void Linking.openURL(`tel:${data.job.callNumber}`) : setNotice(t('ride.noCall')))} style={styles.flex} />
            </View>
          ) : null}
        </Card>

        {finished && (data.state === 'completed' || data.state === 'rated' || data.state === 'disputed') ? <EndOfRide ride={data as DriverRideView} /> : null}
        {finished && !pending.payment && !pending.rating ? <Button label={t('ride.end.done')} onPress={() => router.replace('/home')} testID="ride-done" /> : null}

        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <ErrorState message={error} /> : null}

        <View style={styles.row}>
          <Button label={t('ride.incident')} variant="ghost" onPress={() => setSheet('incident')} style={styles.flex} />
          {active && data.state !== 'in_progress' ? <Button label={t('ride.cancel')} variant="ghost" onPress={() => setSheet('cancel')} style={styles.flex} /> : null}
        </View>
      </ScrollView>

      <MessagesSheet rideId={id} visible={sheet === 'messages'} onClose={() => setSheet(null)} />
      <IncidentSheet rideId={id} visible={sheet === 'incident'} onClose={() => setSheet(null)} />
      <SosSheet rideId={id} visible={sheet === 'sos'} onClose={() => setSheet(null)} />
      <CancelSheet rideId={id} visible={sheet === 'cancel'} onClose={() => setSheet(null)} onCancelled={() => router.replace('/home')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  headerText: { flex: 1 },
  number: { fontSize: typography.sizes.xs, color: colors.muted, fontWeight: '700' },
  state: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.night },
  sos: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 64, alignItems: 'center' },
  sosText: { color: colors.white, fontWeight: '800', fontSize: typography.sizes.md },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { gap: spacing.sm },
  label: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  address: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  main: { minHeight: 64 },
  who: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night },
});
