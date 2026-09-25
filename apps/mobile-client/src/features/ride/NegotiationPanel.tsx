import type { AppConfig, RideView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ErrorState, Notice, SectionTitle } from '@/components/ui';
import { proposalBounds } from '@/features/booking/logic';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, formatTime, type UiLanguage } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';

/**
 * Négociation encadrée (V1.1, affichée seulement si le drapeau distant est actif) : proposition entre le plancher et le
 * prix affiché, par pas d'un dollar ; offres des chauffeurs en direct ; une offre au-dessus du prix affiché est présentée
 * à part et demande l'acceptation écrite du nouveau prix maximal (jamais sans elle).
 */
export function NegotiationPanel({ ride, config }: { ride: RideView; config: AppConfig }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const negotiation = ride.negotiation!;
  const bounds = proposalBounds(negotiation.displayedTotalCents, config.negotiation.floorPpm);
  const [amount, setAmount] = useState(negotiation.proposedTotalCents ?? bounds.minCents);
  const [consent, setConsent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offers = useQuery({ queryKey: keys.offers(ride.id), queryFn: () => api.rides.offers(ride.id), enabled: negotiation.proposedTotalCents !== null, refetchInterval: 10_000 });
  const money = (cents: number) => formatMoney(cents, language);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(keys.ride(ride.id), await api.rides.propose(ride.id, amount));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function accept(offerId: string, totalCents: number, above: boolean) {
    if (above && consent !== offerId) {
      setError(t('negotiation.consentRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const consentText = above ? t('negotiation.consentText', { amount: money(totalCents), date: ride.requestedAt ? formatDateTime(ride.requestedAt, language) : '' }) : undefined;
      queryClient.setQueryData(keys.ride(ride.id), await api.rides.acceptOffer(ride.id, offerId, consentText));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (negotiation.agreedTotalCents !== null) return <Notice tone="success">{t('negotiation.agreed', { amount: money(negotiation.agreedTotalCents) })}</Notice>;
  return (
    <Card style={styles.card}>
      <SectionTitle>{t('negotiation.title')}</SectionTitle>
      {negotiation.proposedTotalCents === null ? (
        <>
          <Body muted>{t('negotiation.intro', { min: money(bounds.minCents), max: money(bounds.maxCents) })}</Body>
          <View style={styles.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('negotiation.lower')} onPress={() => setAmount((a) => Math.max(bounds.minCents, a - bounds.stepCents))} style={styles.stepButton}>
              <Ionicons name="remove" size={24} color={colors.blueDark} />
            </Pressable>
            <Text style={styles.amount} accessibilityLiveRegion="polite">{money(amount)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('negotiation.raise')} onPress={() => setAmount((a) => Math.min(bounds.maxCents, a + bounds.stepCents))} style={styles.stepButton}>
              <Ionicons name="add" size={24} color={colors.blueDark} />
            </Pressable>
          </View>
          <Button label={t('negotiation.propose')} onPress={() => void propose()} disabled={busy} />
        </>
      ) : (
        <>
          <Body>{t('negotiation.waiting', { amount: money(negotiation.proposedTotalCents) })}</Body>
          {negotiation.endsAt ? <Body muted>{t('negotiation.endsAt', { time: formatTime(negotiation.endsAt, language) })}</Body> : null}
          <Body muted>{t('negotiation.fallback')}</Body>
          {(offers.data ?? []).length > 0 ? <SectionTitle>{t('negotiation.offers')}</SectionTitle> : null}
          {(offers.data ?? []).filter((o) => o.state === 'sent').map((o) => (
            <View key={o.id} style={[styles.offer, o.aboveDisplayed && styles.offerAbove]}>
              <Text style={styles.offerTitle}>{`${o.driver.firstName ?? t('category.driverFallback')} · ${o.driver.rating.toFixed(2)} ★ · ${o.driver.vehicle.make} ${o.driver.vehicle.model}`}</Text>
              {o.aboveDisplayed ? <Text style={styles.warning}>{t('negotiation.aboveDisplayed')}{o.reasonText ? ` : ${o.reasonText}` : ''}</Text> : null}
              {o.aboveDisplayed ? (
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent === o.id }} onPress={() => setConsent(consent === o.id ? null : o.id)} style={styles.consent}>
                  <Ionicons name={consent === o.id ? 'checkbox' : 'square-outline'} size={22} color={consent === o.id ? colors.blue : colors.muted} />
                  <Text style={styles.consentText}>{t('negotiation.consentLabel', { amount: money(o.totalCents) })}</Text>
                </Pressable>
              ) : null}
              <Button label={t('negotiation.accept', { amount: money(o.totalCents) })} onPress={() => void accept(o.id, o.totalCents, o.aboveDisplayed)} disabled={busy} variant={o.aboveDisplayed ? 'ghost' : 'primary'} />
            </View>
          ))}
        </>
      )}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  stepButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  amount: { fontSize: typography.sizes.xl, fontWeight: '700', color: colors.night, minWidth: 120, textAlign: 'center', fontVariant: ['tabular-nums'] },
  offer: { gap: spacing.xs, padding: spacing.sm, borderRadius: 12, backgroundColor: colors.mist },
  offerAbove: { borderWidth: 1, borderColor: colors.warning },
  offerTitle: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  warning: { fontSize: typography.sizes.xs, color: colors.warning, fontWeight: '700' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  consentText: { flex: 1, fontSize: typography.sizes.xs, color: colors.ink },
});
