import type { DriverDocumentsView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Screen } from '@neomoov/mobile-core/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { documentForm, pickDocumentPhoto, type PickedFile } from '@/features/documents/upload';
import { isValidDate } from '@/features/documents/validate';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useDocuments } from '@/lib/queries';

type Item = DriverDocumentsView['items'][number];

const TONES: Record<Item['state'], string> = { missing: colors.muted, pending: colors.warning, approved: colors.green, expiring: colors.warning, expired: colors.danger, rejected: colors.danger };

/** Téléversement d'un document : photo (appareil ou photothèque), numéro, échéance si le document expire. */
function UploadPanel({ item, onDone }: { item: Item; onDone: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateInvalid = item.expires && expiry.length > 0 && !isValidDate(expiry);

  async function pick(source: 'camera' | 'library') {
    setError(null);
    const picked = await pickDocumentPhoto(source);
    if (picked === 'denied') setError(t('documents.cameraDenied'));
    else if (picked) setFile(picked);
  }

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.driver.uploadDocument(await documentForm({ type: item.type, file, ...(number.trim() ? { number: number.trim() } : {}), ...(item.expires ? { expiresOn: expiry } : {}) }));
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.documents }), queryClient.invalidateQueries({ queryKey: keys.onboarding }), queryClient.invalidateQueries({ queryKey: keys.home })]);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Button label={t('documents.takePhoto')} variant="secondary" onPress={() => void pick('camera')} style={styles.flex} />
        <Button label={t('documents.pickPhoto')} variant="ghost" onPress={() => void pick('library')} style={styles.flex} testID={`pick-${item.type}`} />
      </View>
      {file ? (
        <>
          <Image source={{ uri: file.uri }} style={styles.preview} contentFit="cover" accessibilityLabel={t('documents.photoReady')} />
          <Body muted>{t('documents.photoReady')}</Body>
        </>
      ) : null}
      <Field label={t('documents.number')} value={number} onChangeText={setNumber} maxLength={60} autoCapitalize="characters" />
      {item.expires ? <Field label={t('documents.expiry')} value={expiry} onChangeText={(v) => setExpiry(v.replace(/[^\d-]/g, '').slice(0, 10))} keyboardType="numbers-and-punctuation" maxLength={10} testID={`expiry-${item.type}`} {...(dateInvalid ? { error: t('documents.invalidDate') } : {})} /> : null}
      <Button label={t('documents.send')} onPress={() => void send()} disabled={busy || !file || (item.expires && !isValidDate(expiry))} testID={`send-${item.type}`} />
      {error ? <ErrorState message={error} /> : null}
    </View>
  );
}

/**
 * Documents et échéances (6.2) : chaque document avec son état et son échéance, téléversement et remplacement ;
 * suspension automatique visible avec la marche à suivre.
 */
export default function DocumentsScreen() {
  const { t } = useTranslation();
  const documents = useDocuments();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = documents.data;

  return (
    <Screen title={t('documents.title')} onRefresh={() => void documents.refetch()} refreshing={documents.isRefetching}>
      <Body muted>{t('documents.intro')}</Body>
      {data?.suspended ? (
        <Card style={[styles.card, styles.suspended]}>
          <Text style={styles.suspendedTitle}>{t('documents.suspendedTitle')}</Text>
          <Body>{t('documents.suspendedSteps')}</Body>
        </Card>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {documents.isLoading ? <Loading /> : null}
      {documents.error ? <ErrorState message={errorMessage(documents.error)} onRetry={() => void documents.refetch()} /> : null}
      {data?.items.map((item) => (
        <Card key={item.type} style={styles.card} testID={`document-${item.type}`}>
          <View style={styles.head}>
            <Text style={styles.type}>{t(`documents.types.${item.type}`)}</Text>
            <Text style={[styles.badge, { color: TONES[item.state], borderColor: TONES[item.state] }]}>{t(`documents.states.${item.state}`)}</Text>
          </View>
          {item.daysToExpiry !== null ? <Body muted>{item.daysToExpiry >= 0 ? t('documents.expiresIn', { days: item.daysToExpiry }) : t('documents.expiredSince', { days: -item.daysToExpiry })}</Body> : null}
          {item.current?.rejectionReason && item.state === 'rejected' ? <Body>{t('documents.rejectedBecause', { reason: item.current.rejectionReason })}</Body> : null}
          {item.replacement ? <Body muted>{t('documents.replacementPending')}</Body> : null}
          {open === item.type ? (
            <UploadPanel
              item={item}
              onDone={() => {
                setOpen(null);
                setNotice(t('documents.sent'));
              }}
            />
          ) : item.state !== 'pending' || item.replacement === null ? (
            <Button label={item.state === 'missing' ? t('documents.upload') : t('documents.replace')} variant={item.state === 'approved' || item.state === 'pending' ? 'ghost' : 'primary'} onPress={() => setOpen(item.type)} testID={`upload-${item.type}`} />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  suspended: { borderLeftWidth: 4, borderLeftColor: colors.danger },
  suspendedTitle: { fontSize: typography.sizes.lg, fontWeight: '700', color: colors.danger },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  type: { flex: 1, fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, fontSize: typography.sizes.xs, fontWeight: '700' },
  panel: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  preview: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.tint },
});
