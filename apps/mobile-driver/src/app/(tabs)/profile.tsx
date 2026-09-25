import { SUPPORTED_LANGUAGES } from '@neomoov/mobile-core/i18n';
import { Body, Button, Card, Field, Sheet } from '@neomoov/mobile-core/components';
import { displayPhone } from '@neomoov/mobile-core/phone';
import { colors, spacing, typography } from '@neomoov/mobile-core/theme';
import { Choices, ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { changeStatus } from '@/lib/presence';
import { usePreferences } from '@/lib/preferences';
import { unregisterPush } from '@/lib/push';
import { keys, queryClient, useAppConfig, useConsents, useHome, useProfile, useVehicles } from '@/lib/queries';
import { disconnectRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { stopLocationUpdates } from '@/lib/location';

const LINKS: Array<{ key: 'packs' | 'loyal' | 'score' | 'training' | 'payout' | 'onboarding' | 'support'; href: Href; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'packs', href: '/packs', icon: 'albums-outline' },
  { key: 'loyal', href: '/loyal-clients', icon: 'people-outline' },
  { key: 'score', href: '/score', icon: 'speedometer-outline' },
  { key: 'training', href: '/training', icon: 'school-outline' },
  { key: 'payout', href: '/payout', icon: 'card-outline' },
  { key: 'onboarding', href: '/onboarding', icon: 'list-outline' },
  { key: 'support', href: '/support', icon: 'shield-checkmark-outline' },
];

/**
 * Profil (6.2) : identité, véhicule, langue, modes de paiement acceptés, planifiées, zones préférées, consentements
 * (retrait de la géolocalisation avec sa conséquence expliquée), réglages de l'appareil, droits, déconnexion et
 * suppression du compte dans l'application.
 */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const profile = useProfile();
  const vehicles = useVehicles();
  const consents = useConsents();
  const config = useAppConfig();
  const home = useHome();
  const dataSaver = usePreferences((s) => s.dataSaver);
  const navigationApp = usePreferences((s) => s.navigationApp);
  const [cash, setCash] = useState(false);
  const [interac, setInterac] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [interacEmail, setInteracEmail] = useState('');
  const [scheduled, setScheduled] = useState(true);
  const [zones, setZones] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<'geolocation' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = profile.data;
  const vehicle = vehicles.data?.find((v) => v.current);

  useEffect(() => {
    if (!p || loaded) return;
    setCash(p.paymentModes.cash);
    setInterac(p.paymentModes.interac);
    setTerminal(p.paymentModes.terminal);
    setInteracEmail(p.paymentModes.interacEmail ?? '');
    setScheduled(p.acceptsScheduled);
    setZones(p.preferredZones.join(', '));
    setLoaded(true);
  }, [p, loaded]);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const updated = await api.driver.updateProfile({
        acceptsCash: cash, acceptsInterac: interac, acceptsTerminal: terminal, interacEmail: interacEmail.trim() || null, acceptsScheduled: scheduled,
        preferredZones: zones.split(',').map((z) => z.trim().toLowerCase()).filter(Boolean),
      });
      queryClient.setQueryData(keys.profile, updated);
    }, t('profile.saved'));

  const changeLanguage = (language: string) =>
    run(async () => {
      await i18n.changeLanguage(language);
      await useSession.getState().setUser(await api.me.update({ language: language === 'en' ? 'en' : 'fr' }));
    });

  const granted = (purpose: string) => consents.data?.find((c) => c.purpose === purpose)?.granted ?? false;
  const setConsent = (purpose: 'geolocation' | 'marketing', value: boolean) =>
    run(async () => {
      if (!config.data) return;
      // Retrait de la géolocalisation : hors ligne d'abord, plus aucune position ne part.
      if (purpose === 'geolocation' && !value && home.data?.presence.status !== 'offline') await changeStatus('offline');
      await api.me.setConsent({ purpose, granted: value, version: config.data.legal.privacyPolicyVersion, source: 'app' });
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.consents }), queryClient.invalidateQueries({ queryKey: keys.home })]);
      setSheet(null);
    });

  const signOut = async () => {
    await stopLocationUpdates();
    disconnectRealtime();
    queryClient.clear();
    await useSession.getState().signOut();
    router.replace('/');
  };

  const logout = () =>
    run(async () => {
      const refreshToken = useSession.getState().refreshToken;
      if (home.data?.presence.status !== 'offline') await changeStatus('offline').catch(() => undefined);
      await unregisterPush();
      await api.auth.logout(refreshToken ? { refreshToken } : {}).catch(() => undefined);
      await signOut();
    });

  const deleteAccount = () =>
    run(async () => {
      await changeStatus('offline').catch(() => undefined);
      await api.me.remove();
      await signOut();
    });

  return (
    <Screen title={t('profile.title')} subtitle={p ? t('profile.number', { number: p.publicNumber }) : undefined}>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
      {p ? (
        <Card>
          <Row label={t('profile.identity')} value={[p.firstName, p.lastName].filter(Boolean).join(' ')} strong />
          <Row label={t('profile.phone')} value={displayPhone(p.phone)} />
          <Row label={t('profile.vehicle')} value={vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.plate}` : t('profile.noVehicle')} />
        </Card>
      ) : null}
      <Button label={t('profile.manageVehicle')} variant="ghost" onPress={() => router.push('/onboarding/vehicle')} />

      <Choices label={t('profile.language')} value={i18n.language === 'en' ? 'en' : 'fr-CA'} onChange={(l) => void changeLanguage(l)} options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: l === 'en' ? 'English' : 'Français' }))} />

      <SectionTitle>{t('profile.paymentModes')}</SectionTitle>
      <Body muted>{t('profile.card')}</Body>
      <ToggleRow label={t('profile.cash')} value={cash} onChange={setCash} />
      <ToggleRow label={t('profile.interac')} value={interac} onChange={setInterac} />
      {interac ? <Field label={t('profile.interacEmail')} value={interacEmail} onChangeText={setInteracEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} /> : null}
      <ToggleRow label={t('profile.terminal')} value={terminal} onChange={setTerminal} />
      <Body muted>{t('profile.paymentModesHint')}</Body>
      <ToggleRow label={t('profile.acceptsScheduled')} value={scheduled} onChange={setScheduled} />
      <Field label={t('profile.zones')} hint={t('profile.zonesHint')} value={zones} onChangeText={setZones} autoCapitalize="none" maxLength={200} />
      <Button label={t('profile.save')} variant="secondary" onPress={() => void save()} disabled={busy || !loaded} testID="profile-save" />

      <SectionTitle>{t('profile.more')}</SectionTitle>
      {LINKS.map((l) => (
        <Pressable key={l.key} accessibilityRole="button" onPress={() => router.push(l.href)} style={styles.link}>
          <Ionicons name={l.icon} size={22} color={colors.blue} />
          <Text style={styles.linkText}>{t(`profile.links.${l.key}`)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ))}
      {config.data?.features.faceCheck ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/face-check')} style={styles.link}>
          <Ionicons name="scan-outline" size={22} color={colors.blue} />
          <Text style={styles.linkText}>{t('profile.links.faceCheck')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ) : null}

      <SectionTitle>{t('profile.consents')}</SectionTitle>
      <ToggleRow label={t('profile.geolocation')} hint={t('profile.geolocationHint')} value={granted('geolocation')} onChange={(v) => (v ? void setConsent('geolocation', true) : setSheet('geolocation'))} />
      <ToggleRow label={t('profile.marketing')} value={granted('marketing')} onChange={(v) => void setConsent('marketing', v)} />
      <ToggleRow label={t('profile.dataSaver')} hint={t('profile.dataSaverHint')} value={dataSaver} onChange={(v) => void usePreferences.getState().set({ dataSaver: v })} />
      <Choices label={t('profile.navigationApp')} value={navigationApp} onChange={(v) => void usePreferences.getState().set({ navigationApp: v })} options={(['google', 'waze'] as const).map((a) => ({ value: a, label: t(`ride.apps.${a}`) }))} />
      <Button label={t('profile.dataAccess')} variant="ghost" onPress={() => void run(async () => void (await api.me.createDataRequest({ type: 'access' })), t('profile.dataRequested'))} disabled={busy} />

      <Button label={t('profile.logout')} variant="ghost" onPress={() => void logout()} disabled={busy} testID="logout" />
      <Button label={t('profile.deleteAccount')} variant="danger" onPress={() => setSheet('delete')} disabled={busy} />

      <Sheet visible={sheet === 'geolocation'} onClose={() => setSheet(null)} title={t('profile.geolocationWithdrawTitle')} closeLabel={t('core:close')}>
        <Body>{t('profile.geolocationWithdrawBody')}</Body>
        <Button label={t('profile.geolocationWithdrawConfirm')} variant="danger" onPress={() => void setConsent('geolocation', false)} disabled={busy} />
      </Sheet>
      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={t('profile.deleteAccount')} closeLabel={t('core:close')}>
        <Body>{t('profile.deleteConfirm')}</Body>
        <Button label={t('profile.deleteAccount')} variant="danger" onPress={() => void deleteAccount()} disabled={busy} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  linkText: { flex: 1, fontSize: typography.sizes.md, color: colors.ink, fontWeight: '600' },
});
