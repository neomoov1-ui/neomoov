import { Body, Card } from '@neomoov/mobile-core/components';
import { colors, spacing } from '@neomoov/mobile-core/theme';
import { Empty, ErrorState, Loading, Row, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { formatDateTime, type UiLanguage } from '@/lib/format';
import { useLoyalClients } from '@/lib/queries';

/** Mes clients (D38) : les clients qui ont mis le chauffeur en favori ou qui le redemandent, prénom seulement. */
export default function LoyalClientsScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const clients = useLoyalClients();
  return (
    <Screen back title={t('loyal.title')} onRefresh={() => void clients.refetch()} refreshing={clients.isRefetching}>
      <Body muted>{t('loyal.intro')}</Body>
      {clients.isLoading ? <Loading /> : null}
      {clients.error ? <ErrorState message={errorMessage(clients.error)} onRetry={() => void clients.refetch()} /> : null}
      {(clients.data ?? []).map((c) => (
        <Card key={c.clientId} style={styles.card}>
          <View style={styles.head}>
            {c.favourite ? <Ionicons name="heart" size={18} color={colors.danger} /> : null}
            <Row label={c.firstName ?? t('loyal.anonymous')} value={t('loyal.rides', { count: c.ridesCount })} strong />
          </View>
          {c.favouriteSince ? <Body muted>{t('loyal.favourite', { date: formatDateTime(c.favouriteSince, language) })}</Body> : null}
          {c.lastRideAt ? <Body muted>{t('loyal.lastRide', { date: formatDateTime(c.lastRideAt, language) })}</Body> : null}
        </Card>
      ))}
      {clients.isFetched && !(clients.data ?? []).length ? <Empty message={t('loyal.none')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
