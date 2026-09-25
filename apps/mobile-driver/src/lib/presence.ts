import type { DriverStatusView } from '@neomoov/domain';
import { api } from './api';
import { currentPosition, isTracking, permissionLevel, readPresence, startLocationUpdates, stopLocationUpdates } from './location';

export class LocationPermissionError extends Error {
  constructor() {
    super('Autorisation de localisation refusée');
    this.name = 'LocationPermissionError';
  }
}

/**
 * Changement de statut en un geste (accueil). Hors ligne : l'envoi des positions est arrêté sur le téléphone avant même
 * la réponse de l'API (sans réseau, la présence expire côté serveur). En ligne ou en pause : l'API vérifie les
 * prérequis avec la position courante, puis la tâche de localisation démarre.
 */
export async function changeStatus(status: 'online' | 'paused' | 'offline'): Promise<DriverStatusView> {
  if (status === 'offline') {
    await stopLocationUpdates();
    return api.driver.setStatus({ status: 'offline' });
  }
  if ((await permissionLevel()) === 'denied') throw new LocationPermissionError();
  const coordinates = await currentPosition();
  const view = await api.driver.setStatus({ status, ...(coordinates ? { coordinates } : {}) });
  await startLocationUpdates(status);
  return view;
}

/**
 * Au démarrage de l'application (et après un redémarrage en pleine course) : le statut de l'API fait foi. En ligne ou
 * en pause, la tâche de localisation est relancée si le système l'a arrêtée ; hors ligne, elle est arrêtée.
 */
export async function restorePresence(): Promise<DriverStatusView | null> {
  try {
    const view = await api.driver.status();
    if (view.status === 'offline') {
      if ((await readPresence()) !== 'offline' || (await isTracking())) await stopLocationUpdates();
    } else if (!(await isTracking()) || (await readPresence()) !== view.status) {
      if ((await permissionLevel()) !== 'denied') await startLocationUpdates(view.status);
    }
    return view;
  } catch {
    return null;
  }
}
