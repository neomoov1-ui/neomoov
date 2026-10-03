import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from './api';
import { driverStorage } from './storage';

const DEVICE_KEY = 'neomoov.driver.device';

/**
 * Notifications push du chauffeur (prompt 11, tâche 5) : canal prioritaire « offres » avec son distinct, canal général
 * pour les planifiées, relevés, documents et packs ; le toucher ouvre l'offre, la course ou l'écran concerné.
 * Sans projet EAS (`projectId`), sur le web ou sur un simulateur, l'enregistrement est ignoré.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const id = projectId();
  if (!id) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('offers', { name: 'Offres de course', importance: Notifications.AndroidImportance.MAX, sound: 'offer.wav', vibrationPattern: [0, 700, 500, 700], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, bypassDnd: true });
    await Notifications.setNotificationChannelAsync('default', { name: 'Neomoov Chauffeur', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250] });
    // Neomoov Booster : un canal par famille de son (vérification, session, gain), un canal silencieux (vibration seulement).
    await Notifications.setNotificationChannelAsync('booster-check', { name: 'Booster : vérification sommaire', importance: Notifications.AndroidImportance.HIGH, sound: 'booster_check.wav', vibrationPattern: [0, 300, 200, 300], lightColor: '#D97706' });
    await Notifications.setNotificationChannelAsync('booster-session', { name: 'Booster : session', importance: Notifications.AndroidImportance.HIGH, sound: 'booster_session.wav', vibrationPattern: [0, 250, 250, 250], lightColor: '#1485E0' });
    await Notifications.setNotificationChannelAsync('booster-peak', { name: 'Booster : périodes et zones de gain', importance: Notifications.AndroidImportance.HIGH, sound: 'booster_peak.wav', vibrationPattern: [0, 150, 100, 150, 100, 150], lightColor: '#16A34A' });
    await Notifications.setNotificationChannelAsync('booster-silent', { name: 'Booster : vibration seulement', importance: Notifications.AndroidImportance.DEFAULT, sound: null, vibrationPattern: [0, 300] });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const device = await api.me.registerDevice({ platform: Platform.OS === 'ios' ? 'ios' : 'android', pushToken: token, ...(Application.nativeApplicationVersion ? { appVersion: Application.nativeApplicationVersion } : {}) });
  await driverStorage.setItem(DEVICE_KEY, device.id);
  return token;
}

/**
 * Déconnexion demandée : l'appareil est retiré du compte par l'API (plus de notifications de ce compte sur ce
 * téléphone). Si l'API ne répond pas, le téléphone se désinscrit lui-même (`forgetPush`).
 */
export async function unregisterPush(): Promise<void> {
  const deviceId = await driverStorage.getItem(DEVICE_KEY);
  if (!deviceId) return;
  const removed = await api.me.removeDevice(deviceId).then(
    () => true,
    () => false,
  );
  if (removed) await driverStorage.removeItem(DEVICE_KEY);
  else await forgetPush();
}

/**
 * Session perdue ou compte supprimé : l'API ne peut plus retirer l'appareil. Le téléphone se désinscrit lui-même des
 * notifications (les notifications de l'ancien compte ne lui parviennent plus ; l'API efface le jeton mort au prochain
 * envoi) ; la prochaine connexion le réinscrit avec un nouveau jeton.
 */
export async function forgetPush(): Promise<void> {
  await driverStorage.removeItem(DEVICE_KEY);
  if (Platform.OS === 'web' || !Device.isDevice) return;
  await Notifications.unregisterForNotificationsAsync();
}

type Payload = { offerId?: unknown; rideId?: unknown; screen?: unknown; statementId?: unknown; inspectionId?: unknown };

/** Lien profond d'une notification : offre, course, relevé, ou écran nommé (documents, packs, planifiées). */
export function openFromNotification(data: Payload | undefined): void {
  if (!data) return;
  if (typeof data.offerId === 'string') router.push({ pathname: '/offer/[id]', params: { id: data.offerId } });
  else if (typeof data.rideId === 'string') router.push({ pathname: '/ride/[id]', params: { id: data.rideId } });
  else if (typeof data.statementId === 'string') router.push({ pathname: '/statement/[id]', params: { id: data.statementId } });
  else if (data.screen === 'documents') router.push('/documents');
  else if (data.screen === 'packs') router.push('/packs');
  else if (data.screen === 'scheduled') router.push('/rides');
  // Neomoov Booster : vérification sommaire, rapport de performance, accueil Booster.
  else if (data.screen === 'booster-inspection') router.push('/booster/inspection');
  else if (data.screen === 'booster-performance') router.push('/booster/performance');
  else if (data.screen === 'booster') router.push('/booster');
}

export function listenToNotificationTaps(): () => void {
  const open = (response: Notifications.NotificationResponse | null) => openFromNotification(response?.notification.request.content.data as Payload | undefined);
  if (Platform.OS !== 'web') void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
  const subscription = Notifications.addNotificationResponseReceivedListener(open);
  return () => subscription.remove();
}
