import { Redirect, useLocalSearchParams } from 'expo-router';

/** Lien profond `https://neomoov.net/c/<code>` (étape 22) : ouvre l'écran « Rejoindre une organisation » avec le code. */
export default function JoinLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/join', params: { code: typeof code === 'string' ? code : '' } }} />;
}
