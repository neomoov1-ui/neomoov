import type { Place, RidePreferences } from '@neomoov/domain';
import { Body, Button, Card, Field, Sheet } from '@neomoov/mobile-core/components';
import { SUPPORTED_LANGUAGES } from '@neomoov/mobile-core/i18n';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddressField } from '@/components/AddressField';
import { Choices, ErrorState, Notice, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { api, errorMessage, offlineQueue } from '@/lib/api';
import { displayPhone } from '@/lib/phone';
import { keys, queryClient, useAppConfig, useConsents, usePlaces, usePreferences } from '@/lib/queries';
import { unregisterPush } from '@/lib/push';
import { disconnectRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';

/**
 * Profil : langue, préférences de confort, lieux enregistrés, consentements, droits (copie des données), factures,
 * assistance, déconnexion et suppression du compte dans l'application (exigence des magasins).
 */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const config = useAppConfig();
  const saved = usePreferences();
  const places = usePlaces();
  const consents = useConsents();
  const [preferences, setPreferences] = useState<RidePreferences | null>(null);
  const [placeLabel, setPlaceLabel] = useState('');
  const [placeValue, setPlaceValue] = useState<Place | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved.data && !preferences) setPreferences(saved.data);
  }, [saved.data, preferences]);

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

  const changeLanguage = (language: string) =>
    run(async () => {
      await i18n.changeLanguage(language);
      const updated = await api.me.update({ language: language === 'en' ? 'en' : 'fr' });
      await useSession.getState().setUser(updated);
    });

  const savePreferences = () =>
    run(async () => {
      if (!preferences) return;
      queryClient.setQueryData(keys.preferences, await api.me.setPreferences(preferences));
    }, t('profile.preferencesSaved'));

  const addPlace = () =>
    run(async () => {
      if (!placeValue || !placeLabel.trim()) return;
      await api.me.addPlace({ label: placeLabel.trim(), address: placeValue.address, coordinates: placeValue.coordinates });
      setPlaceLabel('');
      setPlaceValue(null);
      await queryClient.invalidateQueries({ queryKey: keys.places });
    });

  const setConsent = (purpose: 'geolocation' | 'marketing', granted: boolean) =>
    run(async () => {
      if (!config.data) return;
      await api.me.setConsent({ purpose, granted, version: config.data.legal.privacyPolicyVersion, source: 'app' });
      await queryClient.invalidateQueries({ queryKey: keys.consents });
    });

  const logout = () =>
    run(async () => {
      const refreshToken = useSession.getState().refreshToken;
      await unregisterPush();
      await api.auth.logout(refreshToken ? { refreshToken } : {}).catch(() => undefined);
      await offlineQueue.clear();
      disconnectRealtime();
      queryClient.clear();
      await useSession.getState().signOut();
      router.replace('/');
    });

  const deleteAccount = () =>
    run(async () => {
      await api.me.remove();
      await offlineQueue.clear();
      disconnectRealtime();
      queryClient.clear();
      await useSession.getState().signOut();
      router.replace('/');
    });

  const granted = (purpose: string) => consents.data?.find((c) => c.purpose === purpose)?.granted ?? false;
  const current = i18n.language === 'en' ? 'en' : 'fr-CA';

  return (
    <Screen title={t('profile.title')}>
      {user ? (
        <Card>
          <Row label={t('auth.phoneLabel')} value={displayPhone(user.phone)} />
        </Card>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}

      <Choices label={t('profile.language')} value={current} onChange={(l) => void changeLanguage(l)} options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: l === 'en' ? 'English' : 'Français' }))} />

      <SectionTitle>{t('profile.preferences')}</SectionTitle>
      {preferences ? (
        <>
          <Choices label={t('confirm.conversation')} value={preferences.conversation} onChange={(conversation) => setPreferences({ ...preferences, conversation })} options={(['silence', 'chat', 'indifferent'] as const).map((v) => ({ value: v, label: t(`confirm.conversationValues.${v}`) }))} />
          <Choices label={t('confirm.music')} value={preferences.music} onChange={(music) => setPreferences({ ...preferences, music })} options={(['none', 'soft', 'client_choice', 'indifferent'] as const).map((v) => ({ value: v, label: t(`confirm.musicValues.${v}`) }))} />
          <Choices label={t('confirm.temperature')} value={preferences.temperature} onChange={(temperature) => setPreferences({ ...preferences, temperature })} options={(['cool', 'neutral', 'warm'] as const).map((v) => ({ value: v, label: t(`confirm.temperatureValues.${v}`) }))} />
          <ToggleRow label={t('confirm.luggageHelp')} value={preferences.luggageHelp} onChange={(luggageHelp) => setPreferences({ ...preferences, luggageHelp })} />
          <ToggleRow label={t('confirm.accessibility')} value={preferences.accessibility ?? false} onChange={(accessibility) => setPreferences({ ...preferences, accessibility })} />
          <Button label={t('profile.save')} variant="ghost" onPress={() => void savePreferences()} disabled={busy} />
        </>
      ) : null}

      <SectionTitle>{t('profile.places')}</SectionTitle>
      {(places.data ?? []).length === 0 ? <Body muted>{t('profile.noPlaces')}</Body> : null}
      {(places.data ?? []).map((p) => (
        <Card key={p.id}>
          <Row label={p.label} value={p.address} />
          <Button label={t('profile.removePlace')} variant="ghost" onPress={() => void run(async () => {
            await api.me.removePlace(p.id);
            await queryClient.invalidateQueries({ queryKey: keys.places });
          })} />
        </Card>
      ))}
      <Field label={t('profile.placeLabel')} value={placeLabel} onChangeText={setPlaceLabel} maxLength={60} />
      <AddressField label={t('book.searchPlaceholder')} value={placeValue} onChange={setPlaceValue} />
      <Button label={t('profile.addPlace')} variant="ghost" onPress={() => void addPlace()} disabled={busy || !placeValue || !placeLabel.trim()} />

      <SectionTitle>{t('profile.myDrivers')}</SectionTitle>
      <Body muted>{t('profile.myDriversSoon')}</Body>

      <SectionTitle>{t('profile.consents')}</SectionTitle>
      <ToggleRow label={t('consents.geolocation')} hint={t('consents.geolocationHint')} value={granted('geolocation')} onChange={(v) => void setConsent('geolocation', v)} />
      <ToggleRow label={t('consents.marketing')} hint={t('consents.marketingHint')} value={granted('marketing')} onChange={(v) => void setConsent('marketing', v)} />
      <Button label={t('profile.dataAccess')} variant="ghost" onPress={() => void run(async () => {
        await api.me.createDataRequest({ type: 'access' });
      }, t('profile.dataRequested'))} disabled={busy} />

      <Button label={t('profile.invoices')} variant="ghost" onPress={() => router.push('/invoices')} />
      <Button label={t('profile.support')} variant="ghost" onPress={() => router.push('/support')} />
      <Button label={t('profile.logout')} variant="ghost" onPress={() => void logout()} disabled={busy} />
      <Button label={t('profile.deleteAccount')} variant="danger" onPress={() => setConfirmDelete(true)} disabled={busy} />

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('profile.deleteAccount')} closeLabel={t('core:close')}>
        <Body>{t('profile.deleteConfirm')}</Body>
        <Button label={t('profile.deleteAccount')} variant="danger" onPress={() => void deleteAccount()} disabled={busy} />
      </Sheet>
    </Screen>
  );
}
