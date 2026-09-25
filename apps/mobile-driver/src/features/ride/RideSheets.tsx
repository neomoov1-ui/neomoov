import { INCIDENT_KINDS } from '@neomoov/domain';
import { Body, Button, Field, Sheet } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Notice } from '@neomoov/mobile-core/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { currentPosition } from '@/lib/location';
import { keys, queryClient, refreshDriver, useMessages } from '@/lib/queries';

type Props = { rideId: string; visible: boolean; onClose: () => void };

/** Messages masqués avec le client (le numéro n'est jamais affiché) : à l'arrêt seulement. */
export function MessagesSheet({ rideId, visible, onClose }: Props) {
  const { t } = useTranslation();
  const messages = useMessages(rideId, visible);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setError(null);
    try {
      await api.rides.sendMessage(rideId, { body: body.trim() });
      setBody('');
      await queryClient.invalidateQueries({ queryKey: keys.messages(rideId) });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('ride.messages')} closeLabel={t('core:close')}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {(messages.data ?? []).map((m) => (
          <View key={m.id} style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
            <Text style={[styles.bubbleText, m.mine && styles.mineText]}>{m.body}</Text>
          </View>
        ))}
      </ScrollView>
      <Field label={t('ride.messagePlaceholder')} value={body} onChangeText={setBody} maxLength={1000} />
      <Button label={t('ride.send')} onPress={() => void send()} disabled={!body.trim()} />
      {error ? <ErrorState message={error} /> : null}
    </Sheet>
  );
}

/** Signalement d'incident (6.2) : type et description, envoyés à My Hub. */
export function IncidentSheet({ rideId, visible, onClose }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<(typeof INCIDENT_KINDS)[number] | null>(null);
  const [description, setDescription] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!kind) return;
    setError(null);
    try {
      await api.driver.reportIncident(rideId, { kind, description: description.trim() });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('ride.incident')} closeLabel={t('core:close')}>
      {sent ? (
        <Notice tone="success">{t('ride.incidentSent')}</Notice>
      ) : (
        <>
          <Choices value={kind} onChange={setKind} options={INCIDENT_KINDS.map((k) => ({ value: k, label: t(`ride.incidentKinds.${k}`) }))} />
          <Field label={t('ride.incidentDescription')} value={description} onChangeText={setDescription} multiline maxLength={1000} />
          <Button label={t('ride.incidentSend')} onPress={() => void send()} disabled={!kind || description.trim().length < 5} />
        </>
      )}
      {error ? <ErrorState message={error} /> : null}
    </Sheet>
  );
}

const CANCEL_REASONS = ['vehicle', 'safety', 'client_request', 'other'] as const;

/** Annulation par le chauffeur, avec motif : la course est réattribuée en priorité par l'API. */
export function CancelSheet({ rideId, visible, onClose, onCancelled }: Props & { onCancelled: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.driver.cancel(rideId, reason);
      await refreshDriver();
      onCancelled();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('ride.cancel')} closeLabel={t('core:close')}>
      <Body muted>{t('ride.cancelWarning')}</Body>
      <Choices label={t('ride.cancelReason')} value={reason} onChange={setReason} options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`ride.cancelReasons.${r}`) }))} />
      <Button label={t('ride.cancelConfirm')} variant="danger" onPress={() => void cancel()} disabled={busy || !reason} />
      {error ? <ErrorState message={error} /> : null}
    </Sheet>
  );
}

/** SOS (6.2) : alerte immédiate de l'équipe avec la position courante ; confirmation en un geste. */
export function SosSheet({ rideId, visible, onClose }: Props) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function alert() {
    setError(null);
    try {
      const coordinates = await currentPosition();
      await api.rides.sos(rideId, coordinates ? { coordinates } : {});
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={t('ride.sos')} closeLabel={t('core:close')}>
      {sent ? <Notice tone="success">{t('ride.sosSent')}</Notice> : <Body>{t('ride.sosConfirm')}</Body>}
      {!sent ? <Button label={t('ride.sosSend')} variant="danger" onPress={() => void alert()} testID="sos-confirm" /> : null}
      <Body muted>{t('support.emergency')}</Body>
      {error ? <ErrorState message={error} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 260 },
  listContent: { gap: spacing.xs, paddingVertical: spacing.xs },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.blue },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.tint },
  bubbleText: { fontSize: typography.sizes.md, color: colors.ink },
  mineText: { color: colors.white },
});
