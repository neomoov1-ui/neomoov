import type { PaymentChoice, QuoteView } from '@neomoov/domain';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { amountDueFor, priceRowsFor } from '@/features/booking/logic';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { Row } from './ui';

/**
 * Détail du prix dépliable (écran 2 sur 3) : les lignes de l'API, dans son ordre, traduites par leur code ; aucun
 * calcul ici, le total affiché est `amountDueCents` de l'API (identique au centime). Payée au chauffeur (`paymentChoice`),
 * la course est due en entier : la ligne des crédits est retirée et le total est `totalCents` (revue du 2 octobre 2026).
 */
export function PriceBreakdown({ quote, paymentChoice = null, initiallyOpen = false }: { quote: Pick<QuoteView, 'lines' | 'amountDueCents' | 'totalCents' | 'creditsPrepaidOnly' | 'creditsAppliedCents'>; paymentChoice?: PaymentChoice | null; initiallyOpen?: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const rows = priceRowsFor(quote, paymentChoice);
  const creditsWithheld = paymentChoice === 'pay_driver_after' && quote.creditsPrepaidOnly && quote.creditsAppliedCents > 0;
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
          <Row label={t('category.amountDue')} value={formatMoney(amountDueFor(quote, paymentChoice), language)} strong />
          {creditsWithheld ? <Text style={styles.note}>{t('category.creditsPrepaidOnly')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  toggle: { color: colors.blueDark, fontWeight: '700', paddingVertical: spacing.xs },
  lines: { gap: 2 },
  note: { color: colors.muted, fontSize: typography.sizes.xs },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
});
