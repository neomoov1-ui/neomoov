/**
 * Textes de My Hub côté organisation cliente (étape 21) : connexion par code SMS, sélecteur d'organisation, menu selon
 * les permissions, pages de l'organisation, double authentification des membres, accès temporaire du support.
 * L'anglais a le type du français : une clé manquante ou en trop ne compile pas.
 */
const fr = {
  login: {
    tabs: { staff: 'Personnel Neomoov', organization: 'Organisation' },
    title: 'Connexion des organisations',
    subtitle: 'Membres d\'une compagnie, d\'une flotte ou d\'une entreprise : recevez un code par texto au numéro de votre compte.',
    phone: 'Téléphone', phoneHint: 'Format 514 555-0142 ou +15145550142.', send: 'Recevoir le code', code: 'Code reçu par texto', verify: 'Se connecter', resend: 'Changer de numéro',
    noAccount: 'Aucun compte pour ce numéro. Ouvrez le lien de votre invitation pour créer votre compte et rejoindre votre organisation.',
    errors: { phone: 'Numéro de téléphone invalide.', code: 'Code incorrect ou expiré.', rateLimited: 'Trop d\'essais. Patientez une minute.', generic: 'Connexion impossible pour le moment.' },
  },
  shell: {
    space: 'Espace organisation', choose: 'Organisation', none: 'Vous n\'êtes membre d\'aucune organisation pour le moment. Demandez une invitation à son administrateur.',
    support: 'accès support',
    supportBanner: 'Accès support en cours jusqu\'à {{until}}. Motif : {{reason}}. Chaque action est journalisée dans le journal de l\'organisation.',
    mfaNotice: 'Certaines permissions de votre rôle (gestion des membres et des rôles, relevés) exigent la double authentification.', mfaAction: 'Activer la double authentification',
    platform: 'Retour à la plateforme', loading: 'Chargement de l\'organisation…', forbidden: 'Vous n\'avez accès à aucune page de cette organisation.',
  },
  nav: {
    groups: { activity: 'Activité', team: 'Équipe et accès', admin: 'Administration' },
    dashboard: 'Tableau de bord', rides: 'Courses', drivers: 'Chauffeurs', vehicles: 'Véhicules', statements: 'Relevés', members: 'Membres', roles: 'Rôles',
    organizations: 'Sous-organisations', audit: 'Journal', support: 'Accès du support', security: 'Sécurité du compte',
    newRide: 'Nouvelle course',
  },
  newRide: {
    title: 'Nouvelle course',
    subtitle: 'Course reçue par téléphone ou au comptoir : prix garanti du devis, paiement au chauffeur. Elle est proposée d\'abord aux chauffeurs de l\'organisation.',
    guestOnly: 'Le client est enregistré par une fiche minimale (nom, téléphone, langue) : les comptes clients de la plateforme ne sont pas consultables depuis une organisation.',
  },
  dashboard: {
    title: 'Tableau de bord', ridesToday: 'Courses du jour', ridesActive: 'Courses en cours', completedToday: 'Terminées aujourd\'hui', revenueToday: 'Montant du jour',
    scheduled: 'Planifiées à venir', driversActive: 'Chauffeurs actifs', driversOnline: 'Chauffeurs en ligne', driversPaused: 'En pause', statementsPending: 'Relevés à venir',
    statementsNet: 'Net des relevés à venir', subOrganizations: 'Sous-organisations', members: 'Membres actifs', subtree: 'Chiffres de l\'organisation et de ses sous-organisations.',
  },
  rides: { title: 'Courses', detail: 'Course', back: 'Retour aux courses', route: 'Trajet', when: 'Heure demandée', driver: 'Chauffeur', price: 'Prix', payment: 'Paiement', timeline: 'Étapes', notFound: 'Course introuvable dans cette organisation.' },
  members: {
    title: 'Membres', invite: 'Inviter un membre', inviteHint: 'Le lien part par texto ou par courriel ; il sert une seule fois et expire dans 7 jours.',
    sent: 'Invitation envoyée par {{channel}}.', devToken: 'Lien (développement seulement) :', channels: { sms: 'texto', email: 'courriel' },
    invitations: 'Invitations', contact: 'Destinataire', expires: 'Expire le', revoke: 'Révoquer', statuses: { pending: 'En attente', accepted: 'Acceptée', expired: 'Expirée', revoked: 'Révoquée' },
    changeRole: 'Changer de rôle', newRole: 'Nouveau rôle', transfer: 'Transférer la propriété', transferTitle: 'Transférer la propriété du compte',
    transferHint: 'Le membre choisi devient propriétaire du compte ; vous devenez administrateur. L\'opération est journalisée.', owner: 'Propriétaire', you: 'vous',
    lastOwner: 'Dernier propriétaire du compte : transférez d\'abord la propriété à un autre membre.', confirmRemove: 'Retirer ce membre de l\'organisation ?', noInvitations: 'Aucune invitation.',
  },
  roles: {
    title: 'Rôles', intro: 'Composez un rôle à partir du catalogue : seules les permissions que vous détenez dans cette organisation peuvent être accordées.',
    create: 'Nouveau rôle', edit: 'Modifier les permissions', notHeld: 'non détenue', editTitle: 'Permissions du rôle {{name}}',
    sensitiveWarning: 'Permissions sensibles choisies : {{list}}. Elles n\'agissent qu\'avec la double authentification de la personne et chaque usage est journalisé.',
    readOnly: 'Rôle système : lecture seule.',
  },
  orgs: { title: 'Sous-organisations', intro: 'Une sous-organisation reçoit au plus les modules de son parent. Ses membres ne voient que ses données et celles de ses propres sous-organisations.', create: 'Nouvelle sous-organisation', parent: 'Sous', manage: 'Gérer', current: 'Organisation affichée' },
  audit: { title: 'Journal de l\'organisation', intro: 'Toutes les actions faites dans l\'organisation et ses sous-organisations, dont les accès du support.' },
  support: {
    title: 'Accès du support Neomoov', intro: 'Le support de la plateforme ne peut consulter votre organisation qu\'avec votre accord, pour une durée limitée. Chaque accès et chaque action sont journalisés.',
    requestedBy: 'Demandé par', reason: 'Motif', duration: 'Durée', minutes: '{{count}} min', status: 'État', period: 'Période', approve: 'Approuver', deny: 'Refuser', revoke: 'Révoquer',
    statuses: { requested: 'Demandé', approved: 'Approuvé', denied: 'Refusé', expired: 'Expiré', revoked: 'Révoqué' }, active: 'En cours', none: 'Aucune demande d\'accès.',
    pendingNotice: '{{count}} demande(s) d\'accès du support en attente de votre décision.',
  },
  security: {
    title: 'Sécurité du compte', intro: 'La double authentification protège les actions sensibles (gestion des membres et des rôles, relevés). Utilisez une application d\'authentification (Google Authenticator, Microsoft Authenticator, 1Password).',
    active: 'Double authentification active pour cette session.', start: 'Activer la double authentification', verifyTitle: 'Code de votre application d\'authentification',
    unlocks: 'Permissions débloquées : {{list}}.', done: 'Double authentification active.',
  },
  platform: {
    title: 'Accès du support aux organisations', intro: 'Demandez un accès temporaire à une organisation cliente : ses propriétaires sont avisés par texto et décident. Pendant l\'accès, vous agissez avec vos permissions, limitées à celles d\'une organisation cliente ; tout est journalisé dans son journal.',
    request: 'Demander un accès', organization: 'Organisation', reason: 'Motif (au moins 10 caractères)', duration: 'Durée (minutes)', open: 'Ouvrir l\'espace de l\'organisation', end: 'Mettre fin',
    requested: 'Demande envoyée : l\'organisation doit l\'approuver.',
  },
};

