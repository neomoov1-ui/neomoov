/**
 * Ouverture de la page de saisie de carte du web (étape 26) : navigateur intégré (`expo-web-browser`, session
 * d'authentification fermée au retour par lien profond). Le module est chargé à la demande : sur un binaire qui ne
 * l'embarque pas encore (mise à jour à la volée sur une ancienne version), le navigateur du système prend le relais et
 * le lien profond `neomoov://carte-enregistree` ramène à l'application (route `carte-enregistree`).
 */
import * as Linking from 'expo-linking';
import { CARD_RETURN_URL } from '@/features/payments/logic';

export async function openCardForm(url: string): Promise<'returned' | 'external'> {
  try {
    const WebBrowser = await import('expo-web-browser');
    await WebBrowser.openAuthSessionAsync(url, CARD_RETURN_URL);
    return 'returned';
  } catch {
    await Linking.openURL(url);
    return 'external';
  }
}
