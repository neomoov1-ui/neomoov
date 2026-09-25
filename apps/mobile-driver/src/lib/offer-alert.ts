import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

/**
 * Sonnerie et vibration d'une offre (prompt 11 : « sonnerie et vibration ») : jouées en boucle tant que l'offre est à
 * l'écran, même en mode silencieux, arrêtées à la réponse ou à l'expiration.
 */
let player: AudioPlayer | null = null;

export async function startOfferAlert(): Promise<void> {
  stopOfferAlert();
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

export function stopOfferAlert(): void {
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
