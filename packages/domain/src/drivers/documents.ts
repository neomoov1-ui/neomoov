/**
 * Documents du chauffeur et du véhicule (section 5.12) : état affiché, échéance, rappels. Les types exigés et les
 * délais de rappel viennent des réglages (`drivers.onboarding_documents`, `drivers.document_reminder_days`).
 */
import type { DocumentStatus, DocumentType } from '../enums.js';

export const DOCUMENT_DISPLAY_STATES = ['missing', 'pending', 'approved', 'expiring', 'expired', 'rejected'] as const;
export type DocumentDisplayState = (typeof DOCUMENT_DISPLAY_STATES)[number];

export interface DocumentRecord {
  type: DocumentType;
  status: DocumentStatus;
  /** Date d'échéance (AAAA-MM-JJ) ; null si le document n'expire pas. */
  expiresOn: string | null;
  createdAt: Date;
}

/** Jours entre deux dates civiles AAAA-MM-JJ (négatif si l'échéance est passée). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** État d'un document à une date donnée ; `expiringDays` : fenêtre du premier rappel (30 jours). */
export function documentState(doc: Pick<DocumentRecord, 'status' | 'expiresOn'> | null, today: string, expiringDays: number): DocumentDisplayState {
  if (!doc) return 'missing';
  if (doc.status === 'rejected') return 'rejected';
  if (doc.status === 'expired') return 'expired';
  if (doc.expiresOn && daysBetween(today, doc.expiresOn) < 0) return 'expired';
  if (doc.status === 'pending') return 'pending';
  if (doc.expiresOn && daysBetween(today, doc.expiresOn) <= expiringDays) return 'expiring';
  return 'approved';
}

/**
 * Document de référence d'un type : le plus récent, sauf si un document approuvé et valide existe alors qu'un nouveau
 * est en cours de vérification (le chauffeur reste en règle pendant l'examen du remplaçant).
 */
export function currentDocument<T extends DocumentRecord>(docs: readonly T[], type: DocumentType, today: string): { current: T | null; replacement: T | null } {
  const ofType = docs.filter((d) => d.type === type).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = ofType[0] ?? null;
  if (!latest) return { current: null, replacement: null };
  if (latest.status === 'pending') {
    const valid = ofType.find((d) => d.status === 'approved' && (!d.expiresOn || daysBetween(today, d.expiresOn) >= 0));
    if (valid) return { current: valid, replacement: latest };
  }
  return { current: latest, replacement: null };
}

/** Rappel dû aujourd'hui (J-30, J-7, J-1 par défaut) : le nombre de jours restants, sinon null. */
export function reminderDue(expiresOn: string | null, today: string, reminderDays: readonly number[]): number | null {
  if (!expiresOn) return null;
  const days = daysBetween(today, expiresOn);
  return reminderDays.includes(days) ? days : null;
}
