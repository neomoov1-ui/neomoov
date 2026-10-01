import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loading, Screen } from '@/components/ui';
import { keys, queryClient } from '@/lib/queries';

/**
 * Retour de la page de saisie de carte par lien profond (`neomoov://carte-enregistree`, étape 26) quand elle a été ouverte
 * dans le navigateur du système : la liste des cartes est relue, puis l'écran des moyens de paiement s'affiche.
 */
export default function CardSavedScreen() {
  const { t } = useTranslation();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: keys.paymentMethods });
    router.replace('/payment-methods');
  }, []);
  return (
    <Screen title={t('payments.title')}>
      <Loading />
    </Screen>
  );
}
