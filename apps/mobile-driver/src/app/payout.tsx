import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { withLanguage } from '@neomoov/mobile-core/format';
import { ErrorState, Loading, Notice, Screen, SectionTitle } from '@neomoov/mobile-core/ui';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useDebitStatus, usePayout } from '@/lib/queries';

/** Retour du navigateur intégré (inscription Stripe, page de saisie de carte) : cet écran, par lien profond. */
const RETURN_URL = 'neomoov-driver://payout';

/**
 * Compte de versement (6.2) : avec Stripe Connect, parcours d'inscription Express ouvert dans l'application (navigateur
 * intégré), puis état relu à l'API ; avec le fournisseur simulé, l'inscription est déjà faite. Avec Square (étape 26),
 * aucun compte à ouvrir : les relevés positifs sont versés par virement chaque semaine. Carte de prélèvement des relevés
 * négatifs : page de saisie du web (Square) ou carte de test (simulateur).
 */
export default function PayoutScreen() {
  const { t, i18n } = useTranslation();
  const payout = usePayout();
  const debit = useDebitStatus();
  const [busy, setBusy] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = payout.data;
  const offline = data?.payoutMode === 'offline';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const link = await api.driver.payoutLink();
      setSimulated(link.simulated);
      if (!link.simulated) await WebBrowser.openAuthSessionAsync(link.url, RETURN_URL);
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.payout }), queryClient.invalidateQueries({ queryKey: keys.onboarding }), queryClient.invalidateQueries({ queryKey: keys.home })]);
    });

  const addDebitCard = () =>
    run(async () => {
      const setup = await api.payments.debitSetupIntent();
      if (setup.provider === 'square' && setup.cardFormUrl) {
        await WebBrowser.openAuthSessionAsync(withLanguage(setup.cardFormUrl, i18n.language === 'en' ? 'en' : 'fr-CA'), RETURN_URL);
      } else if (setup.provider === 'mock' && setup.setupIntentId) {
        await api.payments.confirmDebit(setup.setupIntentId);
        setNotice(t('payout.debitSimulated'));
      } else {
        setError(t('payout.debitUnavailable'));
      }
      await queryClient.invalidateQueries({ queryKey: keys.debit });
    });

  const card = debit.data?.debitMethod ?? null;
  return (
    <Screen back title={t('payout.title')} footer={data && !offline && !data.onboarded ? <Button label={data.linked ? t('payout.resume') : t('payout.start')} onPress={() => void start()} disabled={busy} testID="payout-start" /> : undefined}>
      <Body muted>{offline ? t('payout.offlineIntro') : t('payout.intro')}</Body>
      {payout.isLoading ? <Loading /> : null}
      {payout.error ? <ErrorState message={errorMessage(payout.error)} onRetry={() => void payout.refetch()} /> : null}
      {data ? (
        <Card>
          <Body>{offline ? t('payout.offline') : data.onboarded ? t('payout.ready') : data.linked ? t('payout.pending') : t('payout.notLinked')}</Body>
        </Card>
      ) : null}
      {!offline && (simulated || data?.provider === 'mock') ? <Notice>{t('payout.simulated')}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}

      <SectionTitle>{t('payout.debitTitle')}</SectionTitle>
      <Card>
        <Body>{card ? t('payout.debitCard', { brand: card.brand.toUpperCase(), last4: card.last4 }) : t('payout.debitNone')}</Body>
        <Body muted>{t('payout.debitHint')}</Body>
        <Button label={card ? t('payout.debitReplace') : t('payout.debitAdd')} variant="ghost" onPress={() => void addDebitCard()} disabled={busy} testID="payout-debit-card" />
      </Card>
    </Screen>
  );
}
