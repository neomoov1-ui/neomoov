import { createSecureStorage } from '@neomoov/mobile-core/storage';

/**
 * Stockage sécurisé de l'application chauffeur, lisible écran verrouillé après le premier déverrouillage : la tâche de
 * localisation en arrière-plan relit la session et le statut quand le système la relance.
 */
export const driverStorage = createSecureStorage({ readableWhenLocked: true });
