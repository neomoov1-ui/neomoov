/**
 * Blocage préventif du chauffeur (cahier des charges 5.11) : un incident de sécurité, SOS ou plainte, bloque aussitôt le
 * chauffeur de la course en attente d'une décision humaine. Le SOS du chauffeur lui-même ne le bloque pas : il est la
 * personne en danger, et le bloquer dissuaderait d'utiliser le bouton. Une plainte n'est de sécurité qu'à partir de la
 * gravité « élevée » ; celle qu'un chauffeur dépose contre un client (agression) ne bloque évidemment pas ce chauffeur.
 */
import type { IncidentSeverity, IncidentType } from '../enums.js';

export interface SafetyIncident {
  type: IncidentType;
  severity: IncidentSeverity;
  reportedByKind: string;
}

export function triggersSafetyHold(incident: SafetyIncident): boolean {
  if (incident.reportedByKind === 'driver') return false;
  if (incident.type === 'sos') return true;
  return incident.type === 'complaint' && (incident.severity === 'high' || incident.severity === 'critical');
}

/** Issue d'un blocage préventif : levé par la décision humaine, ou maintenu (la suspension devient une décision humaine). */
export const SAFETY_HOLD_OUTCOMES = ['lift', 'keep'] as const;
export type SafetyHoldOutcome = (typeof SAFETY_HOLD_OUTCOMES)[number];

/** État lu par My Hub : en cours, levé, ou maintenu par décision humaine. */
export const SAFETY_HOLD_STATES = ['active', 'lifted', 'kept'] as const;
export type SafetyHoldState = (typeof SAFETY_HOLD_STATES)[number];
