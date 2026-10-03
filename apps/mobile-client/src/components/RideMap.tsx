import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { isInsideRegion, type MapRegion } from '@/features/ride/map-logic';

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * Carte du trajet (iOS et Android) : départ, destination et, pendant la course, la position du chauffeur. Cadrée sur les
 * points connus quand le départ ou la destination change ; la position du chauffeur ne recadre la carte qu'à sa première
 * apparition puis quand il approche du bord de la zone affichée (revue du 2 octobre 2026, constat mobile 16) : la carte
 * déplacée par le client reste où il l'a mise, et le bouton « Recentrer » la cadre de nouveau. Le web a sa propre
 * version (`RideMap.web.tsx`).
 */
export function RideMap({ origin, destination, driver, height = 220 }: { origin: MapPoint | null; destination: MapPoint | null; driver?: MapPoint | null; height?: number }) {
  const { t } = useTranslation();
  const map = useRef<MapView>(null);
  const region = useRef<MapRegion | null>(null);
  const driverFramed = useRef(false);
  const points = [origin, destination, driver ?? null].filter((p): p is MapPoint => p !== null);

  function frame(targets: MapPoint[]) {
    if (!map.current || targets.length === 0) return;
    map.current.fitToCoordinates(targets.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
  }

  // Départ ou destination changés (adresse choisie, course ouverte) : cadrage sur tous les points connus.
  useEffect(() => {
    frame(points);
    driverFramed.current = Boolean(driver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  // Chauffeur qui avance : recadrage seulement s'il n'a pas encore été cadré ou s'il approche du bord de la zone.
  useEffect(() => {
    if (!driver) {
      driverFramed.current = false;
      return;
    }
    if (driverFramed.current && (!region.current || isInsideRegion(driver, region.current))) return;
    driverFramed.current = true;
    frame(points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.lat, driver?.lng]);

  const initial = points[0] ?? { lat: 45.5019, lng: -73.5674 };
  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={map}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        onRegionChangeComplete={(next) => {
          region.current = next;
        }}
        showsUserLocation={false}
        accessibilityLabel={t('book.title')}
      >
        {origin ? <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title={t('book.from')} pinColor={colors.green} /> : null}
        {destination ? <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title={t('book.to')} pinColor={colors.blue} /> : null}
        {driver ? <Marker coordinate={{ latitude: driver.lat, longitude: driver.lng }} title={t('ride.driverPosition')} pinColor={colors.night} /> : null}
      </MapView>
      {points.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ride.recenter')} onPress={() => frame(points)} style={styles.recenter}>
          <Text style={styles.recenterText}>{t('ride.recenter')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.tint },
  // Cible d'au moins 44 points de haut (accessibilité).
  recenter: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recenterText: { color: colors.ink, fontSize: typography.sizes.sm, fontWeight: '700' },
});
