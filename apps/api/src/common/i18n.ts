/**
 * Textes envoyés par l'API elle-même (textos, courriels), en français canadien et en anglais. Les écrans ont leur
 * propre i18n ; l'API ne code jamais un texte destiné à une personne en dur dans un service.
 */
import type { Language } from '@neomoov/domain';

const MESSAGES = {
  fr: {
    'sms.otp': (p: { code: string; minutes: number }) => `Votre code Neomoov : ${p.code}. Valable ${p.minutes} minutes. Ne le partagez avec personne.`,
    'sms.export_ready': () => 'Neomoov : votre export de données est prêt. Ouvrez l\'application, section Confidentialité, pour le télécharger.',
    'email.export.subject': () => 'Votre export de données Neomoov',
    'email.export.body': (p: { firstName: string | null; json: string; pdf: string; expiresAt: string }) =>
      `Bonjour${p.firstName ? ` ${p.firstName}` : ''},\n\nComme demandé, voici vos données personnelles détenues par Neomoov, en deux formats :\n\n- Lisible par une machine (JSON) : ${p.json}\n- Document (PDF) : ${p.pdf}\n\nCes liens expirent le ${p.expiresAt}. Si vous n'êtes pas à l'origine de cette demande, répondez à ce courriel.\n\nNeomoov, Groupe NSK Inc.`,
    'email.deletion.subject': () => 'Votre compte Neomoov a été supprimé',
    'email.deletion.body': () => 'Votre compte Neomoov et vos données personnelles ont été supprimés. Les courses passées sont conservées sous forme anonymisée pour nos obligations comptables (7 ans).\n\nNeomoov, Groupe NSK Inc.',
  },
  en: {
    'sms.otp': (p: { code: string; minutes: number }) => `Your Neomoov code: ${p.code}. Valid for ${p.minutes} minutes. Never share it.`,
    'sms.export_ready': () => 'Neomoov: your data export is ready. Open the app, Privacy section, to download it.',
    'email.export.subject': () => 'Your Neomoov data export',
    'email.export.body': (p: { firstName: string | null; json: string; pdf: string; expiresAt: string }) =>
      `Hello${p.firstName ? ` ${p.firstName}` : ''},\n\nAs requested, here is the personal data Neomoov holds about you, in two formats:\n\n- Machine-readable (JSON): ${p.json}\n- Document (PDF): ${p.pdf}\n\nThese links expire on ${p.expiresAt}. If you did not make this request, reply to this email.\n\nNeomoov, Groupe NSK Inc.`,
    'email.deletion.subject': () => 'Your Neomoov account has been deleted',
    'email.deletion.body': () => 'Your Neomoov account and personal data have been deleted. Past rides are kept in anonymised form for our accounting obligations (7 years).\n\nNeomoov, Groupe NSK Inc.',
  },
} as const;

type Messages = typeof MESSAGES.fr;
export type MessageKey = keyof Messages;

export function t<K extends MessageKey>(language: Language, key: K, ...args: Parameters<Messages[K]>): string {
  const fn = (MESSAGES[language] ?? MESSAGES.fr)[key] as (...a: unknown[]) => string;
  return fn(...args);
}

/** Échappement HTML d'un texte brut (prénom, adresse) inséré dans un courriel. */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

/** Textes du document PDF d'export des données (5.15). */
export const PDF_TEXTS: Record<Language, { title: string; generated: string; footer: string; empty: string; sections: Record<string, string> }> = {
  fr: {
    title: 'Vos données personnelles Neomoov',
    generated: 'Généré le',
    footer: 'Neomoov, Groupe NSK Inc. · Document confidentiel',
    empty: 'Aucune donnée.',
    sections: {
      profile: 'Profil', roles: 'Rôles', devices: 'Appareils', sessions: 'Sessions (200 dernières)', consents: 'Consentements', dataRequests: 'Demandes de droits',
      client: 'Profil client', savedPlaces: 'Adresses enregistrées', ridesAsClient: 'Courses (comme client)', driver: 'Profil chauffeur', vehicles: 'Véhicules',
      documents: 'Documents (métadonnées)', ridesAsDriver: 'Courses (comme chauffeur)', auditTrail: 'Journal des actions (500 dernières)',
    },
  },
  en: {
    title: 'Your Neomoov personal data',
    generated: 'Generated on',
    footer: 'Neomoov, Groupe NSK Inc. · Confidential document',
    empty: 'No data.',
    sections: {
      profile: 'Profile', roles: 'Roles', devices: 'Devices', sessions: 'Sessions (last 200)', consents: 'Consents', dataRequests: 'Data requests',
      client: 'Client profile', savedPlaces: 'Saved places', ridesAsClient: 'Rides (as client)', driver: 'Driver profile', vehicles: 'Vehicles',
      documents: 'Documents (metadata)', ridesAsDriver: 'Rides (as driver)', auditTrail: 'Action log (last 500)',
    },
  },
};
