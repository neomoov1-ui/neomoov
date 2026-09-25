import { colors, radius } from '@neomoov/mobile-core/theme';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapLabels {
  origin: string;
  destination: string;
  unavailable: string;
}

/**
 * Carte de la course (iOS et Android) : prise en charge, arrêts, destination et position du chauffeur (point bleu du
 * système), cadrée sur les points. Masquée en mode économie de données. Le web a sa version (`RideMap.web.tsx`).
 */
export function RideMap({ origin, destination, stops = [], labels, height = 200 }: { origin: MapPoint; destination: MapPoint; stops?: MapPoint[]; labels: MapLabels; height?: number }) {
  const map = useRef<MapView>(null);
  const points = [origin, ...stops, destination];

  useEffect(() => {
    map.current?.fitToCoordinates(points.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, destination.lat, destination.lng, stops.length]);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={map}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: origin.lat, longitude: origin.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        showsUserLocation
        accessibilityLabel={`${labels.origin}, ${labels.destination}`}
      >
        <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title={labels.origin} pinColor={colors.green} />
        {stops.map((s, index) => (
          <Marker key={`${s.lat},${s.lng},${index}`} coordinate={{ latitude: s.lat, longitude: s.lng }} pinColor={colors.warning} />
        ))}
        <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title={labels.destination} pinColor={colors.blue} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.tint },
});
