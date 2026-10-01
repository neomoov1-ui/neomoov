import { Body, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { Empty, ErrorState, Loading, Notice, Row } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration, formatMoney, formatTime, type UiLanguage } from '@/lib/format';
import { currentPosition } from '@/lib/location';
import { useAgenda } from '@/lib/queries';

/**
 * Agenda des réservations chaînées (étape 24) : ordre, heure de départ conseillée calculée par l'API depuis la position
 * du téléphone (consentement à la localisation déjà donné pour passer en ligne), alerte de départ, enchaînement impossible.
 */
export function Agenda() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const [position, setPosition] = useState<{ lat: number; lng: number } | null | undefined>(undefined);
  const agenda = useAgenda(position === undefined ? null : position, position !== undefined);
  const money = (cents: number) => formatMoney(cents, language);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const found = Platform.OS === 'web' ? null : await currentPosition();
      if (!cancelled) setPosition(found);
    };
    void read();
    const timer = setInterval(() => void read(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const data = agenda.data;
  return (
    <>
      <Body muted>{t('agenda.intro')}</Body>
      {position === undefined ? <Body muted>{t('agenda.locating')}</Body> : null}
      {agenda.isLoading ? <Loading /> : null}
      {agenda.error ? <ErrorState message={errorMessage(agenda.error)} onRetry={() => void agenda.refetch()} /> : null}
      {(data?.items ?? []).map((item) => (
        <Pressable key={item.rideId} accessibilityRole="button" onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.rideId } })}>
          <Card style={styles.card}>
            <Row label={formatDateTime(item.requestedAt, language)} value={money(item.driverFareCents)} strong />
            <Body>{item.origin.address}</Body>
            <Body muted>{item.destination.address}</Body>
            {item.leaveAt ? (
              <Notice tone={item.status === 'late' ? 'warning' : item.status === 'leave_soon' ? 'warning' : 'info'}>
                {`${t(`agenda.status.${item.status}`)} · ${t('agenda.leaveAt', { time: formatTime(item.leaveAt, language) })}${item.travelSeconds !== null ? ` · ${t('agenda.travel', { duration: formatDuration(item.travelSeconds) })}` : ''}`}
              </Notice>
            ) : (
              <Body muted>{t('agenda.leaveUnknown')}</Body>
            )}
            {item.conflict ? <Notice tone="warning">{t('agenda.conflict')}</Notice> : item.gapSeconds !== null ? <Body muted>{t('agenda.gap', { duration: formatDuration(item.gapSeconds) })}</Body> : null}
          </Card>
        </Pressable>
      ))}
      {agenda.isFetched && !(data?.items ?? []).length ? <Empty message={t('agenda.none')} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
});
