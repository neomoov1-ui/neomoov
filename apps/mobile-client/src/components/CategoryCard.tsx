import { colors, radius, shadows, spacing, typography } from '@neomoov/mobile-core/theme';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CategoryCard as Card } from '@/features/booking/logic';
import { formatMoney, type UiLanguage } from '@/lib/format';

/** Carte d'une catégorie (sélecteur de l'écran 2 sur 3) : nom, places, modèles garantis, prix total de l'API, arrivée. */
export function CategoryCard({ card, selected, onSelect }: { card: Card; selected: boolean; onSelect: () => void }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const models = card.models.slice(0, 3).join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${card.name}, ${formatMoney(card.quote.totalCents, language)}`}
      onPress={onSelect}
      style={[styles.card, selected && styles.selected]}
    >
      <View style={styles.top}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.price}>{formatMoney(card.quote.totalCents, language)}</Text>
      </View>
      <Text style={styles.meta}>
        {t('category.seats', { count: card.seats })}
        {' · '}
        {card.etaSeconds !== null ? t('category.eta', { minutes: Math.max(1, Math.round(card.etaSeconds / 60)) }) : t('category.onAvailability')}
      </Text>
      {models ? <Text style={styles.models}>{t('category.guaranteed', { models })}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, borderWidth: 2, borderColor: 'transparent', ...shadows.card },
  selected: { borderColor: colors.blue },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  name: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.night },
  price: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.blueDark, fontVariant: ['tabular-nums'] },
  meta: { fontSize: typography.sizes.sm, color: colors.ink },
  models: { fontSize: typography.sizes.xs, color: colors.muted },
});
