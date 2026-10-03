/**
 * État CRM d'une fiche (étape 25), lu dans My Hub : objets créés chez le fournisseur (HubSpot, simulé en test), état de
 * la synchronisation, tentatives et dernière erreur. Rien de personnel : les identifiants externes et l'état seulement.
 */
import { z } from 'zod';
import { isoDate } from './common.js';

export const CRM_OBJECT_TYPES = ['contact', 'company', 'deal', 'note'] as const;
export const CRM_RECORD_STATUSES = ['pending', 'synced', 'error', 'skipped'] as const;
export type CrmRecordStatusValue = (typeof CRM_RECORD_STATUSES)[number];

export const crmRecordSchema = z.object({
  objectType: z.enum(CRM_OBJECT_TYPES),
  externalId: z.string().nullable(),
  status: z.enum(CRM_RECORD_STATUSES),
  attempts: z.number().int().min(0),
  /** Dernière erreur du fournisseur, ou motif d'un saut (`no_consent`, `discarded`, `platform`, `closed`, `unsubscribed`). */
  error: z.string().nullable(),
  lastSyncedAt: isoDate.nullable(),
});

/** Fiches d'une entité chez le fournisseur courant ; liste vide : rien n'est encore parti. */
export const crmRecordsSchema = z.object({
  provider: z.string(),
  records: z.array(crmRecordSchema),
});
export type CrmRecordsView = z.infer<typeof crmRecordsSchema>;