const en: typeof fr = {
  login: {
    tabs: { staff: 'Neomoov staff', organization: 'Organization' },
    title: 'Organization sign-in',
    subtitle: 'Members of a company, fleet or business: receive a code by text message at your account\'s number.',
    phone: 'Phone', phoneHint: 'Format 514 555-0142 or +15145550142.', send: 'Get the code', code: 'Code received by text', verify: 'Sign in', resend: 'Change number',
    noAccount: 'No account for this number. Open your invitation link to create your account and join your organization.',
    errors: { phone: 'Invalid phone number.', code: 'Wrong or expired code.', rateLimited: 'Too many attempts. Please wait a minute.', generic: 'Unable to sign in right now.' },
  },
  shell: {
    space: 'Organization space', choose: 'Organization', none: 'You are not a member of any organization yet. Ask its administrator for an invitation.',
    support: 'support access',
    supportBanner: 'Support access in progress until {{until}}. Reason: {{reason}}. Every action is recorded in the organization\'s log.',
    mfaNotice: 'Some permissions of your role (managing members and roles, statements) require two-factor authentication.', mfaAction: 'Turn on two-factor authentication',
    platform: 'Back to the platform', loading: 'Loading the organization…', forbidden: 'You cannot access any page of this organization.',
  },
  nav: {
    groups: { activity: 'Activity', team: 'Team and access', admin: 'Administration' },
    dashboard: 'Dashboard', rides: 'Rides', drivers: 'Drivers', vehicles: 'Vehicles', statements: 'Statements', members: 'Members', roles: 'Roles',
    organizations: 'Sub-organizations', audit: 'Log', support: 'Support access', security: 'Account security',
    newRide: 'New ride',
  },
  newRide: {
    title: 'New ride',
    subtitle: 'Ride taken by phone or at the counter: guaranteed price from the quote, paid to the driver. It is offered first to the organization\'s drivers.',
    guestOnly: 'The customer is recorded with a minimal profile (name, phone, language): platform customer accounts cannot be browsed from an organization.',
  },
  dashboard: {
    title: 'Dashboard', ridesToday: 'Rides today', ridesActive: 'Rides in progress', completedToday: 'Completed today', revenueToday: 'Today\'s amount',
    scheduled: 'Upcoming scheduled', driversActive: 'Active drivers', driversOnline: 'Drivers online', driversPaused: 'Paused', statementsPending: 'Upcoming statements',
    statementsNet: 'Net of upcoming statements', subOrganizations: 'Sub-organizations', members: 'Active members', subtree: 'Figures for the organization and its sub-organizations.',
  },
  rides: { title: 'Rides', detail: 'Ride', back: 'Back to rides', route: 'Route', when: 'Requested time', driver: 'Driver', price: 'Price', payment: 'Payment', timeline: 'Steps', notFound: 'Ride not found in this organization.' },
  members: {
    title: 'Members', invite: 'Invite a member', inviteHint: 'The link is sent by text or email; it works once and expires in 7 days.',
    sent: 'Invitation sent by {{channel}}.', devToken: 'Link (development only):', channels: { sms: 'text message', email: 'email' },
    invitations: 'Invitations', contact: 'Recipient', expires: 'Expires on', revoke: 'Revoke', statuses: { pending: 'Pending', accepted: 'Accepted', expired: 'Expired', revoked: 'Revoked' },
    changeRole: 'Change role', newRole: 'New role', transfer: 'Transfer ownership', transferTitle: 'Transfer account ownership',
    transferHint: 'The chosen member becomes the account owner; you become an administrator. The operation is recorded.', owner: 'Owner', you: 'you',
    lastOwner: 'Last account owner: transfer ownership to another member first.', confirmRemove: 'Remove this member from the organization?', noInvitations: 'No invitations.',
  },
  roles: {
    title: 'Roles', intro: 'Build a role from the catalogue: only permissions you hold in this organization can be granted.',
    create: 'New role', edit: 'Edit permissions', notHeld: 'not held', editTitle: 'Permissions of role {{name}}',
    sensitiveWarning: 'Sensitive permissions selected: {{list}}. They only work with the person\'s two-factor authentication and every use is recorded.',
    readOnly: 'System role: read only.',
  },
  orgs: { title: 'Sub-organizations', intro: 'A sub-organization gets at most its parent\'s modules. Its members only see its data and that of its own sub-organizations.', create: 'New sub-organization', parent: 'Under', manage: 'Manage', current: 'Organization shown' },
  audit: { title: 'Organization log', intro: 'Every action taken in the organization and its sub-organizations, including support access.' },
  support: {
    title: 'Neomoov support access', intro: 'Platform support can only look into your organization with your consent, for a limited time. Every access and every action is recorded.',
    requestedBy: 'Requested by', reason: 'Reason', duration: 'Duration', minutes: '{{count}} min', status: 'Status', period: 'Period', approve: 'Approve', deny: 'Deny', revoke: 'Revoke',
    statuses: { requested: 'Requested', approved: 'Approved', denied: 'Denied', expired: 'Expired', revoked: 'Revoked' }, active: 'In progress', none: 'No access requests.',
    pendingNotice: '{{count}} support access request(s) awaiting your decision.',
  },
  security: {
    title: 'Account security', intro: 'Two-factor authentication protects sensitive actions (managing members and roles, statements). Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password).',
    active: 'Two-factor authentication is on for this session.', start: 'Turn on two-factor authentication', verifyTitle: 'Code from your authenticator app',
    unlocks: 'Permissions unlocked: {{list}}.', done: 'Two-factor authentication is on.',
  },
  platform: {
    title: 'Support access to organizations', intro: 'Request temporary access to a client organization: its owners are notified by text and decide. During the access you act with your own permissions, limited to those of a client organization; everything is recorded in its log.',
    request: 'Request access', organization: 'Organization', reason: 'Reason (at least 10 characters)', duration: 'Duration (minutes)', open: 'Open the organization space', end: 'End now',
    requested: 'Request sent: the organization must approve it.',
  },
};

export const orgTexts = { 'fr-CA': fr, en };
