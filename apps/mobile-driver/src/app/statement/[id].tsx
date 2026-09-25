import { Body, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Row, Screen } from '@neomoov/mobile-core/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { useStatement } from '@/lib/queries';

/** Relevé hebdomadaire (5.8) : crédits, débits, net, statut du versement ; chaque ligne renvoie à sa course. */
export default function StatementScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const statement = useStatement(id);
  const data = statement.data;
  const money = (cents: number) => formatMoney(cents, language);
  return (
    <Screen back title={t('statement.title')} subtitle={data ? t('earnings.statementPeriod', { from: data.periodStart, to: data.periodEnd }) : undefined}>
      {statement.isLoading ? <Loading /> : null}
      {statement.error ? <ErrorState message={errorMessage(statement.error)} onRetry={() => void statement.refetch()} /> : null}
      {data ? (
        <>
          <Card style={styles.card}>
            <Row label={t('statement.credits')} value={money(data.creditsCents)} />
            <Row label={t('statement.debits')} value={money(data.debitsCents)} />
            <Row label={t('statement.net')} value={`${data.netCents < 0 ? '−' : ''}${money(Math.abs(data.netCents))}`} strong />
            <Body muted>{t(`statement.statuses.${data.status}`)}</Body>
          </Card>
          {!data.pdfAvailable ? <Notice>{t('statement.pdfSoon')}</Notice> : null}
          {data.lines.map((line, index) => (
            <Pressable key={`${line.kind}-${index}`} accessibilityRole={line.rideId ? 'button' : 'text'} disabled={!line.rideId} onPress={() => line.rideId && router.push({ pathname: '/ride/[id]', params: { id: line.rideId } })}>
              <Card style={styles.card}>
                <Row label={line.label} value={`${line.amountCents < 0 ? '−' : ''}${money(Math.abs(line.amountCents))}`} strong />
                <Body muted>{formatDateTime(line.occurredAt, language)}</Body>
                {line.rideId ? <Body muted>{t('statement.openRide')}</Body> : null}
              </Card>
            </Pressable>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.xs } });
