import { CLIENT_RATING_TAGS, type DriverRideView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, spacing } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Notice, Row, SectionTitle } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { endOfRidePending } from '@/features/ride/steps';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';

const POSITIVE = CLIENT_RATING_TAGS.slice(0, 4);
const NEGATIVE = CLIENT_RATING_TAGS.slice(4);

/**
 * Fin de course (6.2) : montant et mode de paiement (de l'API), confirmation du montant reçu en paiement direct (un
 * écart ouvre un incident côté API), évaluation du client. Faite à l'arrêt : c'est la seule saisie de la course.
 */
export function EndOfRide({ ride }: { ride: DriverRideView }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const money = (cents: number) => formatMoney(cents, language);
  const pending = endOfRidePending(ride);
  const [other, setOther] = useState('');
  const [score, setScore] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offered = score >= 4 ? POSITIVE : NEGATIVE;

  async function run(action: () => Promise<DriverRideView>) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(keys.ride(ride.id), await action());
      await queryClient.invalidateQueries({ queryKey: keys.home });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const confirm = (cents: number) => run(() => api.driver.paymentReceived(ride.id, cents));
  const rate = () => run(() => api.driver.rateClient(ride.id, { score, tags: tags.filter((tag) => (offered as readonly string[]).includes(tag)) as typeof CLIENT_RATING_TAGS[number][], ...(comment.trim() ? { comment: comment.trim() } : {}) }));
  const otherCents = Math.round(Number.parseFloat(other.replace(',', '.')) * 100);
  const total = ride.finalPriceCents ?? ride.quote.totalCents;

  return (
    <Card style={styles.card}>
      <SectionTitle>{t('ride.end.title')}</SectionTitle>
      <Row label={t('ride.end.total')} value={money(total)} strong />
      <Body>{t('ride.end.method', { method: t(`methods.${ride.paymentMethod}`) })}</Body>
      <Body muted>{t('ride.fare', { amount: money(ride.job.driverFareCents) })}</Body>
      <Body muted>{t('ride.end.invoice')}</Body>

      {ride.job.payment.direct && ride.job.payment.confirmedCents !== null ? <Notice tone="success">{t('ride.end.received', { amount: money(ride.job.payment.confirmedCents) })}</Notice> : null}
      {pending.payment && ride.job.payment.amountDueCents !== null ? (
        <View style={styles.block}>
          <SectionTitle>{t('ride.end.confirmTitle')}</SectionTitle>
          <Button label={t('ride.end.confirmExact', { amount: money(ride.job.payment.amountDueCents) })} onPress={() => void confirm(ride.job.payment.amountDueCents!)} disabled={busy} testID="confirm-received" />
          <Field label={t('ride.end.otherAmount')} value={other} onChangeText={setOther} keyboardType="decimal-pad" maxLength={8} />
          <Button label={t('ride.end.confirmOther')} variant="ghost" onPress={() => void confirm(otherCents)} disabled={busy || !Number.isFinite(otherCents) || otherCents < 0} />
        </View>
      ) : null}

      {pending.rating ? (
        <View style={styles.block}>
          <SectionTitle>{t('ride.end.rateTitle')}</SectionTitle>
          <View style={styles.stars} accessibilityRole="adjustable" accessibilityValue={{ min: 1, max: 5, now: score }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} / 5`} onPress={() => setScore(n)} hitSlop={6} testID={`star-${n}`}>
                <Ionicons name={n <= score ? 'star' : 'star-outline'} size={36} color={n <= score ? colors.warning : colors.muted} />
              </Pressable>
            ))}
          </View>
          <View style={styles.tags}>
            {offered.map((tag) => {
              const on = tags.includes(tag);
              return <Choices key={tag} value={on ? tag : null} onChange={() => setTags((list) => (on ? list.filter((x) => x !== tag) : [...list, tag].slice(0, 5)))} options={[{ value: tag, label: t(`ride.end.tags.${tag}`) }]} />;
            })}
          </View>
          <Field label={t('ride.end.comment')} value={comment} onChangeText={setComment} multiline maxLength={500} />
          <Button label={t('ride.end.sendRating')} onPress={() => void rate()} disabled={busy} testID="rate-client" />
        </View>
      ) : ride.job.clientRated ? (
        <Notice tone="success">{t('ride.end.rated')}</Notice>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  block: { gap: spacing.sm, marginTop: spacing.sm },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
