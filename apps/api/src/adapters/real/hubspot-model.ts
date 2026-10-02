/**
 * Modèle de données HubSpot de Neomoov (étude 06, étape 5 du plan de mise en place) : groupe de propriétés, propriétés
 * personnalisées des contacts, des entreprises et des transactions, et les deux pipelines de transactions (« Ventes
 * B2B » et « Formation chauffeurs »). Source unique : le script `pnpm --filter @neomoov/api crm:setup` crée ou met à
 * jour ce modèle chez HubSpot, et l'adaptateur réel s'y réfère. Règle de minimisation (amendement v1.2, section 9) :
 * aucun trajet, aucune adresse personnelle, aucun paiement ; `assertCrmPropertiesMinimal` refuse toute propriété
 * dont le nom y ressemble, avant tout envoi.
 */
import { AppError } from '../../common/app-error.js';
import type { CrmCompanyInput, CrmContactInput, CrmDealInput, CrmPipeline } from '../types.js';

export type HubSpotObjectType = 'contacts' | 'companies' | 'deals';

export interface HubSpotPropertyOption {
  label: string;
  value: string;
}

export interface HubSpotPropertyDefinition {
  name: string;
  label: string;
  description: string;
  type: 'string' | 'enumeration' | 'datetime';
  fieldType: 'text' | 'select' | 'date';
  options?: HubSpotPropertyOption[];
  /** Valeur unique dans le compte : sert de clé d'idempotence (`idProperty` de l'API batch upsert). */
  hasUniqueValue?: boolean;
}

export const HUBSPOT_PROPERTY_GROUP = { name: 'neomoov', label: 'Neomoov' } as const;

const ENTITY_OPTIONS: HubSpotPropertyOption[] = [
  { label: 'Neomoov', value: 'neomoov' },
  { label: 'Groupe NSK', value: 'groupe_nsk' },
];
const CONSENT_SOURCE_OPTIONS: HubSpotPropertyOption[] = [
  { label: 'Formulaire (consentement daté)', value: 'form' },
  { label: 'Contrat (compte d\'affaires, organisation)', value: 'contract' },
  // Phase 1 « entreprise autonome » : prospection B2B sur adresse professionnelle publiée (Loi anti-pourriel, consentement tacite).
  { label: 'Prospection B2B (adresse professionnelle publiée)', value: 'b2b' },
];

/** Propriétés communes aux trois objets : identifiant Neomoov (unique), entité, source, consentement daté et son origine. */
const common = (subject: string): HubSpotPropertyDefinition[] => [
  { name: 'neomoov_platform_id', label: 'Identifiant Neomoov', description: `Identifiant ${subject} dans la plateforme Neomoov (clé d'idempotence, ne pas modifier).`, type: 'string', fieldType: 'text', hasUniqueValue: true },
  { name: 'neomoov_entity', label: 'Entité NSK', description: 'Société du Groupe NSK concernée par la fiche.', type: 'enumeration', fieldType: 'select', options: ENTITY_OPTIONS },
  { name: 'neomoov_source', label: 'Source Neomoov', description: 'Origine de la fiche : site web, clé d\'API d\'un formulaire, My Hub, plateforme.', type: 'string', fieldType: 'text' },
  { name: 'neomoov_consent_at', label: 'Consentement (date)', description: 'Date du consentement à être recontacté (Loi 25) ou du contrat qui fonde la relation.', type: 'datetime', fieldType: 'date' },
  { name: 'neomoov_consent_source', label: 'Consentement (origine)', description: 'Formulaire avec consentement explicite, ou contrat d\'affaires.', type: 'enumeration', fieldType: 'select', options: CONSENT_SOURCE_OPTIONS },
];

