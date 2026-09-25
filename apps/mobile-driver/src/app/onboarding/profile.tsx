import { gstNumber, qstNumber } from '@neomoov/domain';
import { Button, Field } from '@neomoov/mobile-core/components';
import { ErrorState, Notice, Screen, SectionTitle, ToggleRow } from '@neomoov/mobile-core/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useProfile } from '@/lib/queries';

const MAIN_LANGUAGES = ['fr', 'en'] as const;

/** Identité et taxes : numéros de TPS et TVQ (validés par le domaine), langues parlées, expérience. */
export default function ProfileFormScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  const [gst, setGst] = useState('');
  const [qst, setQst] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [languages, setLanguages] = useState<string[]>(['fr']);
  const [others, setOthers] = useState('');
  const [experience, setExperience] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = profile.data;
    if (!p || loaded) return;
    setGst(p.gstNumber ?? '');
    setQst(p.qstNumber ?? '');
    setTradeName(p.tradeName ?? '');
    setLanguages(p.spokenLanguages.filter((l) => (MAIN_LANGUAGES as readonly string[]).includes(l)));
    setOthers(p.spokenLanguages.filter((l) => !(MAIN_LANGUAGES as readonly string[]).includes(l)).join(', '));
    setExperience(p.experienceYears !== null ? String(p.experienceYears) : '');
    setLoaded(true);
  }, [profile.data, loaded]);

  const gstInvalid = gst.trim().length > 0 && !gstNumber.safeParse(gst).success;
  const qstInvalid = qst.trim().length > 0 && !qstNumber.safeParse(qst).success;

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const extra = others.split(',').map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2}$/.test(l));
      const years = Number.parseInt(experience, 10);
      const updated = await api.driver.updateProfile({
        gstNumber: gst.trim() || null,
        qstNumber: qst.trim() || null,
        tradeName: tradeName.trim() || null,
        spokenLanguages: [...new Set([...languages, ...extra])],
        ...(Number.isFinite(years) ? { experienceYears: Math.min(60, Math.max(0, years)) } : {}),
      });
      queryClient.setQueryData(keys.profile, updated);
      await queryClient.invalidateQueries({ queryKey: keys.onboarding });
      setNotice(t('profileForm.saved'));
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('profileForm.title')} footer={<Button label={t('profileForm.save')} onPress={() => void save()} disabled={busy || gstInvalid || qstInvalid} testID="profile-save" />}>
      <Field label={t('profileForm.gst')} hint={t('profileForm.gstHint')} value={gst} onChangeText={setGst} autoCapitalize="characters" maxLength={20} testID="gst" {...(gstInvalid ? { error: t('profileForm.invalidGst') } : {})} />
      <Field label={t('profileForm.qst')} hint={t('profileForm.qstHint')} value={qst} onChangeText={setQst} autoCapitalize="characters" maxLength={20} testID="qst" {...(qstInvalid ? { error: t('profileForm.invalidQst') } : {})} />
      <Field label={t('profileForm.tradeName')} value={tradeName} onChangeText={setTradeName} maxLength={150} />
      <SectionTitle>{t('profileForm.languages')}</SectionTitle>
      {MAIN_LANGUAGES.map((l) => (
        <ToggleRow key={l} label={l === 'fr' ? 'Français' : 'English'} value={languages.includes(l)} onChange={(on) => setLanguages((list) => (on ? [...list, l] : list.filter((x) => x !== l)))} />
      ))}
      <Field label={t('profileForm.otherLanguages')} value={others} onChangeText={setOthers} autoCapitalize="none" maxLength={60} />
      <Field label={t('profileForm.experience')} value={experience} onChangeText={(v) => setExperience(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} testID="experience" />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
