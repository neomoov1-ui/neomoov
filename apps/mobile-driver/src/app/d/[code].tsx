import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Lien de rattachement réservé aux chauffeurs `https://neomoov.net/d/<code>` (revue du 2 octobre 2026, constat mobile 12) :
 * même écran « Rejoindre une organisation » que `c/<code>`, qui reste ouvert par l'application client quand les deux
 * sont installées. Le lien `neomoov-driver://c/<code>` continue d'ouvrir cette application.
 */
export default function DriverJoinLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/join', params: { code: typeof code === 'string' ? code : '' } }} />;
}
