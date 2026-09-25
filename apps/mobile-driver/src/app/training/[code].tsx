import type { TrainingResult } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Notice, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useTraining } from '@/lib/queries';

/** Un module : vidéo (quand elle existe), résumé, quiz corrigé par l'API ; les questions manquées sont signalées. */
export default function TrainingModuleScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'fr';
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const training = useTraining();
  const module = training.data?.modules.find((m) => m.code === code);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!module) return;
    if (module.questions.some((q) => answers[q.id] === undefined)) {
      setError(t('training.answerAll'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const graded = await api.driver.submitTraining(code, answers);
      setResult(graded);
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.training }), queryClient.invalidateQueries({ queryKey: keys.onboarding }), queryClient.invalidateQueries({ queryKey: keys.home })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={module?.title[lang] ?? t('training.title')} footer={module && !result?.passed ? <Button label={t('training.submit')} onPress={() => void submit()} disabled={busy} testID="training-submit" /> : <Button label={t('core:back')} variant="ghost" onPress={() => router.back()} />}>
      {module ? (
        <>
          <Card style={styles.card}>
            {module.videoUrl ? <Button label={t('training.video')} variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(module.videoUrl!)} /> : <Body muted>{t('training.noVideo')}</Body>}
            <Body>{module.summary[lang]}</Body>
          </Card>
          <SectionTitle>{t('training.quiz')}</SectionTitle>
          {module.questions.map((q, index) => (
            <Card key={q.id} style={styles.card}>
              <Choices
                label={`${index + 1}. ${q.prompt[lang]}`}
                value={answers[q.id] ?? null}
                onChange={(choice) => {
                  setResult(null);
                  setAnswers((a) => ({ ...a, [q.id]: choice }));
                }}
                options={q.choices.map((c, i) => ({ value: i, label: c[lang] }))}
              />
              {result && result.missed.includes(q.id) ? <Notice tone="warning">{t('training.missed', { count: 1 })}</Notice> : null}
            </Card>
          ))}
          {result ? <Notice tone={result.passed ? 'success' : 'warning'}>{result.passed ? t('training.passed', { score: result.scorePct }) : t('training.failed', { score: result.scorePct })}</Notice> : null}
        </>
      ) : null}
      {training.error ? <ErrorState message={errorMessage(training.error)} /> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
