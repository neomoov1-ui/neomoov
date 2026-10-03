import { Body, Button, Field } from '@neomoov/mobile-core/components';
import { ErrorState, Notice, Screen } from '@neomoov/mobile-core/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fleetInvitationError, fleetInvitationToken, isFleetInvitationToken } from '@/features/fleet/invitation';
import { api, errorCode, errorMessage, refreshRoles } from '@/lib/api';
import { usePendingFleetInvitation } from '@/lib/pending-join';
import { keys, queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Rejoindre une flotte comme chauffeur (étape 23), équivalent de la page web `/chauffeurs/rejoindre` : la personne
 * invitée par texto se connecte par code (même téléphone que l'invitation), puis accepte ; son profil chauffeur
 * (existant ou nouveau, candidat à compléter) est rattaché à l'organisation par l'API. Le jeton arrive par le lien
 * (`chauffeurs/rejoindre?token=…`) ou se colle (le lien entier du texto est accepté).
 */
export default function FleetInvitationScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token?: string }>();
  const status = useSession((s) => s.status);
  const [input, setInput] = useState(typeof params.token === 'string' ? params.token : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ name: string; created: boolean } | null>(null);
  const token = fleetInvitationToken(input);
  const valid = isFleetInvitationToken(token);

  async function accept() {
    if (!valid) {
      setError(t('fleetInvite.invalid'));
      return;
    }
    // Pas encore connecté : le jeton est gardé en mémoire, l'écran revient après la connexion par code.
    if (status !== 'signedIn') {
      usePendingFleetInvitation.getState().set(token);
      router.push('/login');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.driver.acceptFleetInvitation(token);
      // Profil chauffeur créé ou repris : rôle chauffeur dans un nouveau jeton, marque et accueil relus.
      await refreshRoles().catch(() => undefined);
      await Promise.all([keys.config, keys.home, keys.profile, keys.onboarding].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setJoined({ name: result.organizationName, created: result.created });
    } catch (e) {
      const known = fleetInvitationError(errorCode(e));
      setError(known ? t(`fleetInvite.errors.${known}`) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const next = () => router.replace(joined?.created ? '/onboarding' : '/home');
  return (
    <Screen
      back
      title={t('fleetInvite.title')}
      footer={joined ? <Button label={t('core:continue')} onPress={next} testID="fleet-invite-continue" /> : <Button label={busy ? t('fleetInvite.accepting') : t('fleetInvite.accept')} onPress={() => void accept()} disabled={busy || !valid} testID="fleet-invite-accept" />}
    >
      <Body muted>{t('fleetInvite.intro')}</Body>
      {joined ? null : <Field label={t('fleetInvite.tokenLabel')} hint={t('fleetInvite.tokenHint')} value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} maxLength={600} testID="fleet-invite-token" />}
      {status !== 'signedIn' && !joined ? <Notice>{t('fleetInvite.signInFirst')}</Notice> : null}
      <Notice>{t('fleetInvite.scope')}</Notice>
      {joined ? <Notice tone="success">{t(joined.created ? 'fleetInvite.doneNew' : 'fleetInvite.done', { name: joined.name })}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
