import { Body, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { formatDateTime, type UiLanguage } from '@/lib/format';
import { useTraining } from '@/lib/queries';

/** Formation (6.2) : modules et réussite de chacun ; attestation quand tous sont réussis (condition du passage en ligne). */
export default function TrainingScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const lang = i18n.language === 'en' ? 'en' : 'fr';
  const training = useTraining();
  const data = training.data;
  return (
    <Screen back title={t('training.title')} onRefresh={() => void training.refetch()} refreshing={training.isRefetching}>
      {data ? <Body muted>{t('training.intro', { score: data.passScorePct })}</Body> : null}
      {training.isLoading ? <Loading /> : null}
      {training.error ? <ErrorState message={errorMessage(training.error)} onRetry={() => void training.refetch()} /> : null}
      {data?.certifiedAt ? <Notice tone="success">{t('training.certified', { date: formatDateTime(data.certifiedAt, language) })}</Notice> : null}
      {data?.modules.map((m) => (
        <Pressable key={m.code} accessibilityRole="button" onPress={() => router.push({ pathname: '/training/[code]', params: { code: m.code } })} testID={`module-${m.code}`}>
          <Card style={styles.card}>
            <Ionicons name={m.passed ? 'checkmark-circle' : 'play-circle-outline'} size={28} color={m.passed ? colors.green : colors.blue} />
            <View style={styles.text}>
              <Text style={styles.title}>{m.title[lang]}</Text>
              <Text style={styles.meta}>{`${t('training.minutes', { minutes: m.durationMinutes })}${m.bestScorePct !== null ? ` · ${t('training.best', { score: m.bestScorePct })}` : ''}`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  title: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  meta: { fontSize: typography.sizes.sm, color: colors.muted },
});
