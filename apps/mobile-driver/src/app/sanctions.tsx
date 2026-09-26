import type { AppealKind, DriverSanctionView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Choices, Empty, ErrorState, Loading, Notice, Row, Screen } from '@neomoov/mobile-core/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useSanctions } from '@/lib/queries';

/**
 * Mes sanctions (Charte d'équité, D7) : motif écrit, période, décision humaine ou non ; le chauffeur présente sa version
 * (réponse) ou demande une révision (appel) ; une personne lui répond sous 4 heures ouvrables.
 */
export default function SanctionsScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const sanctions = useSanctions();
  return (
    <Screen back title={t('sanctions.title')} onRefresh={() => void sanctions.refetch()} refreshing={sanctions.isRefetching}>
      <Body muted>{t('sanctions.intro')}</Body>
      {sanctions.isLoading ? <Loading /> : null}
      {sanctions.error ? <ErrorState message={errorMessage(sanctions.error)} onRetry={() => void sanctions.refetch()} /> : null}
      {(sanctions.data ?? []).map((s) => <SanctionCard key={s.id} sanction={s} language={language} />)}
      {sanctions.isFetched && !(sanctions.data ?? []).length ? <Empty message={t('sanctions.none')} /> : null}
    </Screen>
  );
}

function SanctionCard({ sanction, language }: { sanction: DriverSanctionView; language: UiLanguage }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AppealKind | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = sanction.appeals.some((a) => a.status === 'open');
  async function send() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      await api.driver.appealSanction(sanction.id, { kind, message: message.trim() });
      setKind(null);
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: keys.sanctions });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={styles.card}>
      <Row label={t(`sanctions.types.${sanction.type}`)} value={sanction.active ? t('sanctions.active') : t('sanctions.ended')} strong />
      <Body>{sanction.reason}</Body>
      <Body muted>{sanction.endsAt ? t('sanctions.period', { from: formatDateTime(sanction.startsAt, language), to: formatDateTime(sanction.endsAt, language) }) : t('sanctions.since', { from: formatDateTime(sanction.startsAt, language) })}</Body>
      <Body muted>{sanction.decidedByPerson ? t('sanctions.byPerson') : t('sanctions.pendingPerson')}</Body>
      {sanction.appeals.map((a) => (
        <Notice key={a.id} tone={a.status === 'overturned' ? 'success' : 'info'}>
          {`${t(`sanctions.kinds.${a.kind}`)} · ${t(`sanctions.statuses.${a.status}`)}${a.decisionNote ? ` : ${a.decisionNote}` : ''}`}
        </Notice>
      ))}
      {open ? <Body muted>{t('sanctions.openHint')}</Body> : (
        <>
          <Choices label={t('sanctions.ask')} value={kind} onChange={setKind} options={(['response', 'appeal'] as const).map((k) => ({ value: k, label: t(`sanctions.kinds.${k}`) }))} />
          {kind ? (
            <>
              <Field label={t('sanctions.message')} hint={t(`sanctions.hints.${kind}`)} value={message} onChangeText={setMessage} multiline maxLength={2000} />
              <Button label={t('sanctions.send')} onPress={() => void send()} disabled={busy || message.trim().length < 10} />
            </>
          ) : null}
        </>
      )}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
});
