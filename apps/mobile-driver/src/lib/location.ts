/**
 * Localisation du chauffeur (prompt 11, tâche 3). En ligne ou en pause, une tâche `expo-task-manager` reçoit les
 * positions même écran verrouillé ou application en arrière-plan (service de premier plan sur Android, mode
 * « location » sur iOS) et les envoie par lots (`POST /driver/locations`) avec une file locale en cas de coupure. Hors
 * ligne, la tâche est arrêtée et toute position reçue est ignorée : aucune position ne quitte le téléphone.
 * Le statut est gardé dans le stockage sécurisé : la tâche relancée par le système le relit avant tout envoi.
 */
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { i18n } from '@/i18n';
import { api } from './api';
import { handleLocations, thinLocations, type PositionStore, type Presence, type QueuedPosition, type RawLocation } from './location-buffer';
import { useSession } from './session';
import { driverStorage } from './storage';

export const LOCATION_TASK = 'neomoov-driver-location';
const PRESENCE_KEY = 'neomoov.driver.presence';
/** Mesures du système : toutes les 5 secondes (Android) ; l'API ignore ce qui est à la fois plus rapproché et à moins de 50 m. */
const INTERVAL_MS = 5_000;

export async function readPresence(): Promise<Presence> {
  const value = await driverStorage.getItem(PRESENCE_KEY).catch(() => null);
  return value === 'online' || value === 'paused' ? value : 'offline';
}

async function writePresence(presence: Presence): Promise<void> {
  await driverStorage.setItem(PRESENCE_KEY, presence);
}

/** File des positions non envoyées : un fichier de l'application (hors trousseau, trop petit pour une file). */
function fileStore(): PositionStore {
  let memory: QueuedPosition[] = [];
  if (Platform.OS === 'web') return { read: async () => memory, write: async (p) => void (memory = p) };
  const file = new File(Paths.document, 'neomoov-positions.json');
  return {
    async read() {
      try {
        return file.exists ? (JSON.parse(await file.text()) as QueuedPosition[]) : [];
      } catch {
        return [];
      }
    },
    async write(positions) {
      if (!positions.length && !file.exists) return;
      file.write(JSON.stringify(positions));
    },
  };
}

const store = fileStore();

async function sendBatch(batch: QueuedPosition[]): Promise<void> {
  // Relancée par le système dans un contexte neuf, la tâche relit d'abord la session enregistrée.
  if (useSession.getState().status === 'loading') await useSession.getState().load();
  if (useSession.getState().status !== 'signedIn') throw new Error('Session absente');
  await api.driver.locations(batch);
}

let lastKept: RawLocation | null = null;

/** Traite les positions reçues, selon le statut enregistré ; hors ligne, arrête aussi la tâche. */
export async function processLocations(locations: readonly RawLocation[]): Promise<void> {
  const presence = await readPresence();
  const thinned = thinLocations(locations, lastKept);
  lastKept = thinned.last;
  await handleLocations({ presence, locations: thinned.kept, store, send: sendBatch });
  if (presence === 'offline') await stopUpdates();
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await processLocations(data.locations).catch(() => undefined);
  });
}

let webWatch: Location.LocationSubscription | null = null;

async function stopUpdates(): Promise<void> {
  webWatch?.remove();
  webWatch = null;
  if (Platform.OS === 'web') return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export type PermissionLevel = 'always' | 'foreground' | 'denied';

export async function permissionLevel(): Promise<PermissionLevel> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  if (Platform.OS === 'web') return 'always';
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'always' : 'foreground';
}

/** Demandes système : d'abord « pendant l'utilisation », puis « toujours » (après l'écran d'explication de l'application). */
export async function requestPermissions(): Promise<PermissionLevel> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  if (Platform.OS === 'web') return 'always';
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'always' : 'foreground';
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Démarre l'envoi des positions pour ce statut (en ligne ou en pause). Sans l'autorisation « toujours », les positions
 * ne partent que tant que l'application est à l'écran.
 */
export async function startLocationUpdates(presence: Exclude<Presence, 'offline'>): Promise<void> {
  await writePresence(presence);
  if (Platform.OS === 'web') {
    webWatch ??= await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: INTERVAL_MS, distanceInterval: 0 }, (location) => void processLocations([location]).catch(() => undefined));
    return;
  }
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: INTERVAL_MS,
    distanceInterval: 0,
    deferredUpdatesInterval: INTERVAL_MS,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: i18n.t('location.serviceTitle'),
      notificationBody: i18n.t('location.serviceBody'),
      notificationColor: '#1485E0',
      killServiceOnDestroy: false,
    },
  });
}

/** Hors ligne : statut enregistré d'abord (la tâche en cours n'enverra plus rien), puis arrêt et file vidée. */
export async function stopLocationUpdates(): Promise<void> {
  await writePresence('offline');
  await stopUpdates();
  await store.write([]);
}

export async function isTracking(): Promise<boolean> {
  if (Platform.OS === 'web') return webWatch !== null;
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}
