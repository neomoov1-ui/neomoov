import type { RideMessageView } from '@neomoov/domain';
import { Button, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { ErrorState, Notice } from '@/components/ui';
import { api, errorMessage, offlineQueue } from '@/lib/api';
import { formatTime, type UiLanguage } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';

/** Messagerie masquée avec le chauffeur (aucun numéro échangé) ; sans réseau, le message part au retour de la connexion. */
export function MessagesPanel({ rideId, open }: { rideId: string; open: boolean }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const messages = useQuery({ queryKey: keys.messages(rideId), queryFn: () => api.rides.messages(rideId), enabled: open });
  const [text, setText] = useState('');
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      const result = await offlineQueue.send<RideMessageView>('POST', `/rides/${rideId}/messages`, { body });
      setQueued(result.status === 'queued');
      setText('');
      await queryClient.invalidateQueries({ queryKey: keys.messages(rideId) });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!open) return null;
  return (
    <View style={styles.wrap}>
      {(messages.data ?? []).length === 0 ? <Text style={styles.muted}>{t('ride.noMessages')}</Text> : null}
      {(messages.data ?? []).map((m) => (
        <View key={m.id} style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
          <Text style={[styles.body, m.mine && styles.mineText]}>{m.body}</Text>
          <Text style={[styles.time, m.mine && styles.mineText]}>{formatTime(m.sentAt, language)}</Text>
        </View>
      ))}
      <Field label={t('ride.message')} placeholder={t('ride.messagePlaceholder')} value={text} onChangeText={setText} maxLength={1000} />
      <Button label={t('ride.send')} onPress={() => void send()} disabled={!text.trim()} />
      {queued ? <Notice tone="warning">{t('ride.messageQueued')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  muted: { fontSize: typography.sizes.sm, color: colors.muted },
  bubble: { maxWidth: '85%', borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.blue },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.white },
  body: { fontSize: typography.sizes.sm, color: colors.ink },
  mineText: { color: colors.white },
  time: { fontSize: 10, color: colors.muted, alignSelf: 'flex-end' },
});
