/**
 * Raisons renvoyées par l'API quand le passage en ligne est refusé (`blockers` de l'accueil, `DRIVER_NOT_ELIGIBLE`),
 * traduites et reliées à l'écran qui permet de les lever. Fonction pure (testée par vitest).
 */

export type FixRoute = '/documents' | '/onboarding/vehicle' | '/training' | '/payout' | '/packs' | '/profile' | null;

export interface Blocker {
  /** Clé de traduction sous `blockers.` */
  key: string;
  params: Record<string, string>;
  fix: FixRoute;
}

export function describeBlocker(reason: string): Blocker {
  const [code, detail = ''] = reason.split(':');
  switch (code) {
    case 'document_missing':
      return { key: 'document_missing', params: { type: detail }, fix: '/documents' };
    case 'vehicle_missing':
      return { key: 'vehicle_missing', params: {}, fix: '/onboarding/vehicle' };
    case 'vehicle_status':
      return { key: `vehicle_${detail}`, params: {}, fix: detail === 'pending' ? null : '/onboarding/vehicle' };
    case 'driver_status':
      return { key: `driver_${detail}`, params: {}, fix: null };
    case 'training_required':
      return { key: 'training_required', params: {}, fix: '/training' };
    case 'payout_required':
      return { key: 'payout_required', params: {}, fix: '/payout' };
    case 'pack_required':
      return { key: 'pack_required', params: {}, fix: '/packs' };
    case 'geolocation_consent_withdrawn':
      return { key: 'geolocation_consent_withdrawn', params: {}, fix: '/profile' };
    case 'balance_suspended':
      return { key: 'balance_suspended', params: {}, fix: null };
    case 'suspended':
      return { key: 'suspended', params: {}, fix: null };
    default:
      return { key: 'unknown', params: { reason }, fix: null };
  }
}
