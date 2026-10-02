import type { VehicleInspectionView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Empty, ErrorState, Loading, Screen } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, type UiLanguage } from '@/lib/format';
import { useBoosterInspections } from '@/lib/queries';

const SEVERITY_COLORS = { ok: colors.green, minor: colors.warning, major: colors.danger } as const;

/** Mes rapports de vérification sommaire : les plus récents d'abord, reprise d'un brouillon, PDF d'un rapport archivé. */
export default function InspectionsScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const list = useBoosterInspections({ pageSize: 50 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(i: VehicleInspectionView) {
    setBusy(i.id);
    setError(null);
    try {
      await Linking.openURL((await api.driver.inspectionDownload(i.id)).url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen back title={t('booster.reports.title')} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Body muted>{t('booster.reports.intro')}</Body>
      <Button label={t('booster.reports.new')} onPress={() => router.push('/booster/inspection')} />
      {list.isLoading ? <Loading /> : null}
      {list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : null}
      {error ? <ErrorState message={error} /> : null}
      {(list.data?.items ?? []).map((i) => (
        <Card key={i.id} style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.dot, { backgroundColor: SEVERITY_COLORS[i.severity] }]} />
            <Text style={styles.title}>{formatDateTime(i.inspectedAt, language)}</Text>
            <Text style={styles.status}>{t(`booster.statuses.${i.status}`)}</Text>
          </View>
          <Body muted>{[i.plate, i.odometerKm !== null ? `${i.odometerKm} km` : null, t(`booster.severities.${i.severity}`), t('booster.reports.photos', { count: i.photos.length })].filter(Boolean).join(' · ')}</Body>
          {i.status === 'archived' ? (
            <Button label={busy === i.id ? t('booster.reports.opening') : t('booster.inspection.downloadPdf')} variant="secondary" onPress={() => void download(i)} disabled={busy !== null} />
          ) : (
            <Button label={t('booster.reports.resume')} variant="secondary" onPress={() => router.push({ pathname: '/booster/inspection', params: { id: i.id } })} />
          )}
        </Card>
      ))}
      {list.isFetched && !(list.data?.items ?? []).length ? <Empty message={t('booster.reports.empty')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { flex: 1, fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  status: { fontSize: typography.sizes.xs, color: colors.muted },
});