export const HUBSPOT_PROPERTIES: Record<HubSpotObjectType, HubSpotPropertyDefinition[]> = {
  contacts: [
    ...common('de la personne ou du prospect'),
    { name: 'neomoov_language', label: 'Langue Neomoov', description: 'Langue de correspondance choisie par la personne.', type: 'enumeration', fieldType: 'select', options: [{ label: 'Français', value: 'fr' }, { label: 'Anglais', value: 'en' }] },
    {
      name: 'neomoov_lead_kind', label: 'Type de prospect', description: 'Formulaire d\'origine du prospect.', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Candidat chauffeur', value: 'driver' }, { label: 'Entreprise', value: 'business' }, { label: 'Partenaire', value: 'partner' }, { label: 'Préinscription Formation chauffeurs', value: 'training' }],
    },
    {
      name: 'neomoov_driver_status', label: 'Statut de candidature chauffeur', description: 'Avancement de la candidature d\'un chauffeur.', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Candidat', value: 'candidate' }, { label: 'Documents en vérification', value: 'documents_pending' }, { label: 'Validé', value: 'validated' }, { label: 'Actif', value: 'active' }, { label: 'Inactif', value: 'inactive' }],
    },
    {
      name: 'neomoov_training_status', label: 'Statut Formation chauffeurs', description: 'Avancement dans la Formation chauffeurs Neomoov.', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Préinscrit', value: 'preregistered' }, { label: 'Formation payée', value: 'paid' }, { label: 'En cours', value: 'in_progress' }, { label: 'Certifié', value: 'certified' }],
    },
    {
      name: 'neomoov_affiliation_program', label: 'Programme d\'affiliation', description: 'Programme professionnel qui intéresse la personne ou son organisation.', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Entreprise (compte d\'affaires)', value: 'business' }, { label: 'Flotte', value: 'fleet' }, { label: 'Taxi', value: 'taxi' }, { label: 'Marque blanche', value: 'white_label' }, { label: 'Partenaire', value: 'partner' }],
    },
  ],
  companies: [
    ...common('de l\'organisation ou du compte d\'affaires'),
    { name: 'neomoov_legal_name', label: 'Raison sociale', description: 'Dénomination légale de l\'organisation.', type: 'string', fieldType: 'text' },
    {
      name: 'neomoov_account_type', label: 'Type de compte Neomoov', description: 'Compte d\'affaires (clients entreprises) ou organisation de la plateforme (marque blanche, flotte, compagnie).', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Compte d\'affaires', value: 'business_account' }, { label: 'Organisation (marque blanche, flotte, compagnie)', value: 'organization' }, { label: 'Prospect d\'affaires (prospection B2B)', value: 'prospect' }],
    },
    {
      name: 'neomoov_organization_type', label: 'Type d\'organisation', description: 'Nature de l\'organisation dans la plateforme.', type: 'enumeration', fieldType: 'select',
      options: [
        { label: 'Compagnie de taxi', value: 'taxi_company' }, { label: 'Compagnie de VTC', value: 'vtc_company' }, { label: 'Flotte', value: 'fleet' }, { label: 'Entreprise', value: 'business' },
        { label: 'Établissement', value: 'establishment' }, { label: 'Chauffeur indépendant (Solo)', value: 'solo' }, { label: 'Sous-organisation', value: 'sub_org' }, { label: 'Marque blanche', value: 'white_label' },
      ],
    },
    {
      name: 'neomoov_plan', label: 'Formule Neomoov', description: 'Formule souscrite par l\'organisation.', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Aucune', value: 'none' }, { label: 'Solo', value: 'solo' }, { label: 'Pro', value: 'pro' }, { label: 'Entreprise', value: 'entreprise' }],
    },
  ],
  deals: [
    ...common('de la transaction'),
    {
      name: 'neomoov_track', label: 'Parcours Neomoov', description: 'Parcours de la transaction : ventes B2B ou Formation chauffeurs (utile quand la formule HubSpot ne permet qu\'un seul pipeline).', type: 'enumeration', fieldType: 'select',
      options: [{ label: 'Ventes B2B', value: 'b2b' }, { label: 'Formation chauffeurs', value: 'training' }],
    },
  ],
};

export interface HubSpotStageDefinition {
  code: string;
  label: string;
  /** 1 : gagnée ; 0 : perdue ; entre les deux : probabilité de conclure. */
  probability: number;
}

export interface HubSpotPipelineDefinition {
  code: CrmPipeline;
  label: string;
  stages: HubSpotStageDefinition[];
}

export const HUBSPOT_PIPELINES: HubSpotPipelineDefinition[] = [
  {
    code: 'b2b', label: 'Ventes B2B',
    stages: [
      { code: 'new', label: 'Nouveau prospect', probability: 0.1 },
      { code: 'contacted', label: 'Contact établi', probability: 0.2 },
      { code: 'proposal', label: 'Proposition envoyée', probability: 0.4 },
      { code: 'trial', label: 'Essai en cours', probability: 0.6 },
      { code: 'active', label: 'Client actif', probability: 1 },
      { code: 'lost', label: 'Perdu', probability: 0 },
    ],
  },
  {
    code: 'training', label: 'Formation chauffeurs',
    stages: [
      { code: 'candidate', label: 'Candidature reçue', probability: 0.1 },
      { code: 'preregistered', label: 'Préinscrit à la formation', probability: 0.3 },
      { code: 'paid', label: 'Formation payée', probability: 0.6 },
      { code: 'in_progress', label: 'Formation en cours', probability: 0.8 },
      { code: 'certified', label: 'Certifié', probability: 1 },
      { code: 'dropped', label: 'Abandon', probability: 0 },
    ],
  },
];

