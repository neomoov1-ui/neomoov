import { Body, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { errorMessage } from '@/lib/api';
import { useScore } from '@/lib/queries';

/**
 * Tableau de conduite (6.2) : ponctualité, note, annulations, accélérations et freinages brusques mesurés côté serveur à
 * partir des positions, suggestions ; mis à jour chaque jour.
 */
export default function ScoreScreen() {
  const { t, i18n } = useTranslation();
  const score = useScore();
  const data = score.data;
  const decimal = (n: number) => new Intl.NumberFormat(i18n.language === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 2 }).format(n);
  return (
    <Screen back title={t('score.title')} onRefresh={() => void score.refetch()} refreshing={score.isRefetching}>
      {score.isLoading ? <Loading /> : null}
      {score.error ? <ErrorState message={errorMessage(score.error)} onRetry={() => void score.refetch()} /> : null}
      {data ? (
        <>
          <Body muted>{`${t('score.period', { from: data.periodStart, to: data.periodEnd })} · ${t('score.updatedDaily')}`}</Body>
          <Card style={styles.card}>
            <Row label={t('score.rating')} value={data.rating !== null ? `${decimal(data.rating)} (${t('score.ratingCount', { count: data.ratingCount })})` : t('score.noRating')} strong />
            <Row label={t('score.punctuality')} value={`${data.punctualityPct} %`} />
            <Row label={t('score.cancellations')} value={String(data.cancellationCount)} />
            <Row label={t('score.accelerations')} value={String(data.harshAccelerations)} />
            <Row label={t('score.brakings')} value={String(data.harshBrakings)} />
            <Row label={t('score.distance')} value={`${decimal(data.distanceKm)} km`} />
            <Row label={t('score.completed')} value={String(data.completedRides)} />
          </Card>
          <SectionTitle>{t('score.suggestionsTitle')}</SectionTitle>
          {data.suggestions.map((s) => (
            <Notice key={s} tone={s === 'keep_it_up' ? 'success' : 'warning'}>{t(`score.suggestions.${s}`)}</Notice>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.xs } });
