import type { PerformanceLogInput, PerformanceLogView, PerformancePeriod } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, Empty, ErrorState, Loading, Notice, Row, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { pickBoosterPhoto, screenshotsForm } from '@/features/booster/photos';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, type UiLanguage } from '@/lib/format';
import { keys, queryClient, useBoosterPerformance, useBoosterRecap } from '@/lib/queries';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Form {
  date: string; startTime: string; endTime: string; startEnergy: string; endEnergy: string; startOdometer: string; endOdometer: string; onlineMinutes: string; drivingMinutes: string;
  ridesCount: string; rides: string; tips: string; promotions: string; energy: string; cleaning: string; points: string; notes: string;
}
const EMPTY: Form = { date: today(), startTime: '', endTime: '', startEnergy: '', endEnergy: '', startOdometer: '', endOdometer: '', onlineMinutes: '', drivingMinutes: '', ridesCount: '', rides: '', tips: '', promotions: '', energy: '', cleaning: '', points: '', notes: '' };

const timeOf = (iso: string | null): string => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');
const dollars = (cents: number): string => (cents ? (cents / 100).toFixed(2) : '');
const num = (v: string): string => (v === null ? '' : String(v));

function formOf(l: PerformanceLogView): Form {
  return {
    date: l.date, startTime: timeOf(l.startedAt), endTime: timeOf(l.endedAt), startEnergy: num(l.startEnergyPercent?.toString() ?? ''), endEnergy: l.endEnergyPercent?.toString() ?? '',
    startOdometer: l.startOdometerKm?.toString() ?? '', endOdometer: l.endOdometerKm?.toString() ?? '', onlineMinutes: l.onlineMinutes?.toString() ?? '', drivingMinutes: l.drivingMinutes?.toString() ?? '',
    ridesCount: l.ridesCount?.toString() ?? '', rides: dollars(l.ridesCents), tips: dollars(l.tipsCents), promotions: dollars(l.promotionsCents), energy: dollars(l.energyCents), cleaning: dollars(l.cleaningCents),
    points: l.points?.toString() ?? '', notes: l.otherNotes ?? '',
  };
}

const int = (v: string): number | null => (v.trim() === '' ? null : Number.isInteger(Number(v)) ? Number(v) : Number.NaN);
const cents = (v: string): number | null => (v.trim() === '' ? 0 : /^\d+([.,]\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v.trim().replace(',', '.')) * 100) : null);
/** Heure locale de l'appareil (chauffeur à Montréal) en instant ISO. */
const instant = (date: string, time: string): string | null => (HHMM.test(time) ? new Date(`${date}T${time}:00`).toISOString() : null);

/**
 * Rapport de performance (Neomoov Booster) : formulaire départ et arrivée, lecture de captures d'écran des
 * applications (aide à la saisie, confirmée par le chauffeur), confirmation, récapitulatifs hebdomadaire et mensuel, sessions.
 */
