import type { QuoteView } from '@neomoov/domain';
import { colors, spacing } from '@neomoov/mobile-core/theme';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { priceRows } from '@/features/booking/logic';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { Row } from './ui';

/**
 * Détail du prix dépliable (écran 2 sur 3) : les lignes de l'API, dans son ordre, traduites par leur code ; aucun
 * calcul ici, le total affiché est `amountDueCents` de l'API (identique au centime).
 */
export function PriceBreakdown({ quote, initiallyOpen = false }: { quote: Pick<QuoteView, 'lines' | 'amountDueCents'>; initiallyOpen?: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const rows = priceRows(quote);
  return (
    <View style={styles.box}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} hitSlop={8}>
        <Text style={styles.toggle}>{open ? t('category.hideDetails') : t('category.showDetails')}</Text>
      </Pressable>
      {open ? (
        <View style={styles.lines}>
          {rows.map((row, index) => (
            <Row key={`${row.code}-${index}`} label={t(`category.lines.${row.code}`, { defaultValue: row.fallbackLabel })} value={formatMoney(row.amountCents, language)} />
          ))}
          <View style={styles.separator} />
          <Row label={t('category.amountDue')} value={formatMoney(quote.amountDueCents, language)} strong />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  toggle: { color: colors.blueDark, fontWeight: '700', paddingVertical: spacing.xs },
  lines: { gap: 2 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
});
