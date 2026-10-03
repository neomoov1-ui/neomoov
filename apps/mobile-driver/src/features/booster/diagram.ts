/**
 * Schéma de carrosserie de la vérification sommaire (Neomoov Booster), sans React Native (testé par vitest) : véhicule
 * vu de dessus, avant en haut (le côté gauche du véhicule est à gauche du schéma), une forme par zone de carrosserie du
 * domaine, et pour chaque photo du parcours guidé l'endroit où se placer et la direction à viser. Coordonnées dans le
 * repère du véhicule (`CAR_VIEWBOX`) ; le schéma des consignes ajoute une marge autour (`GUIDE_VIEWBOX`).
 */
import { BODY_ZONES, type BodyZone, type PhotoKind } from '@neomoov/domain';

export interface Point {
  x: number;
  y: number;
}

/** Repère du véhicule seul : 200 de large, 360 de long. */
export const CAR_VIEWBOX = { x: 0, y: 0, width: 200, height: 360 } as const;

/** Repère des consignes : le véhicule et une marge où se tient la personne qui photographie. */
export const GUIDE_VIEWBOX = { x: -70, y: -60, width: 340, height: 480 } as const;

export function viewBoxOf(box: { x: number; y: number; width: number; height: number }): string {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

/** Silhouette du véhicule (contour), coins arrondis. */
export const CAR_OUTLINE = 'M60 14 Q100 2 140 14 Q166 30 170 60 L170 305 Q166 335 140 348 Q100 358 60 348 Q34 335 30 305 L30 60 Q34 30 60 14 Z';

/** Roues (rectangles dépassant de la silhouette), de l'avant gauche à l'arrière droit. */
export const WHEELS = {
  front_left: { x: 20, y: 68, width: 12, height: 40 },
  front_right: { x: 168, y: 68, width: 12, height: 40 },
  rear_left: { x: 20, y: 258, width: 12, height: 40 },
  rear_right: { x: 168, y: 258, width: 12, height: 40 },
} as const;
export type WheelPosition = keyof typeof WHEELS;

/**
 * Zones de carrosserie : coins avant et arrière (aile, phare ou feu, pare-chocs), pare-brise, toit, lunette arrière,
 * flancs (portières). Les formes se touchent sans se chevaucher ; `label` : point d'ancrage d'un repère.
 */
export const BODY_ZONE_SHAPES: Readonly<Record<BodyZone, { path: string; label: Point }>> = {
  front_left: { path: 'M30 100 L30 60 Q34 30 60 14 L100 8 L100 100 Z', label: { x: 65, y: 60 } },
  front_right: { path: 'M170 100 L170 60 Q166 30 140 14 L100 8 L100 100 Z', label: { x: 135, y: 60 } },
  windshield: { path: 'M48 100 L152 100 L140 140 L60 140 Z', label: { x: 100, y: 120 } },
  roof: { path: 'M60 140 L140 140 L140 235 L60 235 Z', label: { x: 100, y: 188 } },
  rear_window: { path: 'M60 235 L140 235 L152 270 L48 270 Z', label: { x: 100, y: 252 } },
  left_side: { path: 'M30 100 L48 100 L60 140 L60 235 L48 270 L30 270 Z', label: { x: 42, y: 185 } },
  right_side: { path: 'M170 100 L152 100 L140 140 L140 235 L152 270 L170 270 Z', label: { x: 158, y: 185 } },
  rear_left: { path: 'M30 270 L100 270 L100 354 L60 348 Q34 335 30 305 Z', label: { x: 65, y: 310 } },
  rear_right: { path: 'M170 270 L100 270 L100 354 L140 348 Q166 335 170 305 Z', label: { x: 135, y: 310 } },
};

/** Ordre de lecture des zones (lecteur d'écran, liste sous le schéma) : de l'avant vers l'arrière, gauche puis droite. */
export const ZONE_READING_ORDER: readonly BodyZone[] = ['front_left', 'front_right', 'windshield', 'left_side', 'roof', 'right_side', 'rear_window', 'rear_left', 'rear_right'];

/**
 * Point de vue d'une photo du parcours : où se tenir (`camera`, hors du véhicule pour les vues extérieures), vers où
 * viser (`target`), zones et roue qui doivent figurer sur la photo. Le tableau de bord se photographie depuis le siège du
 * conducteur (à gauche au Québec).
 */
export interface Viewpoint {
  camera: Point;
  target: Point;
  zones: readonly BodyZone[];
  wheel: WheelPosition | null;
  interior: boolean;
}

export const PHOTO_VIEWPOINTS: Readonly<Partial<Record<PhotoKind, Viewpoint>>> = {
  front_left: { camera: { x: -40, y: -30 }, target: { x: 62, y: 62 }, zones: ['front_left'], wheel: 'front_left', interior: false },
  front_right: { camera: { x: 240, y: -30 }, target: { x: 138, y: 62 }, zones: ['front_right'], wheel: 'front_right', interior: false },
  rear_left: { camera: { x: -40, y: 390 }, target: { x: 62, y: 305 }, zones: ['rear_left'], wheel: 'rear_left', interior: false },
  rear_right: { camera: { x: 240, y: 390 }, target: { x: 138, y: 305 }, zones: ['rear_right'], wheel: 'rear_right', interior: false },
  left_side: { camera: { x: -55, y: 185 }, target: { x: 32, y: 185 }, zones: ['left_side'], wheel: null, interior: false },
  right_side: { camera: { x: 255, y: 185 }, target: { x: 168, y: 185 }, zones: ['right_side'], wheel: null, interior: false },
  windshield: { camera: { x: 100, y: -50 }, target: { x: 100, y: 112 }, zones: ['windshield'], wheel: null, interior: false },
  dashboard: { camera: { x: 76, y: 190 }, target: { x: 76, y: 112 }, zones: [], wheel: null, interior: true },
  tires: { camera: { x: -50, y: 88 }, target: { x: 24, y: 88 }, zones: [], wheel: 'front_left', interior: false },
};

/** Le point est-il dans le rectangle englobant de la silhouette (avec une tolérance) ? */
export function insideCar(point: Point, tolerance = 0): boolean {
  return point.x >= 30 - tolerance && point.x <= 170 + tolerance && point.y >= 2 - tolerance && point.y <= 358 + tolerance;
}

/**
 * Flèche de visée : segment de la position de la personne vers la cible, raccourci de `gap` à l'arrivée, et pointe en
 * triangle (trois points « x,y » séparés par des espaces, pour un polygone SVG).
 */
export function aimArrow(from: Point, to: Point, gap = 10, head = 12): { line: { x1: number; y1: number; x2: number; y2: number }; head: string } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const tip = { x: to.x - ux * gap, y: to.y - uy * gap };
  const base = { x: tip.x - ux * head, y: tip.y - uy * head };
  const half = head / 2;
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    line: { x1: round(from.x), y1: round(from.y), x2: round(base.x), y2: round(base.y) },
    head: [tip, left, right].map((p) => `${round(p.x)},${round(p.y)}`).join(' '),
  };
}

/** Bascule d'une zone dans la sélection, dans l'ordre du domaine (le rapport liste les zones toujours dans le même ordre). */
export function toggleZone(selected: readonly BodyZone[], zone: BodyZone): BodyZone[] {
  const set = new Set(selected);
  if (set.has(zone)) set.delete(zone);
  else set.add(zone);
  return BODY_ZONES.filter((z) => set.has(z));
}
