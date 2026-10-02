import { ALERT_SOUNDS, ALERT_TYPES, type AlertSound, type AlertType, type DriverAlertSettingsView } from '@neomoov/domain';
import { Body, Button, Card, Field } from '@neomoov/mobile-core/components';
import { colors, radius, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Loading, Notice, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { previewAlertSound } from '@/features/booster/sounds';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useBoosterAlerts } from '@/lib/queries';

const PALETTE = ['#1485E0', '#0B1F3A', '#16A34A', '#D97706', '#D64545', '#7C3AED'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type Form = Pick<DriverAlertSettingsView, 'sessionStart' | 'sessionEnd' | 'reminders' | 'styles'>;

/** Alertes de la journée (Neomoov Booster) : heures habituelles, rappels par type, son et couleur, test du son (local et par notification). */
export default function AlertsScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'fr';
  const settings = useBoosterAlerts();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = settings.data;

  useEffect(() => {
    if (data && !form) setForm({ sessionStart: data.sessionStart, sessionEnd: data.sessionEnd, reminders: data.reminders, styles: data.styles });
  }, [data, form]);

  const setStyle = (type: AlertType, patch: Partial<{ sound: AlertSound; color: string }>) => setForm((f) => (f ? { ...f, styles: { ...f.styles, [type]: { ...f.styles[type], ...patch } } } : f));

  async function save() {
    if (!form) return;
    setError(null);
    setNotice(null);
    if (!HHMM.test(form.sessionStart) || !HHMM.test(form.sessionEnd)) {
      setError(t('booster.alerts.timeInvalid'));
      return;
    }
    setBusy('save');
    try {
      const updated = await api.driver.updateAlertSettings(form);
      queryClient.setQueryData<DriverAlertSettingsView>(keys.boosterAlerts, updated);
      setNotice(t('booster.alerts.saved'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function testPush(type: AlertType) {
    setBusy(type);
    setError(null);
    try {
      await api.driver.testAlert({ type });
      setNotice(t('booster.alerts.testSent'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const windowText = (w: { label: { fr: string; en: string }; from: string; to: string; days: number[] }) => `${w.label[lang]} · ${w.from} à ${w.to} · ${w.days.map((d) => t(`booster.alerts.days.${d}`)).join(', ')}`;

  return (
    <Screen back title={t('booster.alerts.title')} onRefresh={() => void settings.refetch()} refreshing={settings.isRefetching}>
      <Body muted>{t('booster.alerts.intro')}</Body>
      {settings.isLoading ? <Loading /> : null}
      {settings.error ? <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} /> : null}
      {form && data ? (
        <>
          <Card style={styles.card}>
            <Field label={t('booster.alerts.sessionStart')} value={form.sessionStart} onChangeText={(v) => setForm({ ...form, sessionStart: v })} hint="HH:MM" maxLength={5} />
            <Field label={t('booster.alerts.sessionEnd')} value={form.sessionEnd} onChangeText={(v) => setForm({ ...form, sessionEnd: v })} hint="HH:MM" maxLength={5} />
            <Body muted>{t('booster.alerts.timeZone', { zone: data.timeZone })}</Body>
          </Card>

          <SectionTitle>{t('booster.alerts.reminders')}</SectionTitle>
          {ALERT_TYPES.map((type) => (
            <Card key={type} style={styles.card}>
              <ToggleRow label={t(`booster.alerts.types.${type}`)} hint={t(`booster.alerts.hints.${type}`)} value={form.reminders[type]} onChange={(v) => setForm({ ...form, reminders: { ...form.reminders, [type]: v } })} />
              {form.reminders[type] ? (
                <>
                  <Choices label={t('booster.alerts.sound')} value={form.styles[type].sound} onChange={(sound) => setStyle(type, { sound })} options={ALERT_SOUNDS.map((s) => ({ value: s, label: t(`booster.alerts.sounds.${s}`) }))} />
                  <Text style={styles.label}>{t('booster.alerts.color')}</Text>
                  <View style={styles.palette} accessibilityRole="radiogroup">
                    {PALETTE.map((color) => {
                      const selected = form.styles[type].color.toUpperCase() === color;
                      return <Pressable key={color} accessibilityRole="radio" accessibilityLabel={color} accessibilityState={{ selected }} onPress={() => setStyle(type, { color })} style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchSelected]} />;
                    })}
                  </View>
                  <View style={styles.buttons}>
                    <Button label={t('booster.alerts.listen')} variant="ghost" onPress={() => void previewAlertSound(form.styles[type].sound)} style={styles.flex} />
                    <Button label={busy === type ? t('booster.alerts.testing') : t('booster.alerts.testPush')} variant="secondary" onPress={() => void testPush(type)} disabled={busy !== null} style={styles.flex} />
                  </View>
                </>
              ) : null}
            </Card>
          ))}

          <SectionTitle>{t('booster.alerts.peakPeriods')}</SectionTitle>
          <Card style={styles.card}>
            {data.peakPeriods.length ? data.peakPeriods.map((w, i) => <Body key={i} muted>{`· ${windowText(w)}`}</Body>) : <Body muted>{t('booster.alerts.none')}</Body>}
          </Card>
          <SectionTitle>{t('booster.alerts.peakZones')}</SectionTitle>
          <Card style={styles.card}>
            {data.peakZones.length ? data.peakZones.map((w, i) => <Body key={i} muted>{`· ${windowText(w)}`}</Body>) : <Body muted>{t('booster.alerts.none')}</Body>}
            <Body muted>{t('booster.alerts.peakNote')}</Body>
          </Card>

          {notice ? <Notice tone="success">{notice}</Notice> : null}
          {error ? <ErrorState message={error} /> : null}
          <Button label={t('booster.alerts.save')} onPress={() => void save()} disabled={busy !== null} testID="alerts-save" />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  label: { fontSize: typography.sizes.sm, fontWeight: '700', color: colors.ink },
  palette: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  swatch: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.white },
  swatchSelected: { borderColor: colors.night, transform: [{ scale: 1.15 }] },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
