import type { PilotReason, PilotScoreView } from '@neomoov/domain';
import { Body } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney, type UiLanguage } from '@/lib/format';

/** Couleurs du score Neomoov Pilote (vert : acceptée pour vous si activé ; jaune : à vous ; rouge : hors critères). */
export const SCORE_COLORS = { green: colors.green, yellow: colors.warning, red: colors.danger } as const;

const MONEY_REASONS = new Set(['fare_below_min', 'net_per_km_below_min', 'net_per_hour_below_min']);

/** Paramètres d'une raison prêts pour le texte : montants en cents mis en forme, listes jointes. */
export function reasonParams(reason: PilotReason, language: UiLanguage): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(reason.params ?? {})) {
    if (Array.isArray(value)) out[key] = value.join(', ');
    else if (typeof value === 'number' && MONEY_REASONS.has(reason.code)) out[key] = formatMoney(value, language);
    else out[key] = value;
  }
  return out;
}

/** Pastille du score sur une carte d'offre, avec ses raisons (compacte : la pastille seule). */
export function PilotBadge({ score, compact }: { score: PilotScoreView; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const colour = SCORE_COLORS[score.score];
  return (
    <View style={styles.block} accessibilityLabel={t('pilot.badge', { score: t(`pilot.scores.${score.score}`) })}>
      <View style={[styles.pill, { borderColor: colour }]} testID="pilot-badge">
        <View style={[styles.dot, { backgroundColor: colour }]} />
        <Text style={styles.pillText}>{t('pilot.badge', { score: t(`pilot.scores.${score.score}`) })}</Text>
        {score.autoAccept ? <Text style={styles.auto}>{t('pilot.autoAccepted')}</Text> : null}
      </View>
      {!compact ? <Body muted>{t(`pilot.decisionLabels.${score.decision}`)}</Body> : null}
      {!compact ? score.reasons.map((r, index) => <Body key={`${r.code}-${index}`} muted>{`· ${t(`pilot.reasons.${r.code}`, reasonParams(r, language))}`}</Body>) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', borderWidth: 2, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 36 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  pillText: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.night },
  auto: { fontSize: typography.sizes.xs, fontWeight: '700', color: colors.blueDark },
});
