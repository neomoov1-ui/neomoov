import { colors, radius } from '@neomoov/mobile-core/theme';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * Carte du trajet (iOS et Android) : départ, destination et, pendant la course, la position du chauffeur, cadrée sur
 * les points connus. Le web a sa propre version (`RideMap.web.tsx`).
 */
export function RideMap({ origin, destination, driver, height = 220 }: { origin: MapPoint | null; destination: MapPoint | null; driver?: MapPoint | null; height?: number }) {
  const { t } = useTranslation();
  const map = useRef<MapView>(null);
  const points = [origin, destination, driver ?? null].filter((p): p is MapPoint => p !== null);

  useEffect(() => {
    if (!map.current || points.length === 0) return;
    map.current.fitToCoordinates(points.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    // Recadrage quand un point change (nouvelle adresse, chauffeur qui avance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, driver?.lat, driver?.lng]);

  const initial = points[0] ?? { lat: 45.5019, lng: -73.5674 };
  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={map}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        showsUserLocation={false}
        accessibilityLabel={t('book.title')}
      >
        {origin ? <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title={t('book.from')} pinColor={colors.green} /> : null}
        {destination ? <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title={t('book.to')} pinColor={colors.blue} /> : null}
        {driver ? <Marker coordinate={{ latitude: driver.lat, longitude: driver.lng }} title={t('ride.driverPosition')} pinColor={colors.night} /> : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.tint },
});
