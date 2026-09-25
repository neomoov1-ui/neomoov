/**
 * Assistant d'inscription du chauffeur (prompt 11, tâche 1) : étapes et état de chacune, calculés par l'API à partir du
 * dossier, pour que l'application reprenne là où le chauffeur s'est arrêté. Fonction pure.
 */
import type { DriverStatus, VehicleStatus } from '../enums.js';
import type { DocumentDisplayState } from './documents.js';

export const ONBOARDING_STEPS = ['profile', 'vehicle', 'documents', 'training', 'payout', 'pack', 'activation'] as const;
export type OnboardingStepCode = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_STATES = ['todo', 'in_review', 'action_required', 'done', 'optional'] as const;
export type OnboardingStepState = (typeof ONBOARDING_STEP_STATES)[number];

export interface OnboardingInput {
  profileComplete: boolean;
  vehicleStatus: VehicleStatus | null;
  /** État de chaque document exigé. */
  documents: readonly DocumentDisplayState[];
  trainingCertified: boolean;
  payout: { linked: boolean; onboarded: boolean };
  /** Compte de versement exigé pour passer en ligne (réglage `drivers.require_payout_account`). */
  payoutRequired: boolean;
  packActive: boolean;
  packRequired: boolean;
  driverStatus: DriverStatus;
}

export interface OnboardingChecklist {
  steps: Array<{ code: OnboardingStepCode; state: OnboardingStepState }>;
  /** Prochaine étape à faire par le chauffeur ; null s'il n'a plus qu'à attendre ou si tout est fait. */
  next: OnboardingStepCode | null;
  complete: boolean;
}

function documentsState(states: readonly DocumentDisplayState[]): OnboardingStepState {
  if (states.some((s) => s === 'rejected' || s === 'expired')) return 'action_required';
  if (states.some((s) => s === 'missing')) return 'todo';
  if (states.some((s) => s === 'pending')) return 'in_review';
  return 'done';
}

export function onboardingChecklist(input: OnboardingInput): OnboardingChecklist {
  const vehicle: OnboardingStepState =
    input.vehicleStatus === null ? 'todo' : input.vehicleStatus === 'active' ? 'done' : input.vehicleStatus === 'pending' ? 'in_review' : 'action_required';
  const payout: OnboardingStepState = input.payout.onboarded ? 'done' : input.payout.linked ? 'in_review' : input.payoutRequired ? 'todo' : 'optional';
  const pack: OnboardingStepState = input.packActive ? 'done' : input.packRequired ? 'todo' : 'optional';
  const activation: OnboardingStepState =
    input.driverStatus === 'active' || input.driverStatus === 'restricted' ? 'done' : input.driverStatus === 'pending' ? 'in_review' : 'action_required';
  const steps: OnboardingChecklist['steps'] = [
    { code: 'profile', state: input.profileComplete ? 'done' : 'todo' },
    { code: 'vehicle', state: vehicle },
    { code: 'documents', state: documentsState(input.documents) },
    { code: 'training', state: input.trainingCertified ? 'done' : 'todo' },
    { code: 'payout', state: payout },
    { code: 'pack', state: pack },
    { code: 'activation', state: activation },
  ];
  const next = steps.find((s) => s.state === 'todo' || s.state === 'action_required')?.code ?? null;
  return { steps, next, complete: steps.every((s) => s.state === 'done' || s.state === 'optional') };
}
