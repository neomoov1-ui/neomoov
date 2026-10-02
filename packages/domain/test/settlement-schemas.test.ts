import { describe, expect, it } from 'vitest';
import { statementReconcileSchema } from '../src/schemas/settlement.js';

/** Réconciliation d'un relevé sans réponse du prestataire (revue du 2 octobre 2026, constat 7). */
describe('schéma de réconciliation des relevés', () => {
  it('exige la référence du mouvement pour « executed », pas pour le rejeu ni pour « not_executed »', () => {
    expect(statementReconcileSchema.safeParse({ outcome: 'executed' }).success).toBe(false);
    expect(statementReconcileSchema.parse({ outcome: 'executed', reference: ' tr_123 ', note: 'vu dans Stripe' })).toEqual({ outcome: 'executed', reference: 'tr_123', note: 'vu dans Stripe' });
    expect(statementReconcileSchema.parse({ outcome: 'replay' })).toEqual({ outcome: 'replay' });
    expect(statementReconcileSchema.parse({ outcome: 'not_executed' })).toEqual({ outcome: 'not_executed' });
    expect(statementReconcileSchema.safeParse({ outcome: 'retry' }).success).toBe(false);
  });
});
