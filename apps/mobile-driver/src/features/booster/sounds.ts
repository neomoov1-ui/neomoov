import type { AlertSound } from '@neomoov/domain';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

/** Fichiers sonores embarqués par type de son Booster (les mêmes noms que l'API envoie dans le push). */
const SOURCES: Record<Exclude<AlertSound, 'default' | 'none'>, number> = {
  check: require('../../../assets/sounds/booster-check.wav'),
  session: require('../../../assets/sounds/booster-session.wav'),
  peak: require('../../../assets/sounds/booster-peak.wav'),
};

let player: AudioPlayer | null = null;

/** Aperçu local d'un son (écran des alertes) : `none` vibre seulement ; `default` joue le son « vérification ». */
export async function previewAlertSound(sound: AlertSound): Promise<void> {
  stopPreview();
  if (Platform.OS !== 'web') Vibration.vibrate(sound === 'none' ? [0, 300] : [0, 150]);
  if (sound === 'none') return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
    player = createAudioPlayer(SOURCES[sound === 'default' ? 'check' : sound]);
    player.play();
  } catch {
    // Son indisponible (navigateur sans interaction) : la vibration suffit.
  }
}

export function stopPreview(): void {
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // Déjà libéré.
  }
  player = null;
}
