/**
 * Catalogue de l'isolation par organisation (étape 20). Toute table du schéma `public` appartenant au rôle de l'API doit
 * avoir la sécurité au niveau des lignes activée et des droits pour `neomoov_scoped`, et porter une politique pour ce rôle
 * OU figurer ici, avec la raison pour laquelle elle reste réservée à la plateforme (aucune ligne visible d'une transaction
 * restreinte). Le test `test/isolation-coverage.e2e.test.ts` lit le catalogue PostgreSQL et refuse toute table nouvelle
 * qui n'est ni protégée par une politique, ni listée : c'est voulu. Marche à suivre : `docs/isolation.md`.
 */

/** Tables réservées à la plateforme : nom, raison. Une table qui reçoit une politique doit sortir de cette liste. */
export const PLATFORM_ONLY_TABLES: Readonly<Record<string, string>> = {
  agent_prompts: 'Prompts versionnés des agents IA de la plateforme (docs/agents), sans donnée d\'organisation.',
  agent_runs: 'Exécutions des agents IA (coûts, jetons, outils) : exploitation de la plateforme ; les objets créés par un agent (incidents, conversations, avis) portent, eux, l\'organisation.',
  agents: 'Catalogue des agents IA et de leur mode (approbation, automatique).',
  api_keys: 'Comptes de service de la plateforme (agents, intégrations) ; les clés par organisation viendront avec la permission api_keys.manage.',
  approvals: 'File d\'approbation des actions proposées par les agents, décidée par le personnel de la plateforme.',
  business_accounts: 'Comptes entreprises de la V1 (écrans V2), antérieurs aux organisations ; à rattacher aux organisations quand le module Entreprises sera repris.',
  business_members: 'Membres des comptes entreprises de la V1 (voir business_accounts).',
  competitor_benchmarks: 'Relevés concurrentiels saisis par le fondateur et les opérateurs (D33) : tarification de la plateforme.',
  counters: 'Compteurs de numérotation (courses, factures, chauffeurs), hors schéma Drizzle ; atteints par les fonctions next_* en SECURITY DEFINER.',
  crm_records: 'Correspondance avec le CRM de la plateforme (HubSpot, étape 25) : identifiants externes, état, erreurs de synchronisation.',
  data_requests: 'Demandes d\'accès, de rectification et de suppression (Loi 25), traitées par le responsable de la plateforme ; par organisation avec la permission privacy.requests.handle, plus tard.',
  geolocation_exports: 'Exports réglementaires de géolocalisation de la plateforme (registre de l\'exploitant).',
  investors: 'Investisseurs du programme de financement de véhicules (V2), relation de la plateforme.',
  otp_codes: 'Codes de connexion par texto : authentification, jamais lue dans un contexte d\'organisation.',
  partners: 'Partenaires et établissements de la V1 (codes concierge), antérieurs aux organisations.',
  referrals: 'Programme de parrainage de la plateforme (codes, récompenses) ; les crédits qu\'il accorde portent, eux, l\'organisation.',
  retention_jobs: 'Journal des purges de conservation (Loi 25), exploitation de la plateforme.',
  sessions: 'Sessions et jetons de rafraîchissement : authentification.',
  staff_credentials: 'Mots de passe et second facteur du personnel de My Hub.',
  staff_notes: 'Notes internes du personnel de la plateforme sur les fiches ; des notes par organisation demanderont une politique par entité.',
  user_roles: 'Anciens rôles (client, chauffeur, personnel de la plateforme) ; les droits des organisations passent par memberships et roles.',
  webhook_events: 'Événements reçus des fournisseurs (Stripe) : file technique de la plateforme.',
  // Direction commerciale (phase 1 « entreprise autonome », 2 octobre 2026) : prospection B2B de la plateforme, jamais d'une organisation cliente.
  prospects: 'Prospects d\'affaires de la plateforme (prospection B2B, phase 1 « entreprise autonome ») : organisations démarchées par Neomoov, jamais par une organisation cliente.',
  prospect_touches: 'Fil des contacts des prospects de la plateforme (courriels, WhatsApp, appels, rendez-vous, notes).',
  followups: 'Relances planifiées par la plateforme (prospects, devis entreprise, candidatures de chauffeurs).',
  outbound_calls: 'Appels sortants commerciaux de la plateforme (assistant Vapi commercial, résultats, coûts).',
};

/** Vrai si la table est, par choix, réservée à la plateforme. */
export function isPlatformOnlyTable(table: string): boolean {
  return Object.hasOwn(PLATFORM_ONLY_TABLES, table);
}

/**
 * Tables de référence lisibles par toutes les organisations (politique `org_read` de 0021) : catalogue de la plateforme,
 * jamais de donnée d'une organisation cliente. Documentaire : le test de couverture n'exige que la présence d'une politique.
 */
export const SHARED_READ_TABLES: readonly string[] = ['cities', 'zones', 'vehicle_categories', 'pricing_rules', 'surcharges', 'flat_rates', 'packs', 'promotions', 'permissions', 'plans', 'feature_flags'];
