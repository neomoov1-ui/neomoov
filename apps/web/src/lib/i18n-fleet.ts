/**
 * Textes des pages Flotte de My Hub (étape 23). L'anglais a le type du français : une clé manquante ou en trop ne
 * compile pas. Espace `fleet` des traductions.
 */
const fr = {
  nav: { group: 'Flotte', drivers: 'Chauffeurs rattachés', vehicles: 'Véhicules et entretien', live: 'Carte en direct', dispatch: 'Répartition interne', statements: 'Partage et versements', reports: 'Rapports' },
  selector: { label: 'Organisation', none: 'Aucune organisation : demandez une invitation à son administrateur.', loading: 'Chargement des organisations…' },
  scope: 'Courses Neomoov seulement : aucune donnée ni action sur une autre plateforme.',
  join: {
    title: 'Rejoindre une flotte',
    subtitle: 'Vous avez reçu une invitation par texto. Connectez-vous avec le même numéro de téléphone, puis acceptez : votre profil de chauffeur Neomoov est rattaché à l\'organisation qui vous invite.',
    token: 'Code d\'invitation', accept: 'Accepter l\'invitation',
    done: 'C\'est fait : vous conduisez maintenant pour {{organization}}. Ouvrez l\'application chauffeur Neomoov pour la suite.',
    doneNew: 'C\'est fait : votre dossier de chauffeur est ouvert chez {{organization}}. Ouvrez l\'application chauffeur Neomoov pour déposer vos documents.',
    errors: { notForYou: 'Cette invitation est adressée à un autre numéro de téléphone.', expired: 'Cette invitation a expiré : demandez-en une nouvelle.', used: 'Cette invitation a déjà servi.', generic: 'Invitation introuvable ou impossible à accepter pour le moment.' },
  },
  drivers: {
    title: 'Chauffeurs rattachés', invite: 'Inviter un chauffeur', phone: 'Téléphone (format +15145550101)', firstName: 'Prénom (facultatif)', language: 'Langue du texto',
    send: 'Envoyer l\'invitation', sent: 'Invitation envoyée par texto au {{phone}}.', documents: 'Documents', vehicle: 'Véhicule courant', nextExpiry: 'Prochaine échéance',
    nextInspection: 'Prochaine inspection', status: 'État', pending: 'en attente', approved: 'approuvés', expiring: 'échéances proches', none: 'Aucun chauffeur rattaché.',
    expiringTitle: 'Échéances de conformité (30 jours)', expiringNone: 'Aucune échéance proche.',
    review: { title: 'Documents de {{name}}', approve: 'Recommander l\'approbation', reject: 'Refuser', note: 'Motif du refus', final: 'L\'approbation finale reste à la plateforme.', orgReviewed: 'Revu par l\'organisation : {{decision}}' },
  },
  vehicles: {
    title: 'Véhicules de l\'organisation', category: 'Catégorie', add: 'Ajouter un véhicule', holder: 'Chauffeur titulaire', make: 'Marque', model: 'Modèle', year: 'Année', colour: 'Couleur', plate: 'Plaque', seats: 'Places',
    odometer: 'Kilométrage', create: 'Enregistrer', assign: 'Affecter', assignTo: 'Affecter à', maintenance: 'Entretien', none: 'Aucun véhicule.', pendingInspection: 'Le véhicule attend l\'inspection de la plateforme.',
    maintenanceTitle: 'Entretien du véhicule {{plate}}', kind: 'Type', performedOn: 'Date', cost: 'Coût ($)', nextDueOn: 'Prochaine échéance', nextDueKm: 'Prochain kilométrage', notes: 'Notes', record: 'Enregistrer l\'entretien',
    due: 'Échéances', ai: 'Suggestion de l\'agent IA : reportée.', kinds: { inspection: 'Inspection', oil_change: 'Vidange', tires: 'Pneus', brakes: 'Freins', battery: 'Batterie', repair: 'Réparation', cleaning: 'Nettoyage', other: 'Autre' },
    dueStatus: { ok: 'à jour', due_soon: 'proche', overdue: 'en retard' }, retire: 'Retirer du service',
  },
  live: { title: 'Carte en direct', drivers: 'Chauffeurs en ligne', rides: 'Courses en cours', available: 'Disponible', busy: 'Occupé', onRide: 'En course', network: 'Réseau Neomoov', refresh: 'Actualisée toutes les 15 secondes', none: 'Aucune course en cours.' },
  dispatch: {
    title: 'Répartition interne', open: 'Courses à pourvoir et attribuées', assign: 'Attribuer', reassign: 'Réattribuer', reason: 'Motif', driver: 'Chauffeur de l\'organisation',
    settings: 'Mode réseau', isolated: 'Isolé : les courses restent à vos chauffeurs', network: 'Réseau Neomoov : une course non pourvue repart au réseau après le délai', delay: 'Délai (minutes)', save: 'Enregistrer',
    newRide: 'Une course se saisit depuis « Nouvelle course » de l\'organisation (devis puis course) ; elle apparaît ici.',
  },
  statements: {
    title: 'Partage des revenus et versements', rules: 'Règles de partage', newRule: 'Nouvelle règle', mode: 'Mode', rent: 'Loyer par semaine', percentage: 'Pourcentage du tarif chauffeur',
    amount: 'Loyer ($ par semaine)', share: 'Part de l\'organisation (%)', driver: 'Chauffeur (vide : toute l\'organisation)', from: 'Début', to: 'Fin', end: 'Clore', allDrivers: 'Toute l\'organisation',
    account: 'Compte de versement', connect: 'Versements automatiques par Stripe Connect', offline: 'Règlement hors plateforme (virement, Interac) tant que Stripe Connect n\'est pas en service',
    openAccount: 'Ouvrir le compte de versement', simulated: 'Parcours simulé (Stripe non branché).', organizationStatements: 'Relevés de l\'organisation', period: 'Semaine', status: 'État',
    total: 'Part', drivers: 'Chauffeurs', settle: 'Constater le règlement', method: 'Moyen', reference: 'Référence', export: 'Exporter les virements (CSV)', none: 'Aucun relevé pour le moment.',
    statuses: { issued: 'à verser', paid: 'versé', failed: 'en échec', settled_offline: 'réglé hors plateforme', unknown: 'sans réponse du prestataire' },
    methods: { interac: 'Interac', bank_transfer: 'Virement', cash: 'Espèces', cheque: 'Chèque', other: 'Autre' },
  },
  reports: {
    title: 'Rapports de la flotte', week: 'Semaine du', rides: 'Courses', fare: 'Revenus (tarif chauffeur)', share: 'Part de l\'organisation', byDriver: 'Par chauffeur', byVehicle: 'Par véhicule',
    owner: 'Mes véhicules (propriétaire)', ownerNone: 'Aucun véhicule à votre nom dans cette organisation.',
  },
};

