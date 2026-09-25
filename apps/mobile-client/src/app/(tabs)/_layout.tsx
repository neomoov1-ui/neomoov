import { colors } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useSession } from '@/lib/session';

type IconName = keyof typeof Ionicons.glyphMap;

const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

/** Onglets de l'application connectée (prompt 10, tâche 2) : Réserver, Réservations, Historique, Profil. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  if (status !== 'signedIn') return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.blue, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white } }}>
      <Tabs.Screen name="book" options={{ title: t('tabs.book'), tabBarIcon: icon('car-sport-outline') }} />
      <Tabs.Screen name="reservations" options={{ title: t('tabs.reservations'), tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history'), tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
