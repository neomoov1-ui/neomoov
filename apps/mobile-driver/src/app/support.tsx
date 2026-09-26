import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Notice, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { SupportChat } from '@neomoov/mobile-core/support-chat';
import * as Linking from 'expo-linking';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { useAppConfig } from '@/lib/queries';

/** Sécurité et assistance (6.2) : SOS en course, urgence, message à l'équipe (réponse dans l'écran), coordonnées de l'équipe. */
export default function SupportScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const support = config.data?.support;
  const load = useCallback(() => api.me.supportConversation(), []);
  const send = useCallback((text: string) => api.me.sendSupportMessage({ text, channel: 'app', audience: 'driver' }), []);
  return (
    <Screen back title={t('support.title')}>
      <Notice tone="warning">{t('support.emergency')}</Notice>
      <Card style={styles.card}>
        <Body>{t('support.sos')}</Body>
        <Body muted>{t('support.assistant')}</Body>
      </Card>
      <SectionTitle>{t('support.chat.title')}</SectionTitle>
      <SupportChat
        load={load}
        send={send}
        labels={{ field: t('support.chat.field'), placeholder: t('support.chat.placeholder'), send: t('support.chat.send'), empty: t('support.chat.empty'), team: t('support.chat.team'), error: t('support.chat.error'), escalated: t('support.chat.escalated') }}
      />
      <SectionTitle>{t('support.contact')}</SectionTitle>
      {support?.phone ? <Button label={t('support.phone', { phone: support.phone })} variant="ghost" onPress={() => void Linking.openURL(`tel:${support.phone}`)} /> : null}
      {support?.email ? <Button label={t('support.email', { email: support.email })} variant="ghost" onPress={() => void Linking.openURL(`mailto:${support.email}`)} /> : null}
      {!support?.phone && !support?.email ? <Body muted>{t('support.noContact')}</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
