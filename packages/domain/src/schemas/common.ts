/** Primitives Zod partagées par tous les schémas. */
import { z } from 'zod';

export const cents = z.number().int().min(0).describe('Montant en cents');
export const signedCents = z.number().int().describe('Montant signé en cents');
export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const phoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Numéro au format E.164 attendu, par exemple +15145550142');
export const localDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');
