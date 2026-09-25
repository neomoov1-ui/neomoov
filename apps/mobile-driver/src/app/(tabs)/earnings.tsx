import type { EarningsView } from '@neomoov/domain';
import { Body, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, Empty, ErrorState, Loading, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { useEarnings, useStatements } from '@/lib/queries';

/**
 * Revenus et relevés (6.2) : jour, semaine (lundi au dimanche, heure de Montréal) ou mois ; tarifs, pourboires, total ;
 * chaque ligne renvoie à sa course. Relevés hebdomadaires émis, chacun avec son détail. Tout est calculé par l'API.
 */
export default function EarningsScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const [period, setPeriod] = useState<EarningsView['period']>('week');
  const earnings = useEarnings({ period });
  const statements = useStatements();
  const money = (cents: number) => formatMoney(cents, language);
  const data = earnings.data;

  return (
    <Screen title={t('earnings.title')} onRefresh={() => void Promise.all([earnings.refetch(), statements.refetch()])} refreshing={earnings.isRefetching}>
      <Choices value={period} onChange={setPeriod} options={(['day', 'week', 'month'] as const).map((p) => ({ value: p, label: t(`earnings.periods.${p}`) }))} />
      {earnings.isLoading ? <Loading /> : null}
      {earnings.error ? <ErrorState message={errorMessage(earnings.error)} onRetry={() => void earnings.refetch()} /> : null}
      {data ? (
        <Card style={styles.card}>
          <Text style={styles.total} testID="earnings-total">{money(data.totals.totalCents)}</Text>
          <Row label={t('earnings.fare')} value={money(data.totals.fareCents)} />
          <Row label={t('earnings.tips')} value={money(data.totals.tipsCents)} />
          <Row label={t('earnings.rides')} value={String(data.totals.rides)} />
          {data.collectedDirectCents > 0 ? (
            <>
              <Row label={t('earnings.collectedDirect')} value={money(data.collectedDirectCents)} />
              <Body muted>{t('earnings.collectedDirectHint')}</Body>
            </>
          ) : null}
        </Card>
      ) : null}
      {data?.items.length ? <SectionTitle>{t('earnings.items')}</SectionTitle> : null}
      {data?.items.map((item) => (
        <Pressable key={`${item.rideId}-${item.kind}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.rideId } })}>
          <Card style={styles.item}>
            <Row label={formatDateTime(item.at, language)} value={money(item.fareCents + item.tipCents)} strong />
            <Body muted>{item.kind === 'cancellation_fee' ? t('earnings.cancellationFee') : `${item.publicNumber} · ${t(`methods.${item.paymentMethod}`)}`}</Body>
            {item.tipCents > 0 ? <Body muted>{`${t('earnings.tips')} : ${money(item.tipCents)}`}</Body> : null}
          </Card>
        </Pressable>
      ))}
      {data && !data.items.length ? <Empty message={t('earnings.none')} /> : null}

      <SectionTitle>{t('earnings.statements')}</SectionTitle>
      {statements.error ? <ErrorState message={errorMessage(statements.error)} /> : null}
      {(statements.data ?? []).map((s) => (
        <Pressable key={s.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/statement/[id]', params: { id: s.id } })}>
          <Card style={styles.item}>
            <Row label={t('earnings.statementPeriod', { from: s.periodStart, to: s.periodEnd })} value={money(Math.abs(s.netCents))} strong />
            <Body muted>{t(`statement.statuses.${s.status as 'issued'}`, { defaultValue: s.status })}</Body>
          </Card>
        </Pressable>
      ))}
      {statements.isFetched && !(statements.data ?? []).length ? <Empty message={t('earnings.noStatements')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  total: { fontSize: typography.sizes.xxl, fontWeight: '700', color: colors.night, fontVariant: ['tabular-nums'] },
  item: { gap: 2 },
});
