import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * Version web (démonstration dans un navigateur) : `react-native-maps` n'existe pas sur le web ; les points restent
 * affichés en clair, la carte interactive est celle des applications iOS et Android.
 */
export function RideMap({ origin, destination, driver, height = 160 }: { origin: MapPoint | null; destination: MapPoint | null; driver?: MapPoint | null; height?: number }) {
  const { t } = useTranslation();
  const line = (label: string, p: MapPoint | null | undefined) => (p ? `${label} : ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : null);
  const lines = [line(t('book.from'), origin), line(t('book.to'), destination), line(t('ride.driverPosition'), driver)].filter(Boolean);
  return (
    <View style={[styles.wrap, { minHeight: height }]} accessibilityLabel={t('ride.mapUnavailable')}>
      <Text style={styles.title}>{t('ride.mapUnavailable')}</Text>
      {lines.map((l) => (
        <Text key={l} style={styles.line}>{l}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, backgroundColor: colors.tint, padding: spacing.md, gap: spacing.xs, justifyContent: 'center' },
  title: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.blueDark },
  line: { fontSize: typography.sizes.xs, color: colors.ink, fontVariant: ['tabular-nums'] },
});
