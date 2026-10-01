/**
 * Permissions fines (amendement v1.2, étape 19) : catalogue des permissions atomiques, rôles système par niveau, et
 * correspondance transitoire des quatre anciens rôles du personnel. Droits d'un membre = permissions de ses rôles actifs
 * dans la portée (organisation seule ou sous-arbre), limitées aux modules de la formule de l'organisation. Pas
 * d'escalade : on n'accorde que ce qu'on détient. Fonctions pures ; la base et l'API appliquent.
 */

/** Types d'organisation : la plateforme (racine) et les organisations clientes et leurs sous-organisations. */
export const ORGANIZATION_TYPES = ['platform', 'taxi_company', 'vtc_company', 'fleet', 'business', 'establishment', 'solo', 'sub_org', 'white_label'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const PERMISSION_MODULES = [
  'operations', 'rides', 'dispatch', 'drivers', 'vehicles', 'clients', 'incidents', 'pricing', 'offers', 'payments', 'finance',
  'agents', 'privacy', 'platform', 'organization', 'reports', 'self',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export interface PermissionDefinition {
  module: PermissionModule;
  /** Sensible : double authentification exigée, journalisée, alerte au propriétaire de l'organisation. */
  sensitive: boolean;
  /** Réservée à la plateforme Neomoov (niveau N0) : jamais accordée à une organisation cliente. */
  platformOnly: boolean;
  description: string;
}

const p = (module: PermissionModule, description: string, options: { sensitive?: boolean; platformOnly?: boolean } = {}): PermissionDefinition => ({
  module, description, sensitive: options.sensitive ?? false, platformOnly: options.platformOnly ?? false,
});

export const PERMISSIONS = {
  'dashboard.read': p('operations', 'Tableau de bord de l\'exploitation'),
  'metrics.read': p('operations', 'Métriques techniques de la plateforme', { platformOnly: true }),
  'queues.read': p('operations', 'Files de tâches', { platformOnly: true }),
  'queues.retry': p('operations', 'Relancer des tâches en échec', { platformOnly: true }),
  'rides.read': p('rides', 'Courses, événements, messages et paiements d\'une course'),
  'rides.create': p('rides', 'Créer une course (téléphone, comptoir)'),
  'rides.assign': p('rides', 'Attribuer une course à un chauffeur'),
  'rides.reassign': p('rides', 'Retirer le chauffeur et relancer la répartition'),
  'rides.hold': p('rides', 'Mettre une course en attente'),
  'rides.cancel': p('rides', 'Annuler une course, avec ou sans frais'),
  'rides.interrupt': p('rides', 'Interrompre une course en cours'),
  'rides.messages.write': p('rides', 'Écrire au client et au chauffeur d\'une course'),
  'dispatch.run': p('dispatch', 'Déclencher une passe de répartition', { platformOnly: true }),
  'drivers.read': p('drivers', 'Chauffeurs et leur fiche'),
  'drivers.activate': p('drivers', 'Activer ou réactiver un chauffeur'),
  'drivers.suspend': p('drivers', 'Suspendre un chauffeur'),
  'drivers.programs.manage': p('drivers', 'Programmes professionnels d\'un chauffeur'),
  'drivers.sanctions.apply': p('drivers', 'Appliquer une sanction à un chauffeur', { sensitive: true }),
  'drivers.notes.write': p('drivers', 'Notes internes sur un chauffeur'),
  'documents.read': p('drivers', 'Liste des documents des chauffeurs'),
  'documents.content.read': p('drivers', 'Contenu des documents (permis, assurance, antécédents)', { sensitive: true }),
  'documents.review': p('drivers', 'Approuver ou refuser un document'),
  'fairness.appeals.decide': p('drivers', 'Trancher les réponses et appels des chauffeurs, exclure une note (Charte d\'équité)'),
  'quality.read': p('drivers', 'Qualité des chauffeurs'),
  'quality.run': p('drivers', 'Lancer la passe de l\'agent qualité'),
  'compliance.read': p('drivers', 'Échéances de conformité'),
  'compliance.run': p('drivers', 'Lancer la passe de conformité', { platformOnly: true }),
  'vehicles.read': p('vehicles', 'Véhicules'),
  'vehicles.review': p('vehicles', 'Approuver un véhicule'),
  'vehicles.inspections.record': p('vehicles', 'Enregistrer une inspection'),
  'clients.read': p('clients', 'Clients'),
  'clients.notes.write': p('clients', 'Notes internes sur un client'),
  'leads.read': p('clients', 'Prospects'),
  'leads.manage': p('clients', 'Suivre un prospect'),
  'incidents.read': p('incidents', 'Incidents'),
  'incidents.create': p('incidents', 'Ouvrir un incident'),
  'incidents.decide': p('incidents', 'Trancher un incident, garantie modèle'),
  'pricing.read': p('pricing', 'Tarifs, zones, forfaits, relevés concurrentiels, simulation'),
  'pricing.edit': p('pricing', 'Modifier la grille tarifaire', { sensitive: true }),
  'zones.edit': p('pricing', 'Modifier une zone'),
  'pricing.benchmarks.manage': p('pricing', 'Saisir les relevés concurrentiels'),
  'offers.read': p('offers', 'Packs et promotions'),
  'refunds.create': p('payments', 'Rembourser une course', { sensitive: true }),
  'payments.webhooks.retry': p('payments', 'Retraiter les webhooks de paiement', { platformOnly: true }),
  'invoices.read': p('finance', 'Factures et transmissions au SEV'),
  'invoices.sev.retry': p('finance', 'Relancer une transmission au SEV'),
  'statements.read': p('finance', 'Relevés et soldes des chauffeurs'),
  'statements.manage': p('finance', 'Générer, émettre, payer, ajuster un relevé', { sensitive: true }),
  'ledgers.read': p('finance', 'Registres, sommaires, exports de géolocalisation'),
  'ledgers.manage': p('finance', 'Produire les sommaires et remettre la redevance', { sensitive: true }),
  'reports.read': p('reports', 'Rapports d\'activité et exports'),
  'agents.read': p('agents', 'Agents IA, exécutions, rapports, file d\'approbation, conversations'),
  'agents.settings.edit': p('agents', 'Régler un agent IA', { sensitive: true, platformOnly: true }),
  'agents.run': p('agents', 'Lancer un agent IA'),
  'agents.runs.read': p('agents', 'Exécutions des agents (service interne)'),
  'agents.tools': p('agents', 'Outils des agents IA (service interne)', { platformOnly: true }),
  'approvals.decide': p('agents', 'Approuver ou refuser une proposition d\'un agent'),
  'conversations.reply': p('agents', 'Répondre dans une conversation de l\'assistance'),
  'audit.read': p('privacy', 'Journal d\'audit'),
  'audit.export': p('privacy', 'Exporter le journal d\'audit', { sensitive: true }),
  'privacy.requests.read': p('privacy', 'Demandes d\'accès, de rectification et de suppression'),
  'privacy.incidents.manage': p('privacy', 'Registre des incidents de confidentialité'),
  'privacy.incidents.export': p('privacy', 'Exporter le registre des incidents de confidentialité', { sensitive: true }),
  'retention.read': p('privacy', 'Tâches de conservation'),
  'retention.run': p('privacy', 'Purges et confirmation des sauvegardes', { sensitive: true, platformOnly: true }),
  'settings.read': p('platform', 'Réglages'),
  'settings.edit': p('platform', 'Modifier un réglage', { sensitive: true, platformOnly: true }),
  'staff.manage': p('platform', 'Comptes du personnel de la plateforme', { sensitive: true, platformOnly: true }),
  'api_keys.manage': p('platform', 'Clés de service', { sensitive: true, platformOnly: true }),
  'organizations.read': p('organization', 'Organisation et sous-organisations'),
  'organizations.manage': p('organization', 'Créer et modifier des sous-organisations'),
  'members.read': p('organization', 'Membres de l\'organisation'),
  'members.invite': p('organization', 'Inviter un membre'),
  'members.manage': p('organization', 'Changer le rôle d\'un membre, le suspendre ou le retirer', { sensitive: true }),
  'roles.read': p('organization', 'Rôles et catalogue des permissions'),
  'roles.manage': p('organization', 'Créer et modifier des rôles personnalisés', { sensitive: true }),
  'driver.app': p('self', 'Espace du chauffeur (ses courses, son dossier, ses revenus)'),
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(code: string): code is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, code);
}

const codes = (filter: (d: PermissionDefinition) => boolean): Permission[] => PERMISSION_CODES.filter((c) => filter(PERMISSIONS[c]));
/** Permissions du personnel : tout sauf les espaces personnels (chauffeur). */
const STAFF_PERMISSIONS = codes((d) => d.module !== 'self');

/**
 * Correspondance transitoire des anciens rôles (étape 19) : dérivée des routes existantes, elle reproduit exactement les
 * accès d'avant la bascule. `admin` a toutes les permissions du personnel.
 */
const READ: Permission[] = [
  'agents.read', 'agents.runs.read', 'audit.read', 'clients.read', 'compliance.read', 'dashboard.read', 'documents.read', 'drivers.read', 'incidents.read',
  'invoices.read', 'leads.read', 'metrics.read', 'offers.read', 'pricing.read', 'privacy.requests.read', 'quality.read', 'queues.read', 'reports.read',
  'retention.read', 'rides.read', 'settings.read', 'statements.read', 'vehicles.read',
];
export const LEGACY_ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  admin: STAFF_PERMISSIONS,
  operator: [
    ...READ, 'agents.run', 'agents.tools', 'approvals.decide', 'clients.notes.write', 'conversations.reply', 'documents.content.read', 'documents.review',
    'drivers.activate', 'drivers.notes.write', 'drivers.programs.manage', 'drivers.sanctions.apply', 'drivers.suspend', 'fairness.appeals.decide',
    'incidents.create', 'incidents.decide', 'invoices.sev.retry', 'leads.manage', 'pricing.benchmarks.manage', 'pricing.edit', 'privacy.incidents.manage',
    'quality.run', 'queues.retry', 'refunds.create', 'rides.assign', 'rides.cancel', 'rides.create', 'rides.hold', 'rides.interrupt', 'rides.messages.write',
    'rides.reassign', 'vehicles.inspections.record', 'vehicles.review', 'zones.edit',
  ],
  finance: [...READ, 'invoices.sev.retry', 'ledgers.manage', 'ledgers.read', 'payments.webhooks.retry', 'refunds.create', 'statements.manage'],
  readonly: READ,
  agent: ['agents.run', 'agents.runs.read', 'agents.tools'],
  driver: ['driver.app'],
};

