import { Body, Button, Card } from '@neomoov/mobile-core/components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Empty, ErrorState, Loading, Notice, Row, Screen } from '@/components/ui';
import { cardExpiry, cardFlowOf, cardLabel } from '@/features/payments/logic';
import { api, errorMessage } from '@/lib/api';
import { openCardForm } from '@/lib/card-form';
import { keys, queryClient, usePaymentMethods } from '@/lib/queries';

/**
 * Moyens de paiement (6.1, étape 26) : cartes enregistrées (marque et 4 derniers chiffres seulement), carte par défaut,
 * retrait, ajout. Avec Square, l'ajout ouvre la page de saisie du web dans le navigateur intégré (aucune donnée de carte
 * dans l'application) et la liste est relue au retour ; avec le fournisseur simulé, une carte de test est enregistrée.
 */
export default function PaymentMethodsScreen() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const methods = usePaymentMethods();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      await queryClient.invalidateQueries({ queryKey: keys.paymentMethods });
    }
  }

  const add = () =>
    run(async () => {
      const flow = cardFlowOf(await api.payments.setupIntent(), language);
      if (flow.kind === 'web') {
        const before = methods.data?.length ?? 0;
        await openCardForm(flow.url);
        const after = await queryClient.fetchQuery({ queryKey: keys.paymentMethods, queryFn: () => api.payments.methods(), staleTime: 0 });
        if (after.length > before) setNotice(t('payments.added'));
      } else if (flow.kind === 'simulated') {
        await api.payments.confirm(flow.setupIntentId);
        setNotice(t('payments.simulatedAdded'));
      } else {
        setError(t('payments.unavailable'));
      }
    });

  const remove = (id: string) => run(async () => {
    await api.payments.remove(id);
    setNotice(t('payments.removed'));
  });

  return (
    <Screen back title={t('payments.title')} onRefresh={() => void methods.refetch()} refreshing={methods.isRefetching} footer={<Button label={busy ? t('payments.opening') : t('payments.add')} onPress={() => void add()} disabled={busy} testID="payment-add-card" />}>
      <Body muted>{t('payments.intro')}</Body>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <ErrorState message={error} /> : null}
      {methods.isLoading ? <Loading /> : null}
      {methods.error ? <ErrorState message={errorMessage(methods.error)} onRetry={() => void methods.refetch()} /> : null}
      {methods.data && methods.data.length === 0 ? <Empty message={t('payments.empty')} /> : null}
      {(methods.data ?? []).map((card) => (
        <Card key={card.id}>
          <Row label={cardLabel(card)} value={card.isDefault ? t('payments.default') : (cardExpiry(card) ?? '')} strong={card.isDefault} />
          {card.isDefault && cardExpiry(card) ? <Body muted>{t('payments.expires', { date: cardExpiry(card) })}</Body> : null}
          <Button label={t('payments.remove')} variant="ghost" onPress={() => void remove(card.id)} disabled={busy} testID={`payment-remove-${card.last4}`} />
        </Card>
      ))}
      <Body muted>{t('payments.secure')}</Body>
    </Screen>
  );
}
