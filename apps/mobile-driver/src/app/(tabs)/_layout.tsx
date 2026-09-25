import { colors } from '@neomoov/mobile-core/theme';
import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useHasDriverRole, useSession } from '@/lib/session';

type IconName = keyof typeof Ionicons.glyphMap;

const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

/** Onglets de l'application chauffeur (prompt 11, tâche 1) : Accueil, Courses, Revenus, Documents, Profil. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  const isDriver = useHasDriverRole();
  if (status !== 'signedIn') return <Redirect href="/" />;
  if (!isDriver) return <Redirect href="/apply" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.blue, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white } }}>
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: icon('speedometer-outline') }} />
      <Tabs.Screen name="rides" options={{ title: t('tabs.rides'), tabBarIcon: icon('car-sport-outline') }} />
      <Tabs.Screen name="earnings" options={{ title: t('tabs.earnings'), tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="documents" options={{ title: t('tabs.documents'), tabBarIcon: icon('document-text-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
