import type { RidePreferences } from '@neomoov/domain';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

/** Préférences du client en pastilles (offre et fiche de course) ; les valeurs « indifférent » ne sont pas affichées. */
export function PreferenceChips({ preferences }: { preferences: RidePreferences | null }) {
  const { t } = useTranslation();
  if (!preferences) return null;
  const chips: string[] = [];
  if (preferences.conversation !== 'indifferent') chips.push(t(`prefs.conversation.${preferences.conversation}`));
  if (preferences.music !== 'indifferent') chips.push(preferences.musicGenre ? `${t(`prefs.music.${preferences.music}`)} (${preferences.musicGenre})` : t(`prefs.music.${preferences.music}`));
  if (preferences.temperature !== 'neutral') chips.push(t(`prefs.temperature.${preferences.temperature}`));
  if (preferences.luggageHelp) chips.push(t('prefs.luggageHelp'));
  if (preferences.luggageCount) chips.push(t('prefs.luggage', { count: preferences.luggageCount }));
  if (preferences.childSeat) chips.push(t('prefs.childSeat'));
  if (preferences.accessibility) chips.push(t('prefs.accessibility'));
  if (preferences.driverLanguage) chips.push(t('prefs.language', { language: preferences.driverLanguage.toUpperCase() }));
  if (!chips.length) return null;
  return (
    <View style={styles.row}>
      {chips.map((c) => (
        <Text key={c} style={styles.chip}>{c}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.tint, color: colors.blueDark, fontSize: typography.sizes.sm, fontWeight: '600', overflow: 'hidden' },
});
