import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { ErrorState, Loading, Notice, Screen } from '@neomoov/mobile-core/ui';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, usePayout } from '@/lib/queries';

/**
 * Compte Stripe Connect (6.2) : parcours d'inscription Express de Stripe ouvert dans l'application (navigateur intégré),
 * puis état relu à l'API. Avec le fournisseur simulé, aucune page n'est ouverte : l'inscription est déjà faite.
 */
export default function PayoutScreen() {
  const { t } = useTranslation();
  const payout = usePayout();
  const [busy, setBusy] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = payout.data;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const link = await api.driver.payoutLink();
      setSimulated(link.simulated);
      if (!link.simulated) await WebBrowser.openAuthSessionAsync(link.url, 'neomoov-driver://payout');
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.payout }), queryClient.invalidateQueries({ queryKey: keys.onboarding }), queryClient.invalidateQueries({ queryKey: keys.home })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('payout.title')} footer={data && !data.onboarded ? <Button label={data.linked ? t('payout.resume') : t('payout.start')} onPress={() => void start()} disabled={busy} testID="payout-start" /> : undefined}>
      <Body muted>{t('payout.intro')}</Body>
      {payout.isLoading ? <Loading /> : null}
      {payout.error ? <ErrorState message={errorMessage(payout.error)} onRetry={() => void payout.refetch()} /> : null}
      {data ? (
        <Card>
          <Body>{data.onboarded ? t('payout.ready') : data.linked ? t('payout.pending') : t('payout.notLinked')}</Body>
        </Card>
      ) : null}
      {simulated || data?.provider === 'mock' ? <Notice>{t('payout.simulated')}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
    </Screen>
  );
}