export default function PerformanceScreen() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'en' ? 'en' : 'fr-CA') as UiLanguage;
  const money = (c: number | null) => (c === null ? '—' : formatMoney(c, language));
  const [form, setForm] = useState<Form>(EMPTY);
  const [draft, setDraft] = useState<PerformanceLogView | null>(null);
  const [period, setPeriod] = useState<PerformancePeriod>('week');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessions = useBoosterPerformance({ pageSize: 20 });
  const recap = useBoosterRecap(period);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function payload(): PerformanceLogInput | null {
    const ints = { startEnergyPercent: int(form.startEnergy), endEnergyPercent: int(form.endEnergy), startOdometerKm: int(form.startOdometer), endOdometerKm: int(form.endOdometer), onlineMinutes: int(form.onlineMinutes), drivingMinutes: int(form.drivingMinutes), ridesCount: int(form.ridesCount), points: int(form.points) };
    const amounts = { ridesCents: cents(form.rides), tipsCents: cents(form.tips), promotionsCents: cents(form.promotions), energyCents: cents(form.energy), cleaningCents: cents(form.cleaning) };
    if (Object.values(ints).some((v) => Number.isNaN(v)) || Object.values(amounts).some((v) => v === null) || (form.startTime && !HHMM.test(form.startTime)) || (form.endTime && !HHMM.test(form.endTime))) {
      setError(t('booster.performance.invalid'));
      return null;
    }
    return { date: form.date, startedAt: instant(form.date, form.startTime), endedAt: instant(form.date, form.endTime), ...ints, ...(amounts as Record<keyof typeof amounts, number>), otherNotes: form.notes.trim() || null };
  }

  async function ensureDraft(): Promise<PerformanceLogView | null> {
    const body = payload();
    if (!body) return null;
    const saved = draft ? await api.driver.updatePerformance(draft.id, body) : await api.driver.createPerformance(body);
    setDraft(saved);
    return saved;
  }

  async function readScreenshots() {
    setError(null);
    setNotice(null);
    const picked = await pickBoosterPhoto('library', { multiple: true });
    if (picked === 'denied' || !picked.length) return;
    setBusy('read');
    try {
      const current = await ensureDraft();
      if (!current) return;
      await api.driver.addPerformanceScreenshots(current.id, await screenshotsForm(picked));
      const read = await api.driver.analysePerformance(current.id);
      setDraft(read);
      setForm(formOf(read));
      setNotice(read.reading.status === 'done' ? t('booster.performance.read', { percent: Math.round((read.reading.confidence ?? 0) * 100), app: read.reading.app ?? '' }) : t('booster.performance.readFailed'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(confirm: boolean) {
    setError(null);
    setNotice(null);
    setBusy(confirm ? 'confirm' : 'save');
    try {
      const current = await ensureDraft();
      if (!current) return;
      if (confirm) {
        const body = payload();
        if (!body) return;
        await api.driver.confirmPerformance(current.id, body);
        setDraft(null);
        setForm(EMPTY);
        setNotice(t('booster.performance.confirmed'));
      } else {
        setNotice(t('booster.performance.saved'));
      }
      void queryClient.invalidateQueries({ queryKey: keys.boosterPerformance });
      void queryClient.invalidateQueries({ queryKey: ['booster-recap'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function open(l: PerformanceLogView) {
    setBusy(l.id);
    try {
      await Linking.openURL((await api.driver.performanceDownload(l.id)).url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen back title={t('booster.performance.title')} onRefresh={() => void Promise.all([sessions.refetch(), recap.refetch()])} refreshing={sessions.isRefetching}>
      <Body muted>{t('booster.performance.intro')}</Body>
      <SectionTitle>{draft ? t('booster.performance.draft', { date: draft.date }) : t('booster.performance.newSession')}</SectionTitle>
      <Card style={styles.card}>
        <Field label={t('booster.performance.date')} value={form.date} onChangeText={(v) => set('date', v)} autoCapitalize="none" maxLength={10} hint="AAAA-MM-JJ" />
        <Button label={busy === 'read' ? t('booster.performance.reading') : t('booster.performance.readScreenshots')} variant="secondary" onPress={() => void readScreenshots()} disabled={busy !== null} testID="performance-read" />
        <Body muted>{t('booster.performance.readHint')}</Body>
        <Text style={styles.group}>{t('booster.performance.atStart')}</Text>
        <Field label={t('booster.performance.time')} value={form.startTime} onChangeText={(v) => set('startTime', v)} hint="HH:MM" maxLength={5} />
        <Field label={t('booster.performance.energy')} value={form.startEnergy} onChangeText={(v) => set('startEnergy', v)} keyboardType="number-pad" maxLength={3} />
        <Field label={t('booster.performance.odometer')} value={form.startOdometer} onChangeText={(v) => set('startOdometer', v)} keyboardType="number-pad" maxLength={7} />
        <Text style={styles.group}>{t('booster.performance.atEnd')}</Text>
        <Field label={t('booster.performance.time')} value={form.endTime} onChangeText={(v) => set('endTime', v)} hint="HH:MM" maxLength={5} />
        <Field label={t('booster.performance.energy')} value={form.endEnergy} onChangeText={(v) => set('endEnergy', v)} keyboardType="number-pad" maxLength={3} />
        <Field label={t('booster.performance.odometer')} value={form.endOdometer} onChangeText={(v) => set('endOdometer', v)} keyboardType="number-pad" maxLength={7} />
        <Field label={t('booster.performance.onlineMinutes')} value={form.onlineMinutes} onChangeText={(v) => set('onlineMinutes', v)} keyboardType="number-pad" maxLength={4} />
        <Field label={t('booster.performance.drivingMinutes')} value={form.drivingMinutes} onChangeText={(v) => set('drivingMinutes', v)} keyboardType="number-pad" maxLength={4} />
        <Field label={t('booster.performance.ridesCount')} value={form.ridesCount} onChangeText={(v) => set('ridesCount', v)} keyboardType="number-pad" maxLength={3} />
        <Field label={t('booster.performance.rides')} value={form.rides} onChangeText={(v) => set('rides', v)} keyboardType="decimal-pad" maxLength={9} />
        <Field label={t('booster.performance.tips')} value={form.tips} onChangeText={(v) => set('tips', v)} keyboardType="decimal-pad" maxLength={9} />
        <Field label={t('booster.performance.promotions')} value={form.promotions} onChangeText={(v) => set('promotions', v)} keyboardType="decimal-pad" maxLength={9} />
        <Field label={t('booster.performance.energyCost')} value={form.energy} onChangeText={(v) => set('energy', v)} keyboardType="decimal-pad" maxLength={9} />
        <Field label={t('booster.performance.cleaning')} value={form.cleaning} onChangeText={(v) => set('cleaning', v)} keyboardType="decimal-pad" maxLength={9} />
        <Field label={t('booster.performance.points')} value={form.points} onChangeText={(v) => set('points', v)} keyboardType="number-pad" maxLength={7} />
        <Field label={t('booster.performance.notes')} value={form.notes} onChangeText={(v) => set('notes', v)} multiline maxLength={500} />
        {draft ? <Row label={t('booster.performance.net')} value={money(draft.summary.netCents)} strong /> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        {error ? <ErrorState message={error} /> : null}
        <View style={styles.buttons}>
          <Button label={t('booster.performance.save')} variant="secondary" onPress={() => void save(false)} disabled={busy !== null} style={styles.flex} />
          <Button label={busy === 'confirm' ? t('booster.performance.confirming') : t('booster.performance.confirm')} onPress={() => void save(true)} disabled={busy !== null} style={styles.flex} testID="performance-confirm" />
        </View>
      </Card>

      <SectionTitle>{t('booster.performance.recap')}</SectionTitle>
      <Choices value={period} onChange={setPeriod} options={[{ value: 'week', label: t('booster.performance.week') }, { value: 'month', label: t('booster.performance.month') }]} />
      {recap.isLoading ? <Loading /> : null}
      {recap.data ? (
        <Card style={styles.card}>
          <Text style={styles.group}>{recap.data.label} · {recap.data.start} → {recap.data.end}</Text>
          <Row label={t('booster.performance.sessions')} value={String(recap.data.totals.sessions)} />
          <Row label={t('booster.performance.hours')} value={`${(recap.data.totals.minutes / 60).toFixed(1)} h`} />
          <Row label={t('booster.performance.km')} value={`${recap.data.totals.distanceKm} km`} />
          <Row label={t('booster.performance.ridesCount')} value={String(recap.data.totals.rides)} />
          <Row label={t('booster.performance.gross')} value={money(recap.data.totals.grossCents)} />
          <Row label={t('booster.performance.costs')} value={money(recap.data.totals.costsCents)} />
          <Row label={t('booster.performance.net')} value={money(recap.data.totals.netCents)} strong />
          <Row label={t('booster.performance.perHour')} value={money(recap.data.totals.netPerHourCents)} />
          <Row label={t('booster.performance.perKm')} value={money(recap.data.totals.netPerKmCents)} />
        </Card>
      ) : null}

      <SectionTitle>{t('booster.performance.mySessions')}</SectionTitle>
      {sessions.error ? <ErrorState message={errorMessage(sessions.error)} /> : null}
      {(sessions.data?.items ?? []).map((l) => (
        <Card key={l.id} style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{l.date}</Text>
            <Text style={styles.status}>{t(`booster.statuses.${l.status}`)}</Text>
          </View>
          <Body muted>{[l.summary.basisMinutes !== null ? `${(l.summary.basisMinutes / 60).toFixed(1)} h` : null, l.summary.distanceKm !== null ? `${l.summary.distanceKm} km` : null, l.ridesCount !== null ? t('booster.performance.ridesShort', { count: l.ridesCount }) : null, `${t('booster.performance.net')} ${money(l.summary.netCents)}`].filter(Boolean).join(' · ')}</Body>
          {l.status === 'confirmed' ? <Button label={t('booster.inspection.downloadPdf')} variant="ghost" onPress={() => void open(l)} disabled={busy !== null} /> : <Button label={t('booster.reports.resume')} variant="ghost" onPress={() => { setDraft(l); setForm(formOf(l)); }} />}
        </Card>
      ))}
      {sessions.isFetched && !(sessions.data?.items ?? []).length ? <Empty message={t('booster.performance.empty')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  group: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink, marginTop: spacing.xs },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: typography.sizes.md, fontWeight: '700', color: colors.night },
  status: { fontSize: typography.sizes.xs, color: colors.muted },
});
