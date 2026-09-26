import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  adminListQuerySchema, documentReviewSchema, leadInputSchema, settingUpdateSchema, maskDocumentNumber, maskEmail, maskPhone, maskTaxNumber, pageOf, polygonGeometrySchema,
  segmentsIntersect, validateRing, type Position,
} from '../src/index.js';

const square: Position[] = [[-73.6, 45.5], [-73.5, 45.5], [-73.5, 45.6], [-73.6, 45.6], [-73.6, 45.5]];

describe('polygones des zones', () => {
  it('accepte un anneau fermé simple', () => {
    expect(validateRing(square)).toEqual({ valid: true });
    expect(validateRing([[-73.6, 45.5], [-73.5, 45.5], [-73.55, 45.6], [-73.6, 45.5]])).toEqual({ valid: true });
  });

  it('refuse trop peu de points, un anneau ouvert, des coordonnées hors bornes, des sommets répétés', () => {
    expect(validateRing(square.slice(0, 3))).toEqual({ valid: false, reason: 'too_few_points' });
    expect(validateRing(square.slice(0, 4))).toEqual({ valid: false, reason: 'not_closed' });
    expect(validateRing([[-200, 45.5], [-73.5, 45.5], [-73.5, 45.6], [-200, 45.5]])).toEqual({ valid: false, reason: 'out_of_range' });
    expect(validateRing([[-73.6, 95], [-73.5, 45.5], [-73.5, 45.6], [-73.6, 95]])).toEqual({ valid: false, reason: 'out_of_range' });
    expect(validateRing([[Number.NaN, 45.5], [-73.5, 45.5], [-73.5, 45.6], [Number.NaN, 45.5]]).valid).toBe(false);
    expect(validateRing([[-73.6, 45.5], [-73.5, 45.5], [-73.5, 45.5], [-73.6, 45.6], [-73.6, 45.5]])).toEqual({ valid: false, reason: 'duplicate_points' });
  });

  it('refuse un polygone qui se croise (nœud papillon) ou dont deux arêtes se recouvrent', () => {
    const bowtie: Position[] = [[-73.6, 45.5], [-73.5, 45.6], [-73.5, 45.5], [-73.6, 45.6], [-73.6, 45.5]];
    expect(validateRing(bowtie)).toEqual({ valid: false, reason: 'self_intersecting', segments: [0, 2] });
    // Pointe qui revient sur une arête : recouvrement colinéaire.
    const spike: Position[] = [[0, 0], [4, 0], [4, 4], [2, 0.0], [0, 4], [0, 0]].map(([x, y]) => [x!, y!] as const);
    expect(validateRing(spike).valid).toBe(false);
  });

  it('intersections de segments, y compris les cas colinéaires', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 3])).toBe(false);
    expect(segmentsIntersect([0, 0], [2, 0], [1, 0], [3, 0])).toBe(true);
    expect(segmentsIntersect([1, 0], [3, 0], [0, 0], [2, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [3, 0], [1, 0], [2, 0])).toBe(true);
    expect(segmentsIntersect([1, 0], [2, 0], [0, 0], [3, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
  });
});

describe('masquage des données sensibles', () => {
  it('téléphone, courriel, numéros de taxes et de documents', () => {
    expect(maskPhone('+15145550123')).toBe('+1 514 •••-0123');
    expect(maskPhone('+33612345678')).toBe('+•••••••5678');
    expect(maskPhone('+12345')).toBe('•••••');
    expect(maskPhone(null)).toBeNull();
    expect(maskEmail('awa.diallo@exemple.ca')).toBe('a•••@exemple.ca');
    expect(maskEmail('sans-arobase')).toBe('•••');
    expect(maskEmail(undefined)).toBeNull();
    expect(maskTaxNumber('123456789 RT0001')).toBe('•••••6789 RT0001');
    expect(maskTaxNumber('1234567890TQ0001')).toBe('••••••7890 TQ0001');
    expect(maskTaxNumber('ABC12')).toBe('•BC12');
    expect(maskTaxNumber('')).toBeNull();
    expect(maskDocumentNumber('D1234-567890-12')).toBe('••••••••••••-12');
    expect(maskDocumentNumber('AB')).toBe('••');
    expect(maskDocumentNumber(null)).toBeNull();
  });
});

describe('schémas de My Hub et de l\'API publique', () => {
  it('pagination, revue de document, polygone, prospect', () => {
    expect(adminListQuerySchema.parse({ page: '2' })).toEqual({ page: 2, pageSize: 25 });
    expect(settingUpdateSchema.safeParse({ value: 30 }).success).toBe(true);
    expect(settingUpdateSchema.safeParse({}).success).toBe(false);
    const page = pageOf(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: 'a' }], total: 1, page: 1, pageSize: 25 }).total).toBe(1);
    expect(documentReviewSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(documentReviewSchema.safeParse({ decision: 'rejected', reason: 'Illisible' }).success).toBe(true);
    expect(documentReviewSchema.safeParse({ decision: 'approved' }).success).toBe(true);
    expect(polygonGeometrySchema.safeParse({ type: 'Polygon', coordinates: [square] }).success).toBe(true);
    expect(polygonGeometrySchema.safeParse({ type: 'Polygon', coordinates: [square.slice(0, 3)] }).success).toBe(false);
    expect(leadInputSchema.safeParse({ kind: 'driver', firstName: 'Awa', phone: '+15145550123', antiBotToken: 'x', consent: true }).success).toBe(true);
    expect(leadInputSchema.safeParse({ kind: 'driver', firstName: 'Awa', phone: '+15145550123', antiBotToken: 'x', consent: false }).success).toBe(false);
  });
});
