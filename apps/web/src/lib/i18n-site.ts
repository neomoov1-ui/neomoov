/** Textes des pages publiques du web (prompt 12) : réservation, suivi partagé, inscription des chauffeurs, droits. */
const fr = {
  book: {
    title: 'Réserver une course',
    subtitle: 'Prix fixe tout compris, garanti avant de confirmer. Réservation au moins 2 heures à l\'avance.',
    steps: { trip: 'Trajet', price: 'Prix', contact: 'Coordonnées', confirm: 'Confirmation' },
    origin: 'Adresse de départ', destination: 'Adresse d\'arrivée', addressHint: 'Tapez au moins 3 caractères puis choisissez une adresse dans la liste.',
    suggestions: 'Suggestions d\'adresses', date: 'Date', time: 'Heure', minLead: 'Au plus tôt le {{date}}.', getPrice: 'Voir les prix', quoting: 'Calcul des prix…',
    seats: '{{count}} places', eta: 'Chauffeur à environ {{minutes}} min', onAvailability: 'Selon disponibilité', choose: 'Choisir', chosen: 'Catégorie choisie', details: 'Détail du prix',
    total: 'Total tout compris', validity: 'Prix garanti pendant 5 minutes, puis recalculé.', contactTitle: 'Vos coordonnées', firstName: 'Prénom', lastName: 'Nom', phone: 'Téléphone mobile',
    phoneHint: 'Nous vous envoyons un code par texto pour confirmer votre numéro.', sendCode: 'Recevoir le code', code: 'Code reçu par texto', verify: 'Vérifier le code', resend: 'Renvoyer le code',
    verified: 'Numéro vérifié.', accept: 'J\'accepte les {{terms}} et la {{privacy}}.', terms: 'conditions d\'utilisation', privacy: 'politique de confidentialité',
    payment: 'Paiement', payDriver: 'Payer au chauffeur après la course (espèces ou terminal)', payCard: 'Payer par carte maintenant',
    cardSoon: 'Le paiement par carte en ligne sera ouvert avec la mise en service de Stripe. Choisissez le paiement au chauffeur.',
    specialRequests: 'Demandes spéciales (facultatif)', flight: 'Numéro de vol (facultatif)', confirm: 'Confirmer la réservation', confirming: 'Réservation en cours…',
    confirmedTitle: 'Réservation confirmée', confirmedBody: 'Prise en charge le {{date}}. Vous recevrez un texto quand un chauffeur sera attribué.', track: 'Suivre la course', again: 'Nouvelle réservation',
    requoted: 'Le prix a été recalculé : {{amount}}.',
    errors: {
      lead: 'Le départ doit être au moins 2 heures après maintenant.', address: 'Choisissez une adresse dans la liste.', quote: 'Prix indisponible pour ce trajet.', code: 'Code incorrect ou expiré.',
      phone: 'Numéro de téléphone invalide.', terms: 'Vous devez accepter les conditions pour créer votre compte.', rateLimited: 'Trop d\'essais. Patientez un peu.', generic: 'Une erreur est survenue. Réessayez.', service: 'Service indisponible pour le moment.',
    },
  },
  track: {
    title: 'Suivi de la course {{number}}', driver: 'Chauffeur', vehicle: 'Véhicule', eta: 'Arrivée estimée dans {{minutes}} min', destination: 'Destination', pickup: 'Prise en charge prévue',
    updated: 'Mis à jour à {{time}}', notFound: 'Ce lien de suivi est invalide.', expired: 'Ce lien de suivi a expiré.', waiting: 'Un chauffeur sera attribué avant la prise en charge.', live: 'Position en direct',
  },
  verifyInvoice: {
    title: 'Vérification d\'une facture', subtitle: 'Code QR imprimé sur une facture ou une note de crédit Neomoov.', valid: 'Facture authentique', number: 'Numéro',
    kind: 'Nature', issued: 'Émise le', supplier: 'Fournisseur du transport', total: 'Total', sev: 'Enregistrement des ventes', invalid: 'Ce code de vérification est invalide ou altéré.', missing: 'Aucun code de vérification dans le lien.',
  },
  driversPage: {
    title: 'Devenez chauffeur Neomoov',
    subtitle: 'Une application conçue par un chauffeur pour les chauffeurs : prix fixes connus avant d\'accepter, négociation encadrée, versements rapides et une vraie équipe derrière vous.',
    benefits: ['Vous voyez le prix et le trajet avant d\'accepter chaque course.', 'Clientèle premium, courses réservées à l\'avance.', 'Relevé hebdomadaire clair et versements automatiques.', 'Formation courte et accompagnement à l\'inscription.'],
    requirements: 'Conditions : permis de classe 4C ou autorisation SAAQ, véhicule électrique ou hybride admissible, vérification des antécédents.',
    form: 'Préinscription', firstName: 'Prénom', lastName: 'Nom', phone: 'Téléphone', email: 'Courriel (facultatif)', city: 'Ville', message: 'Votre véhicule et votre expérience (facultatif)',
    consent: 'J\'accepte que Neomoov me recontacte au sujet de ma candidature.', submit: 'Envoyer ma préinscription', sending: 'Envoi…',
    sent: 'Merci ! Votre préinscription est reçue.', sentBody: 'Notre équipe vous contacte sous 2 jours ouvrables. Vous pourrez ensuite finir votre inscription dans l\'application Neomoov Chauffeur.',
    errors: { generic: 'Envoi impossible pour le moment. Réessayez.', antiBot: 'La vérification anti-robots a échoué. Rechargez la page.', rateLimited: 'Trop de demandes. Réessayez plus tard.' },
  },
  rights: {
    title: 'Vos droits sur vos données',
    subtitle: 'Loi 25 : demandez l\'accès, la rectification ou la portabilité de vos données, ou retirez un consentement, puis suivez l\'état de vos demandes. Réponse sous 30 jours.',
    signIn: 'Confirmez votre numéro de téléphone pour accéder à vos demandes.', noAccount: 'Aucun compte Neomoov n\'est associé à ce numéro.',
    list: 'Vos demandes', empty: 'Aucune demande pour l\'instant.', new: 'Nouvelle demande', type: 'Type de demande', details: 'Précisions (facultatif)', submit: 'Envoyer la demande', sent: 'Demande reçue.',
    received: 'Reçue le {{date}}', due: 'Réponse au plus tard le {{date}}', processed: 'Traitée le {{date}}', download: 'Télécharger (JSON)', downloadPdf: 'Télécharger (PDF)',
    types: { access: 'Accès à mes données', rectification: 'Rectification', deletion: 'Suppression du compte', portability: 'Portabilité (export)', consent_withdrawal: 'Retrait d\'un consentement' },
    statuses: { pending: 'En cours de traitement', processed: 'Traitée' },
  },
};

