import { BODY_ZONES, INSPECTION_PHOTO_STEPS } from '@neomoov/domain';
import { withLanguage } from '@neomoov/mobile-core/format';
import { describe, expect, it } from 'vitest';
import { aimArrow, BODY_ZONE_SHAPES, CAR_OUTLINE, GUIDE_VIEWBOX, insideCar, PHOTO_VIEWPOINTS, toggleZone, viewBoxOf, ZONE_READING_ORDER } from '../src/features/booster/diagram';
import { fleetInvitationError, fleetInvitationToken, isFleetInvitationToken } from '../src/features/fleet/invitation';
import { canDriverCancel } from '../src/features/ride/steps';

describe('invitation de flotte (étape 23)', () => {
  const token = 'drv_AbC123xyz_-0987654321';

  it('jeton seul, lien entier du texto ou lien de l\'application : même jeton, casse gardée', () => {
    expect(fleetInvitationToken(` ${token} `)).toBe(token);
    expect(fleetInvitationToken(`Neomoov : https://hub.neomoov.net/chauffeurs/rejoindre?token=${encodeURIComponent(token)}`)).toBe(token);
    expect(fleetInvitationToken(`neomoov-driver://chauffeurs/rejoindre?lang=fr&token=${token}#x`)).toBe(token);
    expect(isFleetInvitationToken(token)).toBe(true);
  });

  it('refuse ce qui n\'est pas un jeton d\'invitation de chauffeur', () => {
    expect(isFleetInvitationToken('inv_AbC123xyz0987')).toBe(false);
    expect(isFleetInvitationToken('drv_court')).toBe(false);
    expect(isFleetInvitationToken('drv_avec espace dedans')).toBe(false);
    expect(isFleetInvitationToken(fleetInvitationToken('https://hub.neomoov.net/chauffeurs/rejoindre'))).toBe(false);
  });

  it('erreurs de l\'acceptation traduites par l\'écran, les autres laissées au message de l\'API', () => {
    expect(fleetInvitationError('INVITATION_NOT_FOR_YOU')).toBe('INVITATION_NOT_FOR_YOU');
    expect(fleetInvitationError('INVITATION_EXPIRED')).toBe('INVITATION_EXPIRED');
    expect(fleetInvitationError('RATE_LIMITED')).toBeNull();
    expect(fleetInvitationError(null)).toBeNull();
  });
});

describe('annulation par le chauffeur (revue du 2 octobre 2026 B)', () => {
  it('avant l\'arrivée toujours ; une fois arrivé seulement si le réglage le permet ; jamais pendant la course', () => {
    expect(canDriverCancel('assigned', false)).toBe(true);
    expect(canDriverCancel('en_route', false)).toBe(true);
    expect(canDriverCancel('arrived', false)).toBe(false);
    expect(canDriverCancel('arrived', true)).toBe(true);
    expect(canDriverCancel('in_progress', true)).toBe(false);
    expect(canDriverCancel('completed', true)).toBe(false);
  });
});

describe('schéma de carrosserie et consignes de photos (Booster)', () => {
  it('une forme fermée par zone du domaine, toutes dans l\'ordre de lecture', () => {
    expect(Object.keys(BODY_ZONE_SHAPES).sort()).toEqual([...BODY_ZONES].sort());
    expect([...ZONE_READING_ORDER].sort()).toEqual([...BODY_ZONES].sort());
    for (const zone of BODY_ZONES) {
      const { path, label } = BODY_ZONE_SHAPES[zone];
      expect(path.startsWith('M')).toBe(true);
      expect(path.endsWith('Z')).toBe(true);
      expect(insideCar(label)).toBe(true);
    }
    expect(CAR_OUTLINE.startsWith('M') && CAR_OUTLINE.endsWith('Z')).toBe(true);
  });

  it('gauche du véhicule à gauche du schéma, avant en haut', () => {
    expect(BODY_ZONE_SHAPES.front_left.label.x).toBeLessThan(BODY_ZONE_SHAPES.front_right.label.x);
    expect(BODY_ZONE_SHAPES.left_side.label.x).toBeLessThan(BODY_ZONE_SHAPES.right_side.label.x);
    expect(BODY_ZONE_SHAPES.windshield.label.y).toBeLessThan(BODY_ZONE_SHAPES.rear_window.label.y);
    expect(BODY_ZONE_SHAPES.front_left.label.y).toBeLessThan(BODY_ZONE_SHAPES.rear_left.label.y);
  });

  it('chaque photo du parcours a sa consigne : personne hors du véhicule (sauf le tableau de bord), dans le cadre du schéma', () => {
    for (const step of INSPECTION_PHOTO_STEPS) {
      const view = PHOTO_VIEWPOINTS[step.kind];
      expect(view, step.kind).toBeDefined();
      expect(insideCar(view!.camera)).toBe(view!.interior);
      expect(view!.camera.x).toBeGreaterThan(GUIDE_VIEWBOX.x);
      expect(view!.camera.x).toBeLessThan(GUIDE_VIEWBOX.x + GUIDE_VIEWBOX.width);
      expect(view!.camera.y).toBeGreaterThan(GUIDE_VIEWBOX.y);
      expect(view!.camera.y).toBeLessThan(GUIDE_VIEWBOX.y + GUIDE_VIEWBOX.height);
      for (const zone of view!.zones) expect(BODY_ZONES).toContain(zone);
    }
    // Une vue de coin cadre la zone du même nom et sa roue.
    expect(PHOTO_VIEWPOINTS.rear_right).toMatchObject({ zones: ['rear_right'], wheel: 'rear_right' });
    expect(viewBoxOf(GUIDE_VIEWBOX)).toBe('-70 -60 340 480');
  });

  it('flèche de visée : s\'arrête avant la cible, pointe dans la bonne direction', () => {
    const arrow = aimArrow({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 12);
    expect(arrow.line).toEqual({ x1: 0, y1: 0, x2: 78, y2: 0 });
    expect(arrow.head).toBe('90,0 78,6 78,-6');
    const vertical = aimArrow({ x: 100, y: -50 }, { x: 100, y: 112 });
    expect(vertical.line.x2).toBe(100);
    expect(vertical.line.y2).toBeLessThan(112);
  });

  it('sélection des zones : bascule, ordre du domaine', () => {
    expect(toggleZone([], 'roof')).toEqual(['roof']);
    expect(toggleZone(['roof'], 'front_left')).toEqual(['front_left', 'roof']);
    expect(toggleZone(['front_left', 'roof'], 'roof')).toEqual(['front_left']);
  });
});

describe('langue des pages web ouvertes depuis l\'application (constat mobile 25)', () => {
  it('ajoute ou remplace lang, avant le fragment', () => {
    expect(withLanguage('https://neomoov.net/carte?session=abc', 'en')).toBe('https://neomoov.net/carte?session=abc&lang=en');
    expect(withLanguage('https://neomoov.net/carte', 'fr-CA')).toBe('https://neomoov.net/carte?lang=fr');
    expect(withLanguage('https://neomoov.net/carte?lang=en&session=abc#haut', 'fr-CA')).toBe('https://neomoov.net/carte?session=abc&lang=fr#haut');
  });
});
