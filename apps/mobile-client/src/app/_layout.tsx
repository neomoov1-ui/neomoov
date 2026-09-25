import { colors } from '@neomoov/mobile-core/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { i18n } from '@/i18n';
import { offlineQueue } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';

void SplashScreen.preventAutoHideAsync();

/**
 * Racine : session relue au démarrage (écran de démarrage tenu jusque-là), langue du compte ou de l'appareil,
 * requêtes, traductions, zones sûres ; la file hors ligne est rejouée au démarrage et au retour au premier plan.
 */
export default function RootLayout() {
  const status = useSession((s) => s.status);
  const userLanguage = useSession((s) => s.user?.language ?? null);

  useEffect(() => {
    void useSession.getState().load();
  }, []);

  useEffect(() => {
    const device = getLocales()[0]?.languageCode;
    const wanted = userLanguage ?? (device === 'en' ? 'en' : 'fr');
    void i18n.changeLanguage(wanted === 'en' ? 'en' : 'fr-CA');
  }, [userLanguage]);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
    if (status !== 'signedIn') return;
    void offlineQueue.flush();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void offlineQueue.flush();
    });
    return () => subscription.remove();
  }, [status]);

  if (status === 'loading') return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }} />
          </I18nextProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
