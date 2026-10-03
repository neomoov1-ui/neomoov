import { Body, Button } from '@neomoov/mobile-core/components';
import { ErrorState, Notice, Screen, ToggleRow } from '@neomoov/mobile-core/ui';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAppConfig, useConsents } from '@/lib/queries';

/**
 * Vérification faciale (V1.1, module isolé sous `FEATURE_FACE_CHECK`) : photo prise par l'appareil (caméra frontale),
 * envoyée à l'API pour comparaison ; aucun traitement sur le téléphone. Masquée tant que le drapeau est éteint. Donnée
 * biométrique : consentement exprès et distinct (finalité `biometrics`, enregistré par l'API, retirable), demandé avant
 * la première photo (revue du 2 octobre 2026, constat mobile 17).
 */
export default function FaceCheckScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const consents = useConsents();
  const consented = consents.data?.find((c) => c.purpose === 'biometrics')?.granted ?? false;
  const [result, setResult] = useState<'passed' | 'failed' | 'disabled' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setConsent(granted: boolean) {
    if (!config.data) return;
    setBusy(true);
    setError(null);
    try {
      await api.me.setConsent({ purpose: 'biometrics', granted, version: config.data.legal.privacyPolicyVersion, source: 'app' });
      await queryClient.invalidateQueries({ queryKey: keys.consents });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function take() {
    if (!consented) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return;
      const photo = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], cameraType: ImagePicker.CameraType.front, quality: 0.6, base64: true, exif: false });
      const base64 = photo.canceled ? null : photo.assets[0]?.base64;
      if (!base64) return;
      setResult((await api.driver.startShift(base64)).faceCheck);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!config.data?.features.faceCheck) {
    return (
      <Screen back title={t('face.title')}>
        <Body muted>{t('face.disabled')}</Body>
      </Screen>
    );
  }
  return (
    <Screen back title={t('face.title')} footer={<Button label={t('face.take')} onPress={() => void take()} disabled={busy || !consented} />}>
      <Body muted>{t('face.intro')}</Body>
      <ToggleRow label={t('face.consent')} hint={t('face.consentHint')} value={consented} onChange={(v) => void setConsent(v)} testID="face-consent" />
      {result === 'passed' ? <Notice tone="success">{t('face.passed')}</Notice> : null}
      {result === 'failed' ? <Notice tone="warning">{t('face.failed')}</Notice> : null}
      {result === 'disabled' ? <Notice>{t('face.disabled')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
