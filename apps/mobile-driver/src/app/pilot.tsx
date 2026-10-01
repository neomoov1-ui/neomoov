import type { PilotDecisionView, PilotSettingsView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Empty, ErrorState, Loading, Notice, Row, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { reasonParams, SCORE_COLORS } from '@/components/PilotScore';
import { criteriaOf, formOf, type CriteriaForm } from '@/features/pilot/criteria';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useAppConfig, usePilot, usePilotDecisions } from '@/lib/queries';

const CATEGORIES = ['neo_premium', 'neo_prestige', 'neo_xl'] as const;

/**
 * Neomoov Pilote (étape 24) : interrupteur, critères, mode multi-applications, information sur la décision automatisée
 * (Loi 25, art. 12.1) et consentement, dernières décisions. Aucun montant n'est calculé ici : l'API évalue les offres.
 */
export default function PilotScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const pilot = usePilot();
  const decisions = usePilotDecisions(5);
  const config = useAppConfig();
  const [form, setForm] = useState<CriteriaForm | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = pilot.data;
  const money = (cents: number) => formatMoney(cents, language);

  useEffect(() => {
    if (!data || form) return;
    setForm(formOf(data.criteria));
    setEnabled(data.enabled);
    setConsent(data.consentCurrent);
  }, [data, form]);

  const set = <K extends keyof CriteriaForm>(key: K, value: CriteriaForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const toggle = (key: 'originZones' | 'destinationZones' | 'categories', code: string) =>
    setForm((f) => (f ? { ...f, [key]: f[key].includes(code) ? f[key].filter((z) => z !== code) : [...f[key], code] } : f));

  async function save() {
    if (!form || !data) return;
    setError(null);
    setNotice(null);
    const result = criteriaOf(form);
    if ('error' in result) {
      setError(t(`pilot.errors.${result.error}`));
      return;
    }
    if (enabled && !consent) {
      setError(t('pilot.consentRequired'));
      return;
    }
    setBusy(true);
    try {
      const updated = await api.driver.updatePilot({ enabled, criteria: result.criteria, ...(consent && !data.consentCurrent ? { consentVersion: data.information.version } : {}) });
      queryClient.setQueryData<PilotSettingsView>(keys.pilot, updated);
      setForm(formOf(updated.criteria));
      setNotice(t('pilot.saved'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const chips = (key: 'originZones' | 'destinationZones' | 'categories', options: Array<{ code: string; label: string }>, label: string) => (
    <View style={styles.chipsBlock}>
      <Text style={styles.chipsLabel}>{label}</Text>
      <View style={styles.chips} accessibilityRole="list">
        {options.map((o) => {
          const selected = form?.[key].includes(o.code) ?? false;
          return (
            <Pressable key={o.code} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggle(key, o.code)} style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const zoneOptions = (data?.zones ?? []).filter((z) => z.type !== 'service_area').map((z) => ({ code: z.code, label: z.name }));
  const categoryOptions = CATEGORIES.map((code) => ({ code, label: config.data?.categories.find((c) => c.code === code)?.name ?? code }));

  return (
    <Screen back title={t('pilot.title')} onRefresh={() => void Promise.all([pilot.refetch(), decisions.refetch()])} refreshing={pilot.isRefetching}>
      <Body muted>{t('pilot.intro')}</Body>
      {pilot.isLoading ? <Loading /> : null}
      {pilot.error ? <ErrorState message={errorMessage(pilot.error)} onRetry={() => void pilot.refetch()} /> : null}
      {data && form ? (
        <>
          {!data.available ? <Notice tone="warning">{t('pilot.unavailable')}</Notice> : null}
          <Card style={styles.card}>
            <ToggleRow label={t('pilot.enable')} hint={enabled ? t('pilot.enabledHint', { seconds: data.graceSeconds }) : t('pilot.disabledHint')} value={enabled} onChange={setEnabled} />
            <ToggleRow label={t('pilot.multiApp')} hint={t('pilot.multiAppHint', { percent: Math.round((data.multiAppFactor - 1) * 100), seconds: data.multiAppResponseSeconds })} value={form.multiAppMode} onChange={(v) => set('multiAppMode', v)} />
          </Card>

          <SectionTitle>{t('pilot.criteria')}</SectionTitle>
          <Body muted>{t('pilot.criteriaHint')}</Body>
          <Card style={styles.card}>
            <Field label={t('pilot.minFare')} value={form.minFare} onChangeText={(v) => set('minFare', v)} keyboardType="decimal-pad" maxLength={8} />
            <Field label={t('pilot.minNetPerKm')} value={form.minNetPerKm} onChangeText={(v) => set('minNetPerKm', v)} keyboardType="decimal-pad" maxLength={8} />
            <Field label={t('pilot.minNetPerHour')} value={form.minNetPerHour} onChangeText={(v) => set('minNetPerHour', v)} keyboardType="decimal-pad" maxLength={8} />
            <Field label={t('pilot.costPerKm')} hint={t('pilot.costPerKmHint')} value={form.costPerKm} onChangeText={(v) => set('costPerKm', v)} keyboardType="number-pad" maxLength={3} />
            <Field label={t('pilot.maxPickupKm')} value={form.maxPickupKm} onChangeText={(v) => set('maxPickupKm', v)} keyboardType="decimal-pad" maxLength={5} />
            <Field label={t('pilot.maxPickupMinutes')} value={form.maxPickupMinutes} onChangeText={(v) => set('maxPickupMinutes', v)} keyboardType="number-pad" maxLength={3} />
            <Field label={t('pilot.maxDurationMinutes')} value={form.maxDurationMinutes} onChangeText={(v) => set('maxDurationMinutes', v)} keyboardType="number-pad" maxLength={3} />
            <Field label={t('pilot.hours')} hint={t('pilot.hoursHint')} value={form.hours} onChangeText={(v) => set('hours', v)} multiline autoCapitalize="none" autoCorrect={false} />
            {chips('originZones', zoneOptions, t('pilot.originZones'))}
            {chips('destinationZones', zoneOptions, t('pilot.destinationZones'))}
            <Body muted>{t('pilot.zonesHint')}</Body>
            {chips('categories', categoryOptions, t('pilot.categories'))}
            <Field label={t('pilot.minClientRating')} value={form.minClientRating} onChangeText={(v) => set('minClientRating', v)} keyboardType="decimal-pad" maxLength={3} />
            <Field label={t('pilot.scheduleMargin')} value={form.scheduleMargin} onChangeText={(v) => set('scheduleMargin', v)} keyboardType="number-pad" maxLength={3} />
          </Card>

          <SectionTitle>{data.information.title}</SectionTitle>
          <Card style={styles.card}>
            {data.information.paragraphs.map((p, index) => <Body key={index}>{p}</Body>)}
            <Body muted>{t('pilot.informationVersion', { version: data.information.version })}</Body>
            {data.consentVersion && !data.consentCurrent ? <Notice tone="warning">{t('pilot.consentOutdated')}</Notice> : null}
            <ToggleRow label={t('pilot.consent')} value={consent} onChange={setConsent} />
            {data.consentAt ? <Body muted>{t('pilot.consentedAt', { date: formatDateTime(data.consentAt, language) })}</Body> : null}
          </Card>

          {notice ? <Notice tone="success">{notice}</Notice> : null}
          {error ? <ErrorState message={error} /> : null}
          <Button label={t('pilot.save')} onPress={() => void save()} disabled={busy || !data.available} testID="pilot-save" />

          <SectionTitle>{t('pilot.decisions')}</SectionTitle>
          {decisions.error ? <ErrorState message={errorMessage(decisions.error)} /> : null}
          {(decisions.data?.items ?? []).map((d) => <DecisionCard key={d.id} decision={d} language={language} money={money} />)}
          {decisions.isFetched && !(decisions.data?.items ?? []).length ? <Empty message={t('pilot.noDecisions')} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

function DecisionCard({ decision, language, money }: { decision: PilotDecisionView; language: UiLanguage; money: (cents: number) => string }) {
  const { t } = useTranslation();
  const outcome = decision.cancelledInGraceAt ? t('pilot.cancelledInGrace') : decision.autoAcceptedAt ? t('pilot.autoAccepted') : t(`pilot.decisionLabels.${decision.decision}`);
  return (
    <Card style={styles.card}>
      <View style={styles.decisionHeader}>
        <View style={[styles.dot, { backgroundColor: SCORE_COLORS[decision.score] }]} />
        <Text style={styles.decisionTitle}>{outcome}</Text>
        <Text style={styles.decisionFare}>{money(decision.ride.driverFareCents)}</Text>
      </View>
      <Body muted>{decision.ride.requestedAt ? formatDateTime(decision.ride.requestedAt, language) : formatDateTime(decision.createdAt, language)}</Body>
      <Body muted>{`${decision.ride.originAddress} → ${decision.ride.destinationAddress}`}</Body>
      {decision.reasons.map((r, index) => <Body key={`${r.code}-${index}`} muted>{`· ${t(`pilot.reasons.${r.code}`, reasonParams(r, language))}`}</Body>)}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  chipsBlock: { gap: spacing.xs },
  chipsLabel: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center', backgroundColor: colors.white },
  chipSelected: { borderColor: colors.blue, backgroundColor: colors.tint },
  chipText: { fontSize: typography.sizes.sm, color: colors.ink },
  chipTextSelected: { color: colors.blueDark, fontWeight: '700' },
  decisionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  decisionTitle: { flex: 1, fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  decisionFare: { fontSize: typography.sizes.md, fontWeight: '700', color: colors.night, fontVariant: ['tabular-nums'] },
});
