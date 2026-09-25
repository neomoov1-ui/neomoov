import { Body, Button, Field } from '@neomoov/mobile-core/components';
import { displayPhone } from '@neomoov/mobile-core/phone';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Screen } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useAppConfig } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Étape 2 : code à 6 chiffres et acceptation des conditions en vigueur (demandée à chaque fois : l'API ne dit pas avant
 * le code si le numéro a déjà un compte). Un compte chauffeur va à l'accueil, un nouveau compte à la candidature.
 */
export default function VerifyScreen() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ phone: string; retryAfter?: string }>();
  const phone = params.phone ?? '';
  const config = useAppConfig();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(Number(params.retryAfter ?? 30) || 30);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify() {
    if (!accepted) {
      setError(t('auth.mustAccept'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tokens = await api.auth.verifyOtp({
        phone,
        code,
        acceptTerms: true,
        language: i18n.language === 'en' ? 'en' : 'fr',
        ...(config.data ? { privacyPolicyVersion: config.data.legal.privacyPolicyVersion } : {}),
      });
      await useSession.getState().signIn(tokens);
      router.replace(tokens.user.roles.includes('driver') ? '/home' : '/apply');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const sent = await api.auth.requestOtp(phone);
      setWait(sent.retryAfter);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen back title={t('auth.codeTitle')} footer={<Button label={t('auth.verify')} onPress={() => void verify()} disabled={busy || code.length !== 6 || !config.data} testID="verify" />}>
      <Body muted>{t('auth.codeSentTo', { phone: displayPhone(phone) })}</Body>
      <Field label={t('auth.codeLabel')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} testID="code-input" />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted((v) => !v)} style={styles.check} testID="accept-terms">
        <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={24} color={accepted ? colors.blue : colors.muted} />
        <Text style={styles.checkText}>{t('auth.acceptTerms')}</Text>
      </Pressable>
      {config.data ? (
        <View style={styles.links}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(config.data.legal.termsUrl)}>
            <Text style={styles.link}>{t('auth.terms')}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(config.data.legal.privacyUrl)}>
            <Text style={styles.link}>{t('auth.privacy')}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {wait > 0 ? <Body muted>{t('auth.resendIn', { seconds: wait })}</Body> : <Button label={t('auth.resend')} variant="ghost" onPress={() => void resend()} />}
      <Button label={t('auth.changeNumber')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  checkText: { flex: 1, fontSize: typography.sizes.sm, color: colors.ink },
  links: { flexDirection: 'row', gap: spacing.lg },
  link: { color: colors.blueDark, fontWeight: '700', textDecorationLine: 'underline' },
});
