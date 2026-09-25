import { Body, Button, Field } from '@neomoov/mobile-core/components';
import { toE164 } from '@neomoov/mobile-core/phone';
import { ErrorState, Screen } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';

/** Connexion ou création de compte, étape 1 : numéro de téléphone, code envoyé par texto. */
export default function LoginScreen() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const phone = toE164(input);
    setInvalid(!phone);
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await api.auth.requestOtp(phone);
      router.push({ pathname: '/verify', params: { phone, retryAfter: String(sent.retryAfter) } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('auth.phoneTitle')} footer={<Button label={t('auth.sendCode')} onPress={() => void submit()} disabled={busy || input.trim().length < 10} testID="send-code" />}>
      <Body muted>{t('auth.phoneIntro')}</Body>
      <Field
        label={t('auth.phoneLabel')}
        hint={t('auth.phoneHint')}
        value={input}
        onChangeText={setInput}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={16}
        testID="phone-input"
        {...(invalid ? { error: t('auth.invalidPhone') } : {})}
        onSubmitEditing={() => void submit()}
      />
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