/** Formule gratuite de HubSpot (un seul pipeline) : les deux parcours vivent dans ce pipeline unique. */
export const HUBSPOT_SINGLE_PIPELINE_LABEL = 'Neomoov';

export function pipelineDefinition(code: CrmPipeline): HubSpotPipelineDefinition {
  const found = HUBSPOT_PIPELINES.find((p) => p.code === code);
  if (!found) throw new AppError('CRM_UNKNOWN_PIPELINE', `Pipeline inconnu : ${code}`, 500);
  return found;
}

export function stageDefinition(pipeline: CrmPipeline, stage: string): HubSpotStageDefinition {
  const found = pipelineDefinition(pipeline).stages.find((s) => s.code === stage);
  if (!found) throw new AppError('CRM_UNKNOWN_STAGE', `Étape inconnue : ${pipeline}/${stage}`, 500);
  return found;
}

/** Noms de propriétés interdits dans le CRM : trajets, adresses personnelles, paiements, positions. */
const FORBIDDEN = /(^|_)(address|street|postal|postcode|zip|ride|rides|trip|pickup|dropoff|route|itinerary|card|iban|bank|payment|payments|cvv|lat|lng|latitude|longitude|geo|location)(_|$)/i;

export function assertCrmPropertiesMinimal(properties: Record<string, unknown>): void {
  const forbidden = Object.keys(properties).filter((key) => FORBIDDEN.test(key));
  if (forbidden.length) throw new AppError('CRM_FORBIDDEN_DATA', `Données interdites dans le CRM : ${forbidden.join(', ')}`, 500, { forbidden });
}

type Properties = Record<string, string>;

/** Propriétés HubSpot d'un contact : seulement les champs permis (identité, coordonnées, statuts, consentement). */
export function contactProperties(input: CrmContactInput): Properties {
  const p: Properties = {
    neomoov_platform_id: input.platformId,
    neomoov_entity: input.entity,
    neomoov_source: input.source.slice(0, 100),
    neomoov_consent_source: input.consent.source,
  };
  if (input.consent.at) p['neomoov_consent_at'] = input.consent.at.toISOString();
  if (input.email) p['email'] = input.email;
  if (input.phone) p['phone'] = input.phone;
  if (input.firstName) p['firstname'] = input.firstName;
  if (input.lastName) p['lastname'] = input.lastName;
  if (input.city) p['city'] = input.city;
  if (input.language) p['neomoov_language'] = input.language;
  if (input.leadKind) p['neomoov_lead_kind'] = input.leadKind;
  if (input.driverStatus) p['neomoov_driver_status'] = input.driverStatus;
  if (input.trainingStatus) p['neomoov_training_status'] = input.trainingStatus;
  if (input.affiliationProgram) p['neomoov_affiliation_program'] = input.affiliationProgram;
  assertCrmPropertiesMinimal(p);
  return p;
}

export function companyProperties(input: CrmCompanyInput): Properties {
  const p: Properties = {
    neomoov_platform_id: input.platformId,
    neomoov_entity: input.entity,
    neomoov_source: input.source.slice(0, 100),
    neomoov_consent_source: input.consent.source,
    neomoov_account_type: input.accountType,
    name: input.name,
  };
  if (input.consent.at) p['neomoov_consent_at'] = input.consent.at.toISOString();
  if (input.legalName) p['neomoov_legal_name'] = input.legalName;
  if (input.organizationType) p['neomoov_organization_type'] = input.organizationType;
  p['neomoov_plan'] = input.planCode ?? 'none';
  assertCrmPropertiesMinimal(p);
  return p;
}

export function dealProperties(input: CrmDealInput, pipelineId: string, stageId: string): Properties {
  const p: Properties = {
    neomoov_platform_id: input.platformId,
    neomoov_entity: input.entity,
    neomoov_source: input.source.slice(0, 100),
    neomoov_consent_source: input.consent.source,
    neomoov_track: input.pipeline,
    dealname: input.name.slice(0, 200),
    pipeline: pipelineId,
    dealstage: stageId,
  };
  if (input.consent.at) p['neomoov_consent_at'] = input.consent.at.toISOString();
  // Montant d'une transaction (prix d'une formule), jamais un paiement : HubSpot attend des dollars.
  if (typeof input.amountCents === 'number') p['amount'] = (input.amountCents / 100).toFixed(2);
  assertCrmPropertiesMinimal(p);
  return p;
}
