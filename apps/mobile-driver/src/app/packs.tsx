import type { DriverPacksView } from '@neomoov/domain';
import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { spacing } from '@neomoov/mobile-core/theme';
import { ErrorState, Loading, Notice, Row, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, usePacks } from '@/lib/queries';

/**
 * Packs (6.2, 5.7) : catalogue avec le prix appliqué au chauffeur, activation (facturée au relevé, jamais d'avance),
 * changement programmé à l'épuisement, renouvellement automatique, historique.
 */
export default function PacksScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const packs = usePacks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = packs.data;
  const money = (cents: number) => formatMoney(cents, language);
  const names = new Map((data?.catalog ?? []).map((c) => [c.code, c.name]));
  const activeRow = data?.history.find((h) => h.id === data.active?.id);

  async function run(action: () => Promise<DriverPacksView>) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(keys.packs, await action());
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.home }), queryClient.invalidateQueries({ queryKey: keys.onboarding })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('packs.title')} onRefresh={() => void packs.refetch()} refreshing={packs.isRefetching}>
      <Body muted>{t('packs.intro')}</Body>
      {data?.required && !data.active ? <Notice tone="warning">{t('packs.required')}</Notice> : null}
      {packs.isLoading ? <Loading /> : null}
      {packs.error ? <ErrorState message={errorMessage(packs.error)} onRetry={() => void packs.refetch()} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {data?.active ? (
        <Card style={styles.card}>
          <SectionTitle>{t('packs.active')}</SectionTitle>
          <Row label={data.active.name} value={data.active.ridesRemaining === null ? t('packs.unlimited') : t('packs.remaining', { count: data.active.ridesRemaining })} strong />
          <Body muted>{t('packs.expires', { date: formatDateTime(data.active.expiresAt, language) })}</Body>
          {activeRow?.nextPackCode ? <Body>{t('packs.next', { name: names.get(activeRow.nextPackCode) ?? activeRow.nextPackCode })}</Body> : null}
          <ToggleRow label={t('packs.autoRenew')} value={data.active.autoRenew} onChange={(autoRenew) => void run(() => api.driver.updatePack(data.active!.id, { autoRenew }))} />
        </Card>
      ) : null}
      {data?.active ? <Body muted>{t('packs.changeHint')}</Body> : null}

      {data?.catalog.map((pack) => (
        <Card key={pack.code} style={styles.card} testID={`pack-${pack.code}`}>
          <Row label={pack.name} value={pack.priceForMeCents === 0 ? t('packs.free') : money(pack.priceForMeCents)} strong />
          <Body muted>{`${pack.ridesIncluded === null ? t('packs.unlimited') : t('packs.rides', { count: pack.ridesIncluded })} · ${t('packs.validity', { days: pack.validityDays })}`}</Body>
          {pack.priceForMeCents !== pack.priceCents && pack.priceForMeCents === 0 ? <Body muted>{money(pack.priceCents)}</Body> : null}
          {pack.available ? (
            <Button label={data.active ? t('packs.change') : t('packs.activate')} variant={data.active ? 'ghost' : 'primary'} onPress={() => void run(() => api.driver.activatePack({ packCode: pack.code, autoRenew: true }))} disabled={busy || data.active?.code === pack.code} testID={`activate-${pack.code}`} />
          ) : (
            <Body muted>{t('packs.unavailable')}</Body>
          )}
        </Card>
      ))}

      {data?.history.length ? <SectionTitle>{t('packs.history')}</SectionTitle> : null}
      {data?.history.map((h) => (
        <Card key={h.id} style={styles.card}>
          <Row label={names.get(h.code) ?? h.code} value={t(`packs.statuses.${h.status}`)} strong />
          <Body muted>{`${formatDateTime(h.activatedAt, language)} · ${h.pricePaidCents === 0 ? t('packs.free') : money(h.pricePaidCents)} · ${t(`packs.billing.${h.billing}`)}`}</Body>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.xs } });
