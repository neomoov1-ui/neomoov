import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Notice, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { useAppConfig } from '@/lib/queries';

/** Sécurité et assistance (6.2) : SOS en course, urgence, coordonnées de l'équipe (lues dans `/v1/config`). */
export default function SupportScreen() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const support = config.data?.support;
  return (
    <Screen back title={t('support.title')}>
      <Notice tone="warning">{t('support.emergency')}</Notice>
      <Card style={styles.card}>
        <Body>{t('support.sos')}</Body>
        <Body muted>{t('support.assistant')}</Body>
      </Card>
      <SectionTitle>{t('support.contact')}</SectionTitle>
      {support?.phone ? <Button label={t('support.phone', { phone: support.phone })} variant="ghost" onPress={() => void Linking.openURL(`tel:${support.phone}`)} /> : null}
      {support?.email ? <Button label={t('support.email', { email: support.email })} variant="ghost" onPress={() => void Linking.openURL(`mailto:${support.email}`)} /> : null}
      {!support?.phone && !support?.email ? <Body muted>{t('support.noContact')}</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
