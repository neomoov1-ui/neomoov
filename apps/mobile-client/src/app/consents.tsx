import { Body, Button } from '@neomoov/mobile-core/components';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, Screen, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAppConfig } from '@/lib/queries';

/**
 * Consentements distincts (5.15) : rien n'est coché par défaut ; chaque choix est enregistré avec la version de la
 * politique en vigueur. L'enregistrement audio et vidéo à bord n'arrive qu'en V2.
 */
export default function ConsentsScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const [geolocation, setGeolocation] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!config.data) return;
    setBusy(true);
    setError(null);
    try {
      const version = config.data.legal.privacyPolicyVersion;
      await api.me.setConsent({ purpose: 'geolocation', granted: geolocation, version, source: 'app' });
      await api.me.setConsent({ purpose: 'marketing', granted: marketing, version, source: 'app' });
      await queryClient.invalidateQueries({ queryKey: keys.consents });
      router.replace('/book');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('consents.title')} footer={<Button label={t('consents.save')} onPress={() => void save()} disabled={busy || !config.data} />}>
      <Body muted>{t('consents.intro')}</Body>
      <ToggleRow label={t('consents.geolocation')} hint={t('consents.geolocationHint')} value={geolocation} onChange={setGeolocation} />
      <ToggleRow label={t('consents.marketing')} hint={t('consents.marketingHint')} value={marketing} onChange={setMarketing} />
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
