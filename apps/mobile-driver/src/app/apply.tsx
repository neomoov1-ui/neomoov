import type { DriverQualification } from '@neomoov/domain';
import { Body, Button, Field } from '@neomoov/mobile-core/components';
import { Choices, ErrorState, Screen } from '@neomoov/mobile-core/ui';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, refreshRoles } from '@/lib/api';
import { useHasDriverRole, useSession } from '@/lib/session';

/** Candidature (parcours 10) : le compte connecté devient chauffeur en attente ; le jeton est renouvelé avec le rôle. */
export default function ApplyScreen() {
  const { t, i18n } = useTranslation();
  const status = useSession((s) => s.status);
  const isDriver = useHasDriverRole();
  const user = useSession((s) => s.user);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [qualification, setQualification] = useState<DriverQualification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'signedIn') return <Redirect href="/" />;
  if (isDriver) return <Redirect href="/onboarding" />;

  async function submit() {
    if (!qualification) return;
    setBusy(true);
    setError(null);
    try {
      await api.driver.apply({ firstName: firstName.trim(), lastName: lastName.trim(), qualification, language: i18n.language === 'en' ? 'en' : 'fr', ...(email.trim() ? { email: email.trim() } : {}) });
      await refreshRoles();
      router.replace('/onboarding');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = firstName.trim().length > 0 && lastName.trim().length > 0 && qualification !== null;
  return (
    <Screen title={t('apply.title')} footer={<Button label={t('apply.submit')} onPress={() => void submit()} disabled={busy || !ready} testID="apply-submit" />}>
      <Body muted>{t('apply.intro')}</Body>
      <Field label={t('apply.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" maxLength={80} testID="first-name" />
      <Field label={t('apply.lastName')} value={lastName} onChangeText={setLastName} autoComplete="family-name" maxLength={80} testID="last-name" />
      <Field label={t('apply.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={254} />
      <Choices
        label={t('apply.qualification')}
        value={qualification}
        onChange={setQualification}
        options={(['saaq_authorized', 'registered'] as const).map((q) => ({ value: q, label: t(`apply.qualifications.${q}`) }))}
      />
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
