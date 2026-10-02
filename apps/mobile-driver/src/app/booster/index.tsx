import { Body, Card } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Notice, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBoosterInspections, useBoosterPerformance } from '@/lib/queries';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * Neomoov Booster (phase 1, agent G) : accueil des trois fonctions, vérification sommaire par caméra (article 55 de la
 * Loi), rapport de performance et alertes de la journée ; état du jour (rapport archivé ou non).
 */
export default function BoosterHomeScreen() {
  const { t } = useTranslation();
  const date = today();
  const inspections = useBoosterInspections({ from: date, to: date, pageSize: 5 });
  const performance = useBoosterPerformance({ pageSize: 1 });
  const archivedToday = (inspections.data?.items ?? []).some((i) => i.status === 'archived');
  const draftToday = (inspections.data?.items ?? []).find((i) => i.status !== 'archived');
  const latest = performance.data?.items[0];
  const items: Array<{ key: 'inspection' | 'performance' | 'reports' | 'alerts'; href: Href; icon: keyof typeof Ionicons.glyphMap; hint: string }> = [
    { key: 'inspection', href: draftToday ? { pathname: '/booster/inspection', params: { id: draftToday.id } } : '/booster/inspection', icon: 'camera-outline', hint: archivedToday ? t('booster.home.inspectionDone') : draftToday ? t('booster.home.inspectionDraft') : t('booster.home.inspectionTodo') },
    { key: 'performance', href: '/booster/performance', icon: 'stats-chart-outline', hint: latest ? t('booster.home.lastSession', { date: latest.date }) : t('booster.home.noSession') },
    { key: 'reports', href: '/booster/inspections', icon: 'folder-open-outline', hint: t('booster.home.reportsHint') },
    { key: 'alerts', href: '/booster/alerts', icon: 'notifications-outline', hint: t('booster.home.alertsHint') },
  ];
  return (
    <Screen back title={t('booster.title')} onRefresh={() => void Promise.all([inspections.refetch(), performance.refetch()])} refreshing={inspections.isRefetching}>
      <Body muted>{t('booster.intro')}</Body>
      {!archivedToday ? <Notice tone="warning">{t('booster.home.reminder')}</Notice> : <Notice tone="success">{t('booster.home.inspectionDone')}</Notice>}
      {items.map((item) => (
        <Pressable key={item.key} accessibilityRole="button" onPress={() => router.push(item.href)} testID={`booster-${item.key}`}>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Ionicons name={item.icon} size={26} color={colors.blue} />
              <View style={styles.text}>
                <Text style={styles.title}>{t(`booster.home.${item.key}`)}</Text>
                <Text style={styles.hint}>{item.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </View>
          </Card>
        </Pressable>
      ))}
      <Body muted>{t('booster.legal')}</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  hint: { fontSize: typography.sizes.sm, color: colors.muted, borderRadius: radius.sm },
});
