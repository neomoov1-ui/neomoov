import type { DriverCostsView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Loading, Notice, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import { centsToDollars, dollarsToCents } from '@/features/pilot/criteria';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, SERVICE_TIME_ZONE, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useCosts, useProfitability } from '@/lib/queries';

const COST_FIELDS = ['vehicle', 'insurance', 'energy', 'maintenance', 'phone', 'other', 'external'] as const;
type CostField = (typeof COST_FIELDS)[number];
const KEY_OF: Record<CostField, keyof Omit<DriverCostsView, 'month' | 'updatedAt'>> = {
  vehicle: 'vehicleCents', insurance: 'insuranceCents', energy: 'energyCents', maintenance: 'maintenanceCents', phone: 'phoneCents', other: 'otherCents', external: 'externalRevenueCents',
};

/** Trois derniers mois civils (heure de Montréal), le courant d'abord. */
export function recentMonths(now = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: SERVICE_TIME_ZONE, year: 'numeric', month: '2-digit' });
  const [year, month] = fmt.format(now).slice(0, 7).split('-').map(Number) as [number, number];
  return [0, 1, 2].map((back) => {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/**
 * Coûts et rentabilité nette (étape 24) : coûts du mois par poste et total des revenus d'autres plateformes saisis à la
 * main (sans logo ni nom : Pilote ne lit rien ailleurs), rentabilité calculée par l'API.
 */
export default function CostsScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]!);
  const costs = useCosts(month);
  const profitability = useProfitability(month);
  const [form, setForm] = useState<Record<CostField, string> | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents, language);
  const monthLabel = (m: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-CA' : 'fr-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00Z`));

  useEffect(() => {
    if (!costs.data || loadedFor === month) return;
    setForm(Object.fromEntries(COST_FIELDS.map((f) => [f, centsToDollars(costs.data![KEY_OF[f]])])) as Record<CostField, string>);
    setLoadedFor(month);
  }, [costs.data, loadedFor, month]);

  async function save() {
    if (!form) return;
    setError(null);
    setNotice(null);
    const body: Record<string, number> = {};
    for (const f of COST_FIELDS) {
      const cents = dollarsToCents(form[f]);
      if (cents === undefined) {
        setError(t('pilot.errors.amount'));
        return;
      }
      body[KEY_OF[f]] = cents ?? 0;
    }
    setBusy(true);
    try {
      const saved = await api.driver.saveCosts(month, body);
      queryClient.setQueryData(keys.costs(month), saved);
      await queryClient.invalidateQueries({ queryKey: keys.profitability(month) });
      setNotice(t('costs.saved'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const p = profitability.data;
  return (
    <Screen back title={t('costs.title')} onRefresh={() => void Promise.all([costs.refetch(), profitability.refetch()])} refreshing={costs.isRefetching}>
      <Body muted>{t('costs.intro')}</Body>
      <Choices label={t('costs.month')} value={month} onChange={(m) => { setMonth(m); setLoadedFor(null); }} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
      {costs.isLoading || !form ? <Loading /> : null}
      {costs.error ? <ErrorState message={errorMessage(costs.error)} onRetry={() => void costs.refetch()} /> : null}
      {form ? (
        <Card style={styles.card}>
          {COST_FIELDS.map((f) => (
            <Field key={f} label={t(`costs.${f}`)} value={form[f]} onChangeText={(v) => setForm((prev) => (prev ? { ...prev, [f]: v } : prev))} keyboardType="decimal-pad" maxLength={10} />
          ))}
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          {error ? <ErrorState message={error} /> : null}
          <Button label={t('costs.save')} onPress={() => void save()} disabled={busy} testID="costs-save" />
        </Card>
      ) : null}

      <SectionTitle>{t('costs.result')}</SectionTitle>
      {profitability.error ? <ErrorState message={errorMessage(profitability.error)} /> : null}
      {p ? (
        <Card style={styles.card}>
          <Text style={[styles.net, p.netCents < 0 && styles.negative]} testID="profitability-net">{money(p.netCents)}</Text>
          <Body muted>{t('costs.net')}{p.marginPercent !== null ? ` · ${t('costs.margin')} ${p.marginPercent.toLocaleString(language === 'en' ? 'en-CA' : 'fr-CA')} %` : ''}</Body>
          <Row label={t('costs.neomoov')} value={money(p.revenue.neomoovCents)} />
          <Body muted>{t('costs.rides', { count: p.rides })}</Body>
          <Row label={t('costs.externalRevenue')} value={money(p.revenue.externalCents)} />
          <Row label={t('costs.totalRevenue')} value={money(p.revenue.totalCents)} strong />
          {p.neomoovSharePercent !== null ? <Body muted>{`${t('costs.share')} : ${p.neomoovSharePercent.toLocaleString(language === 'en' ? 'en-CA' : 'fr-CA')} %`}</Body> : null}
          <Row label={t('costs.packs')} value={money(p.costs.packsCents)} />
          {p.costs.platformFeesCents > 0 ? <Row label={t('costs.platformFees')} value={money(p.costs.platformFeesCents)} /> : null}
          <Row label={t('costs.totalCosts')} value={money(p.costs.totalCents)} strong />
          <Body muted>{t('costs.commission')}</Body>
          {!p.costsEntered ? <Notice>{t('costs.noCosts')}</Notice> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  net: { fontSize: typography.sizes.xxl, fontWeight: '700', color: colors.night, fontVariant: ['tabular-nums'] },
  negative: { color: colors.danger },
});
