import { colors } from '@neomoov/mobile-core/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { i18n } from '@/i18n';
import { api } from '@/lib/api';
// La tâche de localisation doit être déclarée au chargement de l'application, avant tout démarrage par le système.
import '@/lib/location';
import { usePreferences } from '@/lib/preferences';
import { restorePresence } from '@/lib/presence';
import { listenToNotificationTaps, registerForPush } from '@/lib/push';
import { keys, queryClient } from '@/lib/queries';
import { useDriverRealtime } from '@/lib/realtime';
import { useHasDriverRole, useSession } from '@/lib/session';

void SplashScreen.preventAutoHideAsync();

/**
 * Racine : session et réglages relus au démarrage, langue du compte ou de l'appareil, socket `/driver` une fois la
 * candidature faite. Après un redémarrage (même en pleine course), le statut et la course en cours sont restaurés
 * depuis l'API : la localisation reprend si le chauffeur était en ligne, l'écran de la course se rouvre.
 */
export default function RootLayout() {
  const status = useSession((s) => s.status);
  const isDriver = useHasDriverRole();
  const userLanguage = useSession((s) => s.user?.language ?? null);
  useDriverRealtime(status === 'signedIn' && isDriver);

  useEffect(() => {
    void Promise.all([useSession.getState().load(), usePreferences.getState().load()]);
  }, []);

  useEffect(() => {
    const device = getLocales()[0]?.languageCode;
    const wanted = userLanguage ?? (device === 'en' ? 'en' : 'fr');
    void i18n.changeLanguage(wanted === 'en' ? 'en' : 'fr-CA');
  }, [userLanguage]);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
    if (status !== 'signedIn' || !isDriver) return;
    void registerForPush().catch(() => undefined);
    const stopTaps = listenToNotificationTaps();
    void (async () => {
      await restorePresence();
      const rides = await api.driver.rides().catch(() => null);
      if (rides?.active) router.push({ pathname: '/ride/[id]', params: { id: rides.active.id } });
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void restorePresence();
      void queryClient.invalidateQueries({ queryKey: keys.offers });
      void queryClient.invalidateQueries({ queryKey: keys.home });
    });
    return () => {
      subscription.remove();
      stopTaps();
    };
  }, [status, isDriver]);

  if (status === 'loading') return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }}>
              <Stack.Screen name="offer/[id]" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="ride/[id]" options={{ gestureEnabled: false }} />
            </Stack>
          </I18nextProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
