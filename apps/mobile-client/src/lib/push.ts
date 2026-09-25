import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from './api';
import { secureStorage } from './storage';

const DEVICE_KEY = 'neomoov.device';

/**
 * Notifications push (prompt 10, tâche 4) : affichage au premier plan, canal Android, enregistrement du jeton Expo auprès
 * de l'API (`POST /me/devices`) et ouverture de la course au toucher (lien profond). Sans projet EAS (`projectId`),
 * sur le web ou sur un simulateur, l'enregistrement est simplement ignoré : l'application fonctionne sans push.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/** Demande l'autorisation (une fois) et déclare l'appareil ; renvoie le jeton, ou null si le push n'est pas disponible. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const id = projectId();
  if (!id) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Neomoov', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250] });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const device = await api.me.registerDevice({ platform: Platform.OS === 'ios' ? 'ios' : 'android', pushToken: token, ...(Application.nativeApplicationVersion ? { appVersion: Application.nativeApplicationVersion } : {}) });
  await secureStorage.setItem(DEVICE_KEY, device.id);
  return token;
}

/** Avant la déconnexion : l'appareil est retiré du compte (plus de notifications de ce compte sur ce téléphone). */
export async function unregisterPush(): Promise<void> {
  const deviceId = await secureStorage.getItem(DEVICE_KEY);
  if (!deviceId) return;
  await api.me.removeDevice(deviceId).catch(() => undefined);
  await secureStorage.removeItem(DEVICE_KEY);
}

/** Toucher une notification qui porte `rideId` ouvre la course (application ouverte, en arrière-plan ou fermée). */
export function listenToNotificationTaps(): () => void {
  const open = (response: Notifications.NotificationResponse | null) => {
    const rideId = (response?.notification.request.content.data as { rideId?: unknown } | undefined)?.rideId;
    if (typeof rideId === 'string') router.push({ pathname: '/ride/[id]', params: { id: rideId } });
  };
  if (Platform.OS !== 'web') void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
  const subscription = Notifications.addNotificationResponseReceivedListener(open);
  return () => subscription.remove();
}