const en: typeof fr = {
  nav: { group: 'Fleet', drivers: 'Attached drivers', vehicles: 'Vehicles and maintenance', live: 'Live map', dispatch: 'Internal dispatch', statements: 'Revenue share and payouts', reports: 'Reports' },
  selector: { label: 'Organization', none: 'No organization: ask its administrator for an invitation.', loading: 'Loading organizations…' },
  scope: 'Neomoov rides only: no data from or action on any other platform.',
  join: {
    title: 'Join a fleet',
    subtitle: 'You received an invitation by text message. Sign in with the same phone number, then accept: your Neomoov driver profile is attached to the organization inviting you.',
    token: 'Invitation code', accept: 'Accept the invitation',
    done: 'Done: you now drive for {{organization}}. Open the Neomoov driver app to continue.',
    doneNew: 'Done: your driver file is open with {{organization}}. Open the Neomoov driver app to upload your documents.',
    errors: { notForYou: 'This invitation is for another phone number.', expired: 'This invitation has expired: ask for a new one.', used: 'This invitation has already been used.', generic: 'Invitation not found or cannot be accepted right now.' },
  },
  drivers: {
    title: 'Attached drivers', invite: 'Invite a driver', phone: 'Phone (format +15145550101)', firstName: 'First name (optional)', language: 'Text message language',
    send: 'Send the invitation', sent: 'Invitation sent by text message to {{phone}}.', documents: 'Documents', vehicle: 'Current vehicle', nextExpiry: 'Next expiry',
    nextInspection: 'Next inspection', status: 'Status', pending: 'pending', approved: 'approved', expiring: 'expiring soon', none: 'No attached driver.',
    expiringTitle: 'Compliance deadlines (30 days)', expiringNone: 'No upcoming deadline.',
    review: { title: 'Documents of {{name}}', approve: 'Recommend approval', reject: 'Reject', note: 'Reason for rejection', final: 'Final approval remains with the platform.', orgReviewed: 'Reviewed by the organization: {{decision}}' },
  },
  vehicles: {
    title: 'Organization vehicles', category: 'Category', add: 'Add a vehicle', holder: 'Holding driver', make: 'Make', model: 'Model', year: 'Year', colour: 'Colour', plate: 'Plate', seats: 'Seats',
    odometer: 'Odometer', create: 'Save', assign: 'Assign', assignTo: 'Assign to', maintenance: 'Maintenance', none: 'No vehicle.', pendingInspection: 'The vehicle awaits the platform inspection.',
    maintenanceTitle: 'Maintenance of vehicle {{plate}}', kind: 'Type', performedOn: 'Date', cost: 'Cost ($)', nextDueOn: 'Next due date', nextDueKm: 'Next due odometer', notes: 'Notes', record: 'Record maintenance',
    due: 'Due items', ai: 'AI agent suggestion: postponed.', kinds: { inspection: 'Inspection', oil_change: 'Oil change', tires: 'Tires', brakes: 'Brakes', battery: 'Battery', repair: 'Repair', cleaning: 'Cleaning', other: 'Other' },
    dueStatus: { ok: 'up to date', due_soon: 'due soon', overdue: 'overdue' }, retire: 'Retire from service',
  },
  live: { title: 'Live map', drivers: 'Online drivers', rides: 'Active rides', available: 'Available', busy: 'Busy', onRide: 'On a ride', network: 'Neomoov network', refresh: 'Refreshed every 15 seconds', none: 'No active ride.' },
  dispatch: {
    title: 'Internal dispatch', open: 'Rides to fill and assigned', assign: 'Assign', reassign: 'Reassign', reason: 'Reason', driver: 'Organization driver',
    settings: 'Network mode', isolated: 'Isolated: rides stay with your drivers', network: 'Neomoov network: an unfilled ride goes to the network after the delay', delay: 'Delay (minutes)', save: 'Save',
    newRide: 'Enter a ride from the organization\'s "New ride" (quote then ride); it appears here.',
  },
  statements: {
    title: 'Revenue share and payouts', rules: 'Revenue share rules', newRule: 'New rule', mode: 'Mode', rent: 'Weekly rent', percentage: 'Percentage of the driver fare',
    amount: 'Rent ($ per week)', share: 'Organization share (%)', driver: 'Driver (empty: whole organization)', from: 'Start', to: 'End', end: 'End', allDrivers: 'Whole organization',
    account: 'Payout account', connect: 'Automatic payouts through Stripe Connect', offline: 'Off-platform settlement (bank transfer, Interac) until Stripe Connect is live',
    openAccount: 'Open the payout account', simulated: 'Simulated flow (Stripe not connected).', organizationStatements: 'Organization statements', period: 'Week', status: 'Status',
    total: 'Share', drivers: 'Drivers', settle: 'Record settlement', method: 'Method', reference: 'Reference', export: 'Export payouts (CSV)', none: 'No statement yet.',
    statuses: { issued: 'to pay', paid: 'paid', failed: 'failed', settled_offline: 'settled off-platform', unknown: 'no answer from the provider' },
    methods: { interac: 'Interac', bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other' },
  },
  reports: {
    title: 'Fleet reports', week: 'Week of', rides: 'Rides', fare: 'Revenue (driver fare)', share: 'Organization share', byDriver: 'By driver', byVehicle: 'By vehicle',
    owner: 'My vehicles (owner)', ownerNone: 'No vehicle in your name in this organization.',
  },
};

export const fleetTexts = { 'fr-CA': fr, en };
