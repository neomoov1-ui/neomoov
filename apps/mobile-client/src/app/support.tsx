import { Body, Button } from '@neomoov/mobile-core/components';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { Notice, Screen } from '@/components/ui';
import { useAppConfig } from '@/lib/queries';

/** Assistance : téléphone et courriel de Neomoov (réglages de l'API) ; la conversation avec l'agent arrive à l'étape 13. */
export default function SupportScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const support = config.data?.support;
  return (
    <Screen back title={t('support.title')}>
      <Body>{t('support.intro')}</Body>
      {support?.phone ? <Button label={t('support.call')} onPress={() => void Linking.openURL(`tel:${support.phone}`)} /> : null}
      {support?.email ? <Button label={t('support.email')} variant="ghost" onPress={() => void Linking.openURL(`mailto:${support.email}`)} /> : null}
      <Notice>{t('support.agentSoon')}</Notice>
    </Screen>
  );
}
