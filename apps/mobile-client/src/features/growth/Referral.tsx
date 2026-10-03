import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { spacing, typography } from '@neomoov/mobile-core/theme';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text, View } from 'react-native';
import { ErrorState, Notice, Row } from '@/components/ui';
import { canEnterReferral, isReferralCode, normalizeReferralCode } from '@/features/growth/logic';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useReferral } from '@/lib/queries';

/**
 * Parrainage du client (5.9) : code personnel et lien à partager, résultats, et saisie du code d'un parrain tant que le
 * compte n'en a pas (avant la première course, dans la fenêtre d'inscription : l'API le vérifie). Montants lus dans la
 * réponse de l'API (réglages), jamais écrits dans l'application.
 */
export function Referral() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const referral = useReferral();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      queryClient.setQueryData(keys.referral, await api.me.applyReferral(code));
      setCode('');
      setNotice(t('referral.applied'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (referral.isError) return <ErrorState message={errorMessage(referral.error)} onRetry={() => void referral.refetch()} />;
  const view = referral.data;
  if (!view) return null;
  const share = () => void Share.share({ message: t('referral.shareMessage', { code: view.code, link: view.link }) }).catch(() => undefined);
  return (
    <View style={styles.block}>
      <Card style={styles.card}>
        <Body>{t('referral.intro', { referrer: formatMoney(view.referrerRewardCents, language), referred: formatMoney(view.referredRewardCents, language), count: view.thresholdRides })}</Body>
        <Text style={styles.code} selectable accessibilityLabel={t('referral.codeLabel')} testID="referral-code">{view.code}</Text>
        <Button label={t('referral.share')} variant="secondary" onPress={share} testID="referral-share" />
        <Row label={t('referral.invited')} value={String(view.stats.invited)} />
        <Row label={t('referral.completed')} value={String(view.stats.completed)} />
        <Row label={t('referral.earned')} value={formatMoney(view.stats.earnedCents, language)} />
      </Card>
      {view.referredBy ? <Body muted>{t('referral.referredBy', { code: view.referredBy.code, status: t(`referral.statuses.${view.referredBy.status}`) })}</Body> : null}
      {canEnterReferral(view) ? (
        <>
          <Field label={t('referral.enterLabel')} hint={t('referral.enterHint')} value={code} onChangeText={(v) => setCode(normalizeReferralCode(v))} autoCapitalize="characters" autoCorrect={false} maxLength={12} testID="referral-input" />
          <Button label={t('referral.apply')} variant="ghost" onPress={() => void apply()} disabled={busy || !isReferralCode(code)} testID="referral-apply" />
        </>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  card: { gap: spacing.sm },
  code: { fontSize: typography.sizes.xl, fontWeight: '700', letterSpacing: 2, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
