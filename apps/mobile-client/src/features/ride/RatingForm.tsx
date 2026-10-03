import type { RideView } from '@neomoov/domain';
import { RATING_TAGS } from '@neomoov/domain';
import { Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, spacing } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Choices, ErrorState, Notice, SectionTitle, ToggleChip } from '@/components/ui';
import { errorMessage, offlineQueue } from '@/lib/api';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useAppConfig } from '@/lib/queries';

const POSITIVE = RATING_TAGS.slice(0, 6);
const NEGATIVE = RATING_TAGS.slice(6);

/** Fin de course : note, étiquettes (positives à 4 étoiles et plus, sinon à améliorer), pourboire suggéré, commentaire. */
export function RatingForm({ ride }: { ride: RideView }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const config = useAppConfig();
  const tips = config.data?.tips.suggestedCents ?? [0];
  const [score, setScore] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [tip, setTip] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offered = score >= 4 ? POSITIVE : NEGATIVE;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const body = { score, tags: tags.filter((tag) => (offered as readonly string[]).includes(tag)), ...(tip > 0 ? { tipCents: tip } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) };
      const result = await offlineQueue.send<RideView>('POST', `/rides/${ride.id}/rate`, body);
      if (result.status === 'sent') queryClient.setQueryData(keys.ride(ride.id), result.result);
      else setQueued(true);
      await queryClient.invalidateQueries({ queryKey: keys.rides });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (queued) return <Notice tone="warning">{t('ride.ratingQueued')}</Notice>;
  return (
    <Card style={styles.card}>
      <SectionTitle>{t('ride.rate')}</SectionTitle>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={t('ride.rate')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: n === score }} accessibilityLabel={`${n} / 5`} onPress={() => setScore(n)} style={styles.star}>
            <Ionicons name={n <= score ? 'star' : 'star-outline'} size={36} color={n <= score ? colors.warning : colors.muted} />
          </Pressable>
        ))}
      </View>
      <View style={styles.tags}>
        {offered.map((tag) => {
          const on = tags.includes(tag);
          return (
            <ToggleChip key={tag} label={t(`ride.tags.${tag}`)} checked={on} onToggle={() => setTags((list) => (on ? list.filter((x) => x !== tag) : [...list, tag].slice(0, 5)))} />
          );
        })}
      </View>
      <Choices label={t('ride.tip')} value={tip} onChange={setTip} options={tips.map((cents) => ({ value: cents, label: cents === 0 ? t('ride.tipNone') : formatMoney(cents, language) }))} />
      <Field label={t('ride.comment')} value={comment} onChangeText={setComment} multiline maxLength={500} />
      <Button label={t('ride.sendRating')} onPress={() => void send()} disabled={busy} />
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
