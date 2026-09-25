import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { StyleSheet, Text, View } from 'react-native';
import type { MapLabels, MapPoint } from './RideMap';

/**
 * Version web (démonstration dans un navigateur) : `react-native-maps` n'existe pas sur le web ; les points restent
 * affichés en clair, la carte interactive est celle des applications iOS et Android.
 */
export function RideMap({ origin, destination, labels, height = 120 }: { origin: MapPoint; destination: MapPoint; stops?: MapPoint[]; labels: MapLabels; height?: number }) {
  const line = (label: string, p: MapPoint) => `${label} : ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  return (
    <View style={[styles.wrap, { minHeight: height }]} accessibilityLabel={labels.unavailable}>
      <Text style={styles.title}>{labels.unavailable}</Text>
      <Text style={styles.line}>{line(labels.origin, origin)}</Text>
      <Text style={styles.line}>{line(labels.destination, destination)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, backgroundColor: colors.tint, padding: spacing.md, gap: spacing.xs, justifyContent: 'center' },
  title: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.blueDark },
  line: { fontSize: typography.sizes.xs, color: colors.ink, fontVariant: ['tabular-nums'] },
});
