import { useBrand } from '@neomoov/mobile-core/brand';
import { Body, Button } from '@neomoov/mobile-core/components';
import { SupportChat } from '@neomoov/mobile-core/support-chat';
import * as Linking from 'expo-linking';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Assistance : conversation avec l'agent relation client (réponse en français ou en anglais, relais humain au besoin),
 * téléphone et courriel de l'assistance de la marque (organisation rattachée, sinon Neomoov ; étape 22).
 */
export default function SupportScreen() {
  const { t } = useTranslation();
  const { brand } = useBrand();
  const support = brand.support;
  const load = useCallback(() => api.me.supportConversation(), []);
  const send = useCallback((text: string) => api.me.sendSupportMessage({ text, channel: 'app' }), []);
  return (
    <Screen back title={t('support.title')}>
      <Body>{t('support.intro')}</Body>
      <SupportChat
        load={load}
        send={send}
        labels={{ field: t('support.chat.field'), placeholder: t('support.chat.placeholder'), send: t('support.chat.send'), empty: t('support.chat.empty'), team: t('support.chat.team'), error: t('support.chat.error'), escalated: t('support.chat.escalated') }}
      />
      {support.phone ? <Button label={t('support.call', { name: brand.displayName })} variant="ghost" onPress={() => void Linking.openURL(`tel:${support.phone}`)} /> : null}
      {support.email ? <Button label={t('support.email', { name: brand.displayName })} variant="ghost" onPress={() => void Linking.openURL(`mailto:${support.email}`)} /> : null}
    </Screen>
  );
}
