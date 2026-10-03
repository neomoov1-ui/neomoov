import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

/**
 * Sonnerie et vibration d'une offre (prompt 11 : « sonnerie et vibration ») : jouées en boucle tant que l'offre est à
 * l'écran, même en mode silencieux, arrêtées à la réponse ou à l'expiration.
 */
let player: AudioPlayer | null = null;
/** Écran d'offre qui a lancé la sonnerie : l'écran remplacé par l'offre suivante ne coupe pas celle du nouvel écran (constat mobile 23). */
let owner: string | null = null;

export async function startOfferAlert(by: string | null = null): Promise<void> {
  stopOfferAlert();
  owner = by;
  if (Platform.OS !== 'web') Vibration.vibrate([0, 700, 500, 700, 500, 700], true);
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
    player = createAudioPlayer(require('../../assets/sounds/offer.wav'));
    player.loop = true;
    player.play();
  } catch {
    // Son indisponible (navigateur sans interaction, audio occupé) : la vibration et l'écran suffisent.
  }
}

/** Arrêt de la sonnerie ; `by` : seulement si elle a été lancée par cet écran d'offre. */
export function stopOfferAlert(by?: string): void {
  if (by !== undefined && owner !== by) return;
  owner = null;
  if (Platform.OS !== 'web') Vibration.cancel();
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      // Déjà libéré.
    }
    player = null;
  }
}
