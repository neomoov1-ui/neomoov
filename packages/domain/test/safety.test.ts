import { describe, expect, it } from 'vitest';
import { incidentDecisionSchema, triggersSafetyHold } from '../src/index.js';

describe('blocage préventif du chauffeur (5.11)', () => {
  it('SOS du client ou d\'un opérateur : blocage ; SOS du chauffeur : jamais', () => {
    expect(triggersSafetyHold({ type: 'sos', severity: 'critical', reportedByKind: 'client' })).toBe(true);
    expect(triggersSafetyHold({ type: 'sos', severity: 'critical', reportedByKind: 'operator' })).toBe(true);
    expect(triggersSafetyHold({ type: 'sos', severity: 'critical', reportedByKind: 'driver' })).toBe(false);
  });
  it('plainte : de sécurité à partir de la gravité élevée, jamais celle du chauffeur', () => {
    expect(triggersSafetyHold({ type: 'complaint', severity: 'high', reportedByKind: 'client' })).toBe(true);
    expect(triggersSafetyHold({ type: 'complaint', severity: 'critical', reportedByKind: 'agent' })).toBe(true);
    expect(triggersSafetyHold({ type: 'complaint', severity: 'medium', reportedByKind: 'client' })).toBe(false);
    expect(triggersSafetyHold({ type: 'complaint', severity: 'high', reportedByKind: 'driver' })).toBe(false);
  });
  it('autres incidents : aucun blocage', () => {
    expect(triggersSafetyHold({ type: 'model_guarantee', severity: 'critical', reportedByKind: 'client' })).toBe(false);
    expect(triggersSafetyHold({ type: 'accident', severity: 'high', reportedByKind: 'client' })).toBe(false);
  });
  it('décision : levée ou maintien facultatifs, valeur inconnue refusée', () => {
    expect(incidentDecisionSchema.parse({ status: 'decided', decision: 'Vérifié', safetyHold: 'lift' }).safetyHold).toBe('lift');
    expect(incidentDecisionSchema.safeParse({ status: 'decided', safetyHold: 'forget' }).success).toBe(false);
  });
});
