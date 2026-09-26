import type { DriverOfferView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Notice, Row } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PreferenceChips } from '@/components/Preferences';
import { secondsLeft } from '@/features/ride/steps';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatDistance, formatDuration, formatMoney, type UiLanguage } from '@/lib/format';
import { startOfferAlert, stopOfferAlert } from '@/lib/offer-alert';
import { keys, queryClient, refreshDriver, useAppConfig, useOffers } from '@/lib/queries';

/**
 * Offre de course plein écran (6.2) : catégorie, tarif, distance et temps jusqu'au client, trajet, destination,
 * préférences, favori ; compte à rebours de 15 secondes avec sonnerie et vibration ; l'offre disparaît à l'expiration.
 * Un seul geste : accepter ou décliner. Contre-proposition seulement si le drapeau distant est actif.
 */
export default function OfferScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const offers = useOffers(true);
  const config = useAppConfig();
  const offer: DriverOfferView | undefined = offers.data?.find((o) => o.id === id);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState('');
  const [countering, setCountering] = useState(false);
  const money = (cents: number) => formatMoney(cents, language);
  const left = offer ? secondsLeft(offer.expiresAt, now) : 0;
  const gone = offers.isFetched && (!offer || left === 0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void startOfferAlert();
    return () => stopOfferAlert();
  }, []);

  // Expirée ou attribuée ailleurs : la sonnerie s'arrête et l'écran se ferme de lui-même.
  useEffect(() => {
    if (!gone) return;
    stopOfferAlert();
    const timer = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/home')), 1500);
    return () => clearTimeout(timer);
  }, [gone]);

  async function respond(action: () => Promise<void>) {
    stopOfferAlert();
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

  const accept = () =>
    respond(async () => {
      const ride = await api.driver.acceptOffer(id);
      queryClient.setQueryData<DriverOfferView[]>(keys.offers, (list = []) => list.filter((o) => o.id !== id));
      await refreshDriver();
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
    });

  const decline = () =>
    respond(async () => {
      await api.driver.declineOffer(id);
      queryClient.setQueryData<DriverOfferView[]>(keys.offers, (list = []) => list.filter((o) => o.id !== id));
      router.canGoBack() ? router.back() : router.replace('/home');
    });

  const sendCounter = () =>
    respond(async () => {
      const cents = Math.round(Number.parseFloat(counter.replace(',', '.')) * 100);
      if (!Number.isFinite(cents) || cents <= 0) return;
      await api.driver.counterOffer(id, { proposedTotalCents: cents });
      router.canGoBack() ? router.back() : router.replace('/home');
    });

  const negotiation = Boolean(config.data?.features.negotiation && offer?.type === 'client_proposal' && offer.proposedTotalCents !== null && offer.displayedTotalCents !== null);
  const ride = offer?.ride;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{t('offer.title')}</Text>
        <View style={[styles.countdown, left <= 5 && styles.countdownUrgent]} accessibilityLiveRegion="assertive" accessibilityLabel={t('offer.secondsLeft', { seconds: left })}>
          <Text style={styles.countdownText} testID="offer-countdown">{left}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {gone ? <Notice tone="warning">{offer ? t('offer.expired') : t('offer.gone')}</Notice> : null}
        {offer && ride ? (
          <>
            {offer.isFavourite ? (
              <View style={styles.favourite}>
                <Ionicons name="heart" size={18} color={colors.white} />
                <Text style={styles.favouriteText}>{t('offer.favourite')}</Text>
              </View>
            ) : null}
            <Card style={styles.card}>
              <Text style={styles.fareLabel}>{t('offer.fare')}</Text>
              <Text style={styles.fare} testID="offer-fare">{money(offer.driverFareCents)}</Text>
              <Body muted>{config.data?.categories.find((c) => c.code === ride.category)?.name ?? ride.category}</Body>
              {offer.pickupSeconds !== null ? <Row label={t('offer.pickupIn', { minutes: Math.max(1, Math.round(offer.pickupSeconds / 60)) })} value={offer.pickupDistanceMeters !== null ? t('offer.pickupDistance', { distance: formatDistance(offer.pickupDistanceMeters, language) }) : ''} strong /> : null}
              {ride.distanceMeters !== null && ride.durationSeconds !== null ? <Body>{t('offer.trip', { distance: formatDistance(ride.distanceMeters, language), duration: formatDuration(ride.durationSeconds) })}</Body> : null}
              {ride.type === 'scheduled' && ride.requestedAt ? <Body>{t('offer.scheduledFor', { date: formatDateTime(ride.requestedAt, language) })}</Body> : null}
            </Card>
            <Card style={styles.card}>
              <View style={styles.place}>
                <Ionicons name="radio-button-on" size={18} color={colors.green} />
                <Text style={styles.address}>{ride.origin.address}</Text>
              </View>
              {ride.stops > 0 ? <Body muted>{t('offer.stops', { count: ride.stops })}</Body> : null}
              <View style={styles.place}>
                <Ionicons name="location" size={18} color={colors.danger} />
                <Text style={styles.address}>{ride.destination.address}</Text>
              </View>
            </Card>
            <Card style={styles.card}>
              <Row label={t('offer.payment')} value={`${t(`offer.paymentChoices.${ride.paymentChoice}`)} · ${t(`methods.${ride.paymentMethod}`)}`} />
              <PreferenceChips preferences={ride.preferences} />
              {ride.flightNumber ? <Body>{t('offer.flight', { number: ride.flightNumber })}</Body> : null}
              {ride.specialRequests ? <Body>{t('offer.special', { text: ride.specialRequests })}</Body> : null}
            </Card>
            {negotiation ? <Notice>{t('offer.clientProposal', { amount: money(offer.proposedTotalCents!), displayed: money(offer.displayedTotalCents!) })}</Notice> : null}
            {countering ? (
              <Card style={styles.card}>
                <Field label={t('offer.counterTitle')} value={counter} onChangeText={setCounter} keyboardType="decimal-pad" maxLength={8} />
                <Button label={t('offer.counterSend')} onPress={() => void sendCounter()} disabled={busy || !counter} />
              </Card>
            ) : null}
          </>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
      </ScrollView>
      {offer && !gone ? (
        <View style={styles.actions}>
          <Button label={t('offer.accept')} onPress={() => void accept()} disabled={busy} style={styles.accept} testID="offer-accept" />
          <View style={styles.secondary}>
            <Button label={t('offer.decline')} variant="ghost" onPress={() => void decline()} disabled={busy} style={styles.flex} testID="offer-decline" />
            {negotiation && !countering ? <Button label={t('offer.counter')} variant="ghost" onPress={() => setCountering(true)} disabled={busy} style={styles.flex} /> : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.white },
  countdown: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  countdownUrgent: { borderColor: colors.danger },
  countdownText: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.white, fontVariant: ['tabular-nums'] },
  content: { padding: spacing.lg, gap: spacing.md },
  favourite: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.blue, borderRadius: radius.md, padding: spacing.sm },
  favouriteText: { color: colors.white, fontWeight: '700', flex: 1 },
  card: { gap: spacing.sm },
  fareLabel: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  fare: { fontSize: typography.sizes.xxl, fontWeight: '700', color: colors.night, fontVariant: ['tabular-nums'] },
  place: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  address: { flex: 1, fontSize: typography.sizes.md, color: colors.ink },
  actions: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.night },
  accept: { minHeight: 64 },
  secondary: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
