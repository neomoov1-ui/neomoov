import type { RideView } from '@neomoov/domain';
import { colors, radius, shadows, spacing, typography } from '@neomoov/mobile-core/theme';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';

/** Ligne d'une course (réservations à venir, historique) : date, trajet, état, prix. */
export function RideListItem({ ride }: { ride: RideView }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const price = ride.finalPriceCents ?? ride.negotiation?.agreedTotalCents ?? ride.quote.totalCents;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })} style={styles.item}>
      <Text style={styles.date}>{ride.requestedAt ? formatDateTime(ride.requestedAt, language) : t(`ride.states.${ride.state}`)}</Text>
      <Text style={styles.route} numberOfLines={2}>{`${ride.origin.address} → ${ride.destination.address}`}</Text>
      <Text style={styles.meta}>{`${t(`ride.states.${ride.state}`)} · ${formatMoney(price, language)}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, gap: 4, ...shadows.card },
  date: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.blueDark },
  route: { fontSize: typography.sizes.md, color: colors.night, fontWeight: '600' },
  meta: { fontSize: typography.sizes.xs, color: colors.muted },
});