const en: typeof fr = {
  book: {
    title: 'Book a ride',
    subtitle: 'Fixed, all-inclusive price, guaranteed before you confirm. Book at least 2 hours ahead.',
    steps: { trip: 'Trip', price: 'Price', contact: 'Your details', confirm: 'Confirmation' },
    origin: 'Pickup address', destination: 'Drop-off address', addressHint: 'Type at least 3 characters, then pick an address from the list.',
    suggestions: 'Address suggestions', date: 'Date', time: 'Time', minLead: 'Earliest: {{date}}.', getPrice: 'See prices', quoting: 'Calculating prices…',
    seats: '{{count}} seats', eta: 'Driver about {{minutes}} min away', onAvailability: 'Subject to availability', choose: 'Choose', chosen: 'Selected category', details: 'Price details',
    total: 'All-inclusive total', validity: 'Price guaranteed for 5 minutes, then recalculated.', contactTitle: 'Your details', firstName: 'First name', lastName: 'Last name', phone: 'Mobile phone',
    phoneHint: 'We will text you a code to confirm your number.', sendCode: 'Send me the code', code: 'Code received by text', verify: 'Check the code', resend: 'Send the code again',
    verified: 'Number confirmed.', accept: 'I accept the {{terms}} and the {{privacy}}.', terms: 'terms of use', privacy: 'privacy policy',
    payment: 'Payment', payDriver: 'Pay the driver after the ride (cash or terminal)', payCard: 'Pay by card now',
    cardSoon: 'Online card payment opens once Stripe goes live. Please choose to pay the driver.',
    specialRequests: 'Special requests (optional)', flight: 'Flight number (optional)', confirm: 'Confirm the booking', confirming: 'Booking…',
    confirmedTitle: 'Booking confirmed', confirmedBody: 'Pickup on {{date}}. We will text you when a driver is assigned.', track: 'Track the ride', again: 'New booking',
    requoted: 'The price was recalculated: {{amount}}.',
    errors: {
      lead: 'Pickup must be at least 2 hours from now.', address: 'Pick an address from the list.', quote: 'No price available for this trip.', code: 'Wrong or expired code.',
      phone: 'Invalid phone number.', terms: 'You must accept the terms to create your account.', rateLimited: 'Too many attempts. Please wait a little.', generic: 'Something went wrong. Please try again.', service: 'Service unavailable right now.',
    },
  },
  track: {
    title: 'Tracking ride {{number}}', driver: 'Driver', vehicle: 'Vehicle', eta: 'Estimated arrival in {{minutes}} min', destination: 'Destination', pickup: 'Scheduled pickup',
    updated: 'Updated at {{time}}', notFound: 'This tracking link is invalid.', expired: 'This tracking link has expired.', waiting: 'A driver will be assigned before pickup.', live: 'Live position',
  },
  verifyInvoice: {
    title: 'Invoice verification', subtitle: 'QR code printed on a Neomoov invoice or credit note.', valid: 'Authentic invoice', number: 'Number',
    kind: 'Type', issued: 'Issued on', supplier: 'Transport supplier', total: 'Total', sev: 'Sales recording', invalid: 'This verification code is invalid or has been altered.', missing: 'No verification code in the link.',
  },
  driversPage: {
    title: 'Drive with Neomoov',
    subtitle: 'An app designed by a driver for drivers: fixed prices known before you accept, fair negotiation, fast payouts and a real team behind you.',
    benefits: ['You see the price and route before accepting each ride.', 'Premium customers, rides booked ahead.', 'Clear weekly statement and automatic payouts.', 'Short training and help with sign-up.'],
    requirements: 'Requirements: class 4C licence or SAAQ authorization, eligible electric or hybrid vehicle, background check.',
    form: 'Pre-registration', firstName: 'First name', lastName: 'Last name', phone: 'Phone', email: 'Email (optional)', city: 'City', message: 'Your vehicle and experience (optional)',
    consent: 'I agree that Neomoov may contact me about my application.', submit: 'Send my pre-registration', sending: 'Sending…',
    sent: 'Thank you! Your pre-registration was received.', sentBody: 'Our team will contact you within 2 business days. You can then finish signing up in the Neomoov Driver app.',
    errors: { generic: 'Unable to send right now. Please try again.', antiBot: 'The anti-bot check failed. Reload the page.', rateLimited: 'Too many requests. Please try again later.' },
  },
  rights: {
    title: 'Your data rights',
    subtitle: 'Quebec Law 25: request access, correction or portability of your data, or withdraw a consent, then follow your requests. Answer within 30 days.',
    signIn: 'Confirm your phone number to see your requests.', noAccount: 'No Neomoov account uses this number.',
    list: 'Your requests', empty: 'No requests yet.', new: 'New request', type: 'Request type', details: 'Details (optional)', submit: 'Send the request', sent: 'Request received.',
    received: 'Received on {{date}}', due: 'Answer by {{date}}', processed: 'Processed on {{date}}', download: 'Download (JSON)', downloadPdf: 'Download (PDF)',
    types: { access: 'Access to my data', rectification: 'Correction', deletion: 'Account deletion', portability: 'Portability (export)', consent_withdrawal: 'Withdraw a consent' },
    statuses: { pending: 'Being processed', processed: 'Processed' },
  },
};

export const siteTexts = { 'fr-CA': fr, en };
