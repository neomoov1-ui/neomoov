import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Notice, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { requestPermissions } from '@/lib/location';
import { changeStatus } from '@/lib/presence';
import { keys, queryClient } from '@/lib/queries';

const POINTS = [
  { key: 'why', icon: 'navigate-outline' },
  { key: 'background', icon: 'lock-closed-outline' },
  { key: 'offline', icon: 'eye-off-outline' },
  { key: 'battery', icon: 'battery-half-outline' },
] as const;

/**
 * Explication avant la demande « toujours » (tâche 3, exigence d'Apple et de Google) : pourquoi, quand, jamais hors
 * ligne. Puis demandes système et passage au statut demandé depuis l'accueil.
 */
export default function LocationPermissionScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ then?: string }>();
  const then = params.then === 'paused' ? 'paused' : 'online';
  const [limited, setLimited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const level = await requestPermissions();
      if (level === 'denied') {
        setError(t('home.permissionDenied'));
        return;
      }
      setLimited(level === 'foreground');
      await changeStatus(then);
      await queryClient.invalidateQueries({ queryKey: keys.home });
      if (level === 'always') router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('permission.title')} footer={<Button label={t('permission.continue')} onPress={() => void allow()} disabled={busy} testID="allow-location" />}>
      <Card style={styles.card}>
        {POINTS.map((p) => (
          <View key={p.key} style={styles.point}>
            <Ionicons name={p.icon} size={24} color={colors.blue} />
            <Text style={styles.text}>{t(`permission.points.${p.key}`)}</Text>
          </View>
        ))}
      </Card>
      {limited ? (
        <>
          <Notice tone="warning">{t('permission.foregroundOnly')}</Notice>
          <Button label={t('permission.openSettings')} variant="ghost" onPress={() => void Linking.openSettings()} />
          <Body muted>{t('home.onlineHint')}</Body>
        </>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  text: { flex: 1, fontSize: typography.sizes.md, color: colors.ink, lineHeight: 22 },
});
