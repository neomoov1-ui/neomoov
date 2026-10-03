import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Lien du texto d'invitation de flotte (étape 23), même chemin que la page web `/chauffeurs/rejoindre?token=…` :
 * `neomoov-driver://chauffeurs/rejoindre?token=…` (et le lien universel quand My Hub le déclarera) ouvre l'écran
 * d'acceptation avec le jeton.
 */
export default function FleetInvitationLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <Redirect href={{ pathname: '/fleet-invitation', params: { token: typeof token === 'string' ? token : '' } }} />;
}
