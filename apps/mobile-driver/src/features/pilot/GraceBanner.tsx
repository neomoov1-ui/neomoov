import { Button } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { secondsLeft } from '@/features/ride/steps';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, refreshDriver, usePilotDecisions } from '@/lib/queries';

/**
 * Bandeau « Acceptée par Pilote » (étape 24) sur une course attribuée : compte à rebours du délai de grâce et annulation
 * sans frais, sans pénalité ; après le délai, le bandeau disparaît et l'annulation ordinaire s'applique. `now` est l'heure
 * de l'API vue du téléphone (`serverNow`), pas l'horloge brute du téléphone (revue du 2 octobre 2026, constat mobile 1).
 */
export function GraceBanner({ rideId, state, now }: { rideId: string; state: string; now: number }) {
  const { t } = useTranslation();
  const decisions = usePilotDecisions(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decision = decisions.data?.items.find((d) => d.rideId === rideId && d.autoAcceptedAt && !d.cancelledInGraceAt && d.graceEndsAt);
  const left = decision?.graceEndsAt ? secondsLeft(decision.graceEndsAt, now) : 0;
  if (!decision || state !== 'assigned' || left <= 0) return null;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.driver.pilotCancel(rideId);
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.pilotDecisions }), refreshDriver()]);
      router.replace('/home');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="pilot-grace">
      <Text style={styles.title}>{t('pilot.graceBanner')}</Text>
      <Text style={styles.countdown}>{t('pilot.graceLeft', { seconds: left })}</Text>
      <Button label={t('pilot.graceCancel')} variant="secondary" onPress={() => void cancel()} disabled={busy} style={styles.button} testID="pilot-grace-cancel" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.blueDark, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  title: { color: colors.white, fontSize: typography.sizes.md, fontWeight: '700' },
  countdown: { color: colors.white, fontSize: typography.sizes.sm, fontVariant: ['tabular-nums'] },
  button: { minHeight: 56 },
  error: { color: colors.white, fontSize: typography.sizes.sm },
});