/** Niveaux d'administration : N0 plateforme, N1 organisation cliente, N2 sous-organisation, N3 opérations, N4 clients. */
export type RoleLevel = 0 | 1 | 2 | 3 | 4;

export interface SystemRole {
  code: string;
  name: string;
  level: RoleLevel;
  permissions: readonly Permission[];
}

/** Permissions qu'une organisation cliente peut détenir (étape 20 : la fiche d'organisation est ouverte à tout membre qui en a au moins une). */
export const ORGANIZATION_PERMISSIONS: readonly Permission[] = codes((d) => !d.platformOnly && d.module !== 'self');
const ORG_PERMISSIONS = ORGANIZATION_PERMISSIONS;
const ORG_READ = READ.filter((c) => !PERMISSIONS[c].platformOnly);

/** Rôles système : ceux de la plateforme reprennent les anciens rôles ; ceux des organisations ignorent les permissions N0. */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  { code: 'platform_admin', name: 'Administrateur plateforme', level: 0, permissions: LEGACY_ROLE_PERMISSIONS['admin']! },
  { code: 'platform_dispatcher', name: 'Répartiteur plateforme', level: 0, permissions: LEGACY_ROLE_PERMISSIONS['operator']! },
  { code: 'platform_finance', name: 'Finance plateforme', level: 0, permissions: LEGACY_ROLE_PERMISSIONS['finance']! },
  { code: 'platform_readonly', name: 'Lecture plateforme', level: 0, permissions: LEGACY_ROLE_PERMISSIONS['readonly']! },
  { code: 'org_owner', name: 'Propriétaire du compte', level: 1, permissions: ORG_PERMISSIONS },
  { code: 'org_admin', name: 'Administrateur', level: 1, permissions: ORG_PERMISSIONS.filter((c) => c !== 'members.manage' && c !== 'roles.manage') },
  { code: 'dispatcher', name: 'Répartiteur', level: 2, permissions: [...ORG_READ, 'rides.create', 'rides.assign', 'rides.reassign', 'rides.hold', 'rides.cancel', 'rides.messages.write', 'incidents.create'] },
  { code: 'fleet_manager', name: 'Gestionnaire de flotte', level: 2, permissions: ['drivers.read', 'documents.read', 'documents.review', 'vehicles.read', 'vehicles.review', 'vehicles.inspections.record', 'compliance.read', 'quality.read', 'rides.read', 'statements.read'] },
  { code: 'accountant', name: 'Comptable', level: 2, permissions: ['dashboard.read', 'invoices.read', 'statements.read', 'ledgers.read', 'reports.read', 'rides.read'] },
  { code: 'agent_member', name: 'Agent (sous-compte d\'un employé)', level: 2, permissions: ['rides.read', 'rides.create', 'clients.read'] },
  { code: 'driver', name: 'Chauffeur', level: 3, permissions: ['driver.app'] },
];

