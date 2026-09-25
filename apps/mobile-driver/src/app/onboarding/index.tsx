import type { OnboardingView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { useOnboarding } from '@/lib/queries';
import { useHasDriverRole } from '@/lib/session';

type Step = OnboardingView['steps'][number];

const ROUTES: Record<Step['code'], Href | null> = {
  profile: '/onboarding/profile',
  vehicle: '/onboarding/vehicle',
  documents: '/documents',
  training: '/training',
  payout: '/payout',
  pack: '/packs',
  activation: null,
};

const ICONS: Record<Step['state'], keyof typeof Ionicons.glyphMap> = {
  todo: 'ellipse-outline',
  in_review: 'time-outline',
  action_required: 'alert-circle',
  done: 'checkmark-circle',
  optional: 'remove-circle-outline',
};

const TONES: Record<Step['state'], string> = { todo: colors.muted, in_review: colors.warning, action_required: colors.danger, done: colors.green, optional: colors.muted };

/** Assistant d'inscription (tâche 1) : étapes et état de chacune, calculés par l'API ; reprise à la prochaine étape. */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const isDriver = useHasDriverRole();
  const onboarding = useOnboarding();
  if (!isDriver) return <Redirect href="/apply" />;
  const data = onboarding.data;
  return (
    <Screen back title={t('onboarding.title')} onRefresh={() => void onboarding.refetch()} refreshing={onboarding.isRefetching}>
      <Body muted>{t('onboarding.intro')}</Body>
      {onboarding.isLoading ? <Loading /> : null}
      {onboarding.error ? <ErrorState message={errorMessage(onboarding.error)} onRetry={() => void onboarding.refetch()} /> : null}
      {data?.complete ? <Notice tone="success">{t('onboarding.complete')}</Notice> : null}
      {data && !data.complete && data.next === null ? <Notice>{t('onboarding.waiting')}</Notice> : null}
      {data?.steps.map((step) => {
        const route = ROUTES[step.code];
        const next = data.next === step.code;
        return (
          <Pressable key={step.code} accessibilityRole="button" disabled={!route} onPress={() => route && router.push(route)} testID={`step-${step.code}`}>
            <Card style={[styles.step, next && styles.next]}>
              <Ionicons name={ICONS[step.state]} size={26} color={TONES[step.state]} />
              <View style={styles.text}>
                <Text style={styles.title}>{t(`onboarding.steps.${step.code}`)}</Text>
                <Text style={styles.hint}>{t(`onboarding.hints.${step.code}`)}</Text>
                <Text style={[styles.state, { color: TONES[step.state] }]}>{t(`onboarding.states.${step.state}`)}</Text>
              </View>
              {route ? <Ionicons name="chevron-forward" size={20} color={colors.muted} /> : null}
            </Card>
          </Pressable>
        );
      })}
      {data?.complete ? <Button label={t('tabs.home')} onPress={() => router.replace('/home')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  next: { borderWidth: 2, borderColor: colors.blue },
  text: { flex: 1, gap: 2 },
  title: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  hint: { fontSize: typography.sizes.sm, color: colors.ink },
  state: { fontSize: typography.sizes.xs, fontWeight: '700', textTransform: 'uppercase' },
});
