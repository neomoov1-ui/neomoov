/** Mise en forme de durées pour les messages de l'API : les seuils viennent des réglages, les messages les suivent. */

/** « 2 heures », « 90 minutes », « 45 secondes ». */
export function describeDuration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} heure${hours > 1 ? 's' : ''}`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${seconds} seconde${seconds > 1 ? 's' : ''}`;
}