export function systemRole(code: string): SystemRole | null {
  return SYSTEM_ROLES.find((r) => r.code === code) ?? null;
}

/** Permissions des anciens rôles d'un utilisateur (rôles inconnus ignorés). */
export function legacyPermissions(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const permission of LEGACY_ROLE_PERMISSIONS[role] ?? []) out.add(permission);
  return out;
}

export type MembershipScope = 'organization' | 'subtree';

export interface EffectiveMembership {
  permissions: readonly string[];
  status: 'active' | 'suspended';
  expiresAt: Date | null;
  /** Modules de la formule de l'organisation ; `null` : aucune limite (plateforme). */
  modules: readonly string[] | null;
}

/** Droits effectifs : anciens rôles, puis adhésions actives et non expirées, limitées aux modules de leur formule. */
export function effectivePermissions(legacyRoles: readonly string[], memberships: readonly EffectiveMembership[], now: Date): Set<Permission> {
  const out = legacyPermissions(legacyRoles);
  for (const m of memberships) {
    if (m.status !== 'active' || (m.expiresAt && m.expiresAt <= now)) continue;
    for (const code of m.permissions) {
      if (!isPermission(code)) continue;
      if (m.modules && !m.modules.includes(PERMISSIONS[code].module)) continue;
      out.add(code);
    }
  }
  return out;
}

/** Au moins une des permissions requises (sémantique des routes). */
export function hasAnyPermission(held: ReadonlySet<Permission>, required: readonly Permission[]): boolean {
  return required.some((code) => held.has(code));
}

/**
 * Pas d'escalade : on n'accorde (rôle personnalisé, invitation) que des permissions qu'on détient ; une organisation
 * cliente ne reçoit jamais de permission réservée à la plateforme. Renvoie les permissions refusées.
 */
export function refusedGrants(held: ReadonlySet<Permission>, requested: readonly string[], forClientOrganization: boolean): string[] {
  return requested.filter((code) => !isPermission(code) || !held.has(code) || (forClientOrganization && PERMISSIONS[code].platformOnly));
}

/** Chemin matérialisé d'une organisation : `/<racine>/<enfant>/` ; la portée `subtree` couvre les descendants. */
export function inScope(targetPath: string, membershipPath: string, scope: MembershipScope): boolean {
  return scope === 'subtree' ? targetPath.startsWith(membershipPath) : targetPath === membershipPath;
}

export function childPath(parentPath: string, id: string): string {
  return `${parentPath}${id}/`;
}
