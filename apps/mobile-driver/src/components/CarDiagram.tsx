import type { BodyZone, PhotoKind } from '@neomoov/domain';
import { colors } from '@neomoov/mobile-core/theme';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { aimArrow, BODY_ZONE_SHAPES, CAR_OUTLINE, CAR_VIEWBOX, GUIDE_VIEWBOX, PHOTO_VIEWPOINTS, viewBoxOf, WHEELS, ZONE_READING_ORDER } from '@/features/booster/diagram';

const DEFECT_FILL = '#FDE2E1';
const HIGHLIGHT_FILL = '#CFE7FB';

function Wheels({ highlight }: { highlight?: keyof typeof WHEELS | null }) {
  return (
    <G>
      {(Object.keys(WHEELS) as Array<keyof typeof WHEELS>).map((wheel) => (
        <Rect key={wheel} {...WHEELS[wheel]} rx={4} fill={highlight === wheel ? colors.blue : colors.night} />
      ))}
    </G>
  );
}

/**
 * Schéma de carrosserie vu de dessus (avant en haut) : chaque zone se touche pour signaler un défaut (rayure, bosse,
 * bris) ; les zones choisies sont en rouge. Le schéma est décoratif pour les lecteurs d'écran : la liste des zones sous
 * le schéma (mêmes bascules) reste la voie accessible.
 */
export function CarDiagram({ selected, onToggle, frontLabel, rearLabel }: { selected: readonly BodyZone[]; onToggle: (zone: BodyZone) => void; frontLabel: string; rearLabel: string }) {
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={300} viewBox={viewBoxOf({ x: CAR_VIEWBOX.x - 10, y: CAR_VIEWBOX.y - 24, width: CAR_VIEWBOX.width + 20, height: CAR_VIEWBOX.height + 48 })}>
        <SvgText x={100} y={-8} fontSize={12} fontWeight="bold" fill={colors.muted} textAnchor="middle">{frontLabel}</SvgText>
        <Wheels />
        {ZONE_READING_ORDER.map((zone) => {
          const on = selected.includes(zone);
          return (
            <Path key={zone} d={BODY_ZONE_SHAPES[zone].path} fill={on ? DEFECT_FILL : colors.white} stroke={on ? colors.danger : colors.border} strokeWidth={on ? 3 : 1.5} onPress={() => onToggle(zone)} testID={`zone-${zone}`} />
          );
        })}
        {ZONE_READING_ORDER.filter((zone) => selected.includes(zone)).map((zone) => (
          <Circle key={`mark-${zone}`} cx={BODY_ZONE_SHAPES[zone].label.x} cy={BODY_ZONE_SHAPES[zone].label.y} r={7} fill={colors.danger} onPress={() => onToggle(zone)} />
        ))}
        <Path d={CAR_OUTLINE} fill="none" stroke={colors.night} strokeWidth={2.5} />
        <SvgText x={100} y={376} fontSize={12} fontWeight="bold" fill={colors.muted} textAnchor="middle">{rearLabel}</SvgText>
      </Svg>
    </View>
  );
}

/**
 * Consigne illustrée d'une photo du parcours guidé : le véhicule vu de dessus, la partie à cadrer en bleu, la position
 * conseillée (point) et la direction de visée (flèche). Aucune image ni vidéo : un schéma dessiné à partir des données
 * de `diagram.ts`.
 */
export function PhotoGuide({ kind, label }: { kind: PhotoKind; label: string }) {
  const view = PHOTO_VIEWPOINTS[kind];
  if (!view) return null;
  const arrow = aimArrow(view.camera, view.target);
  return (
    <View style={styles.guide} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width="100%" height={170} viewBox={viewBoxOf(GUIDE_VIEWBOX)}>
        <Wheels highlight={view.wheel} />
        <Path d={CAR_OUTLINE} fill={colors.white} stroke={colors.night} strokeWidth={3} />
        {view.zones.map((zone) => (
          <Path key={zone} d={BODY_ZONE_SHAPES[zone].path} fill={HIGHLIGHT_FILL} stroke={colors.blue} strokeWidth={3} />
        ))}
        {view.interior ? <Rect x={44} y={100} width={112} height={18} rx={6} fill={HIGHLIGHT_FILL} stroke={colors.blue} strokeWidth={3} /> : null}
        <Line {...arrow.line} stroke={colors.blueDark} strokeWidth={5} strokeLinecap="round" />
        <Polygon points={arrow.head} fill={colors.blueDark} />
        <Circle cx={view.camera.x} cy={view.camera.y} r={14} fill={colors.blueDark} />
        <Circle cx={view.camera.x} cy={view.camera.y} r={6} fill={colors.white} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', backgroundColor: colors.mist, borderRadius: 14, paddingVertical: 8 },
  guide: { alignItems: 'center', backgroundColor: colors.mist, borderRadius: 14, paddingVertical: 4 },
});
