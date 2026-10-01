import { BrandProvider, useBrandColors } from '@neomoov/mobile-core/brand';
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
import { offlineQueue } from '@/lib/api';
import { initObservability } from '@/lib/observability';
import { usePendingJoin } from '@/lib/pending-join';
import { listenToNotificationTaps, registerForPush } from '@/lib/push';
import { queryClient, useAppConfig } from '@/lib/queries';
import { useSession } from '@/lib/session';

// Suivi des erreurs (Sentry) : seulement si EXPO_PUBLIC_SENTRY_DSN est renseignée au build.
initObservability();
void SplashScreen.preventAutoHideAsync();

/** Pile des écrans aux couleurs de la marque courante (fond). */
function ThemedStack() {
  const colors = useBrandColors();
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mist } }} />
    </>
  );
}

/** Marque de l'organisation du profil client (étape 22), lue de `GET /v1/config` ; Neomoov tant qu'elle n'est pas connue. */
function BrandedStack() {
  const config = useAppConfig();
  return (
    <BrandProvider brand={config.data?.brand ?? null}>
      <ThemedStack />
    </BrandProvider>
  );
}

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
    // Code de rattachement reçu par un lien avant la connexion (étape 22) : l'écran « Rejoindre » reprend avec le code.
    const pendingCode = usePendingJoin.getState().code;
    if (pendingCode) {
      usePendingJoin.getState().set(null);
      router.push({ pathname: '/join', params: { code: pendingCode } });
    }
    // Push : l'appareil est déclaré à chaque ouverture de session (le jeton peut changer) ; un échec n'empêche rien.
    void registerForPush().catch(() => undefined);
    const stopTaps = listenToNotificationTaps();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void offlineQueue.flush();
    });
    return () => {
      subscription.remove();
      stopTaps();
    };
  }, [status]);

  if (status === 'loading') return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <BrandedStack />
          </I18nextProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
