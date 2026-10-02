/**
 * Gabarits des notifications (section 5.14), en français (FR-CA) et en anglais : titre et texte (push, texto,
 * WhatsApp), objet et corps HTML (courriel). Fonctions pures, testées ; un gabarit inconnu donne un texte générique
 * plutôt qu'une erreur (une notification n'est jamais perdue pour un libellé manquant).
 */
import { BILLING_TEMPLATES } from '../platform-billing/billing-templates.js';

export type TemplateLanguage = 'fr' | 'en';
type Data = Record<string, unknown>;

export interface RenderedNotification {
  title: string;
  body: string;
  /** Objet et HTML du courriel. */
  subject: string;
  html: string;
  /** Données transmises à l'application avec le push (liens profonds). */
  deepLink: Record<string, string>;
}

const TIME_ZONE = 'America/Toronto';

export function money(cents: unknown, language: TemplateLanguage): string {
  const value = typeof cents === 'number' ? cents : 0;
  return new Intl.NumberFormat(language === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD' }).format(value / 100);
}

export function when(iso: unknown, language: TemplateLanguage): string {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-CA' : 'fr-CA', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

type Text = (d: Data, l: TemplateLanguage) => string;
interface Template {
  fr: { title: Text | string; body: Text | string };
  en: { title: Text | string; body: Text | string };
}

const ride = (d: Data) => (str(d['publicNumber']) ? ` ${str(d['publicNumber'])}` : '');

/** Gabarits par code : l'événement de la matrice 5.14 et son destinataire. */
const TEMPLATES: Record<string, Template> = {
  'ride.requested': {
    fr: { title: 'Course demandée', body: (d) => `Nous recherchons votre chauffeur pour la course${ride(d)}.` },
    en: { title: 'Ride requested', body: (d) => `We are finding your driver for ride${ride(d)}.` },
  },
  'ride.scheduled_confirmed': {
    fr: { title: 'Réservation confirmée', body: (d, l) => `Votre course${ride(d)} est réservée pour le ${when(d['requestedAt'], l)}.` },
    en: { title: 'Booking confirmed', body: (d, l) => `Your ride${ride(d)} is booked for ${when(d['requestedAt'], l)}.` },
  },
  'ride.scheduled_assigned': {
    fr: { title: 'Chauffeur confirmé pour votre réservation', body: (d, l) => `Votre course${ride(d)} du ${when(d['requestedAt'], l)} est confirmée${d['driverName'] ? ` avec ${str(d['driverName'])}` : ''}${d['vehicle'] ? ` : ${str(d['vehicle'])}, plaque ${str(d['plate'])}` : ''}.` },
    en: { title: 'Driver confirmed for your booking', body: (d, l) => `Your ride${ride(d)} on ${when(d['requestedAt'], l)} is confirmed${d['driverName'] ? ` with ${str(d['driverName'])}` : ''}${d['vehicle'] ? `: ${str(d['vehicle'])}, plate ${str(d['plate'])}` : ''}.` },
  },
  'ride.scheduled_driver_departed': {
    fr: { title: 'Votre chauffeur est en route', body: (d) => `${d['driverName'] ? str(d['driverName']) : 'Votre chauffeur'} est parti vers le point de départ${d['vehicle'] ? ` : ${str(d['vehicle'])}, plaque ${str(d['plate'])}` : ''}.` },
    en: { title: 'Your driver is on the way', body: (d) => `${d['driverName'] ? str(d['driverName']) : 'Your driver'} has left for the pickup point${d['vehicle'] ? `: ${str(d['vehicle'])}, plate ${str(d['plate'])}` : ''}.` },
  },
  'ride.scheduled_reminder': {
    fr: { title: 'Rappel de votre course', body: (d, l) => `Votre course est prévue le ${when(d['requestedAt'], l)}.` },
    en: { title: 'Ride reminder', body: (d, l) => `Your ride is scheduled for ${when(d['requestedAt'], l)}.` },
  },
  'ride.scheduled_confirmed_driver': {
    fr: { title: 'Réservation attribuée', body: 'Une réservation vous est confirmée. Consultez vos courses planifiées.' },
    en: { title: 'Booking assigned', body: 'A booking is confirmed for you. Check your scheduled rides.' },
  },
  'ride.assigned': {
    fr: { title: 'Chauffeur attribué', body: 'Votre chauffeur est en route. Suivez son arrivée dans l\'application.' },
    en: { title: 'Driver assigned', body: 'Your driver is on the way. Follow their arrival in the app.' },
  },
  'ride.assigned_to_you': {
    fr: { title: 'Nouvelle course', body: 'Une course vous est attribuée. Ouvrez l\'application pour démarrer.' },
    en: { title: 'New ride', body: 'A ride has been assigned to you. Open the app to start.' },
  },
  // Étape 23 : invitation d'un chauffeur par son organisation (texto, lien à usage unique).
  'fleet.driver_invitation': {
    fr: {
      title: 'Invitation Neomoov',
      body: (d) => `${str(d['firstName']) ? `Bonjour ${str(d['firstName'])}, ` : ''}${str(d['organizationName'])} vous invite à conduire avec Neomoov. Acceptez l'invitation : ${str(d['link'])}`,
    },
    en: {
      title: 'Neomoov invitation',
      body: (d) => `${str(d['firstName']) ? `Hello ${str(d['firstName'])}, ` : ''}${str(d['organizationName'])} invites you to drive with Neomoov. Accept the invitation: ${str(d['link'])}`,
    },
  },
  'ride.driver_departed': {
    fr: { title: 'Votre chauffeur est en route', body: 'Votre chauffeur est parti vers le point de départ. Suivez son trajet dans l\'application.' },
    en: { title: 'Your driver is on the way', body: 'Your driver has left for the pickup point. Follow the route in the app.' },
  },
  'ride.driver_approaching': {
    fr: { title: 'Votre chauffeur approche', body: 'Votre chauffeur arrive dans environ 2 minutes.' },
    en: { title: 'Your driver is close', body: 'Your driver arrives in about 2 minutes.' },
  },
  'ride.driver_arrived': {
    fr: { title: 'Votre chauffeur est arrivé', body: 'Votre chauffeur vous attend au point de départ.' },
    en: { title: 'Your driver has arrived', body: 'Your driver is waiting at the pickup point.' },
  },
  'ride.completed': {
    fr: { title: 'Course terminée', body: (d, l) => `Merci d'avoir voyagé avec Neomoov. Total : ${money(d['finalPriceCents'], l)}. Votre reçu et votre facture sont dans l'application.` },
    en: { title: 'Ride completed', body: (d, l) => `Thank you for riding with Neomoov. Total: ${money(d['finalPriceCents'], l)}. Your receipt and invoice are in the app.` },
  },
  'ride.completed_driver': {
    fr: { title: 'Course terminée', body: (d, l) => `Course terminée. Votre tarif : ${money(d['driverAmountCents'], l)}.` },
    en: { title: 'Ride completed', body: (d, l) => `Ride completed. Your fare: ${money(d['driverAmountCents'], l)}.` },
  },
  'ride.cancelled_by_client': {
    fr: { title: 'Course annulée', body: (d, l) => (Number(d['feeCents']) > 0 ? `La course a été annulée. Frais d'annulation : ${money(d['feeCents'], l)}.` : 'La course a été annulée.') },
    en: { title: 'Ride cancelled', body: (d, l) => (Number(d['feeCents']) > 0 ? `The ride was cancelled. Cancellation fee: ${money(d['feeCents'], l)}.` : 'The ride was cancelled.') },
  },
  'ride.driver_reminder': {
    fr: { title: 'Réservation dans 90 minutes', body: (d) => (d['confirmed'] ? `Rappel : course ${str(d['publicNumber'])} à ${when(d['requestedAt'], 'fr')}. Prévoyez votre départ.` : `Course ${str(d['publicNumber'])} à ${when(d['requestedAt'], 'fr')} : confirmez-la dans l'application, sinon elle sera réattribuée.`) },
    en: { title: 'Booking in 90 minutes', body: (d) => (d['confirmed'] ? `Reminder: ride ${str(d['publicNumber'])} at ${when(d['requestedAt'], 'en')}. Plan your departure.` : `Ride ${str(d['publicNumber'])} at ${when(d['requestedAt'], 'en')}: confirm it in the app, or it will be reassigned.`) },
  },
  'ride.interrupted': {
    fr: { title: 'Course interrompue', body: 'Votre course a été interrompue par l\'équipe Neomoov. Aucun montant n\'est prélevé automatiquement ; nous vous contactons.' },
    en: { title: 'Ride interrupted', body: 'Your ride was interrupted by the Neomoov team. No amount is charged automatically; we will contact you.' },
  },
  'ride.cancelled_by_operator': {
    fr: { title: 'Course annulée par Neomoov', body: 'Votre course a été annulée par notre équipe. Contactez-nous pour toute question.' },
    en: { title: 'Ride cancelled by Neomoov', body: 'Your ride was cancelled by our team. Contact us with any questions.' },
  },
  'ride.no_show': {
    fr: { title: 'Client absent', body: (d, l) => `Le chauffeur n'a pas pu vous trouver. Frais de non-présentation : ${money(d['feeCents'], l)}.` },
    en: { title: 'No-show', body: (d, l) => `The driver could not find you. No-show fee: ${money(d['feeCents'], l)}.` },
  },
  'ride.no_driver': {
    fr: { title: 'Aucun chauffeur disponible', body: (d) => `Aucun chauffeur n'a pu accepter la course${ride(d)}. Rien ne vous est facturé.` },
    en: { title: 'No driver available', body: (d) => `No driver could accept ride${ride(d)}. You have not been charged.` },
  },
  'ride.reassigning': {
    fr: { title: 'Nouveau chauffeur en recherche', body: 'Votre chauffeur ne peut plus assurer la course : nous en cherchons un autre.' },
    en: { title: 'Finding a new driver', body: 'Your driver can no longer take the ride: we are finding another one.' },
  },
  'ride.favourite_unavailable': {
    fr: { title: 'Chauffeur favori indisponible', body: 'Votre chauffeur favori n\'est pas disponible : un autre chauffeur assure la course, sans supplément.' },
    en: { title: 'Favourite driver unavailable', body: 'Your favourite driver is not available: another driver takes the ride, with no surcharge.' },
  },
  'ride.vehicle_unavailable': {
    fr: { title: 'Véhicule demandé indisponible', body: 'Le véhicule demandé n\'est pas disponible : un véhicule de la même catégorie assure la course.' },
    en: { title: 'Requested vehicle unavailable', body: 'The requested vehicle is not available: a vehicle of the same category takes the ride.' },
  },
  'ride.counter_offer': {
    fr: { title: 'Contre-proposition', body: (d, l) => `Un chauffeur propose ${money(d['totalCents'], l)} pour votre course.` },
    en: { title: 'Counter-offer', body: (d, l) => `A driver proposes ${money(d['totalCents'], l)} for your ride.` },
  },
  'ride.negotiation_fallback': {
    fr: { title: 'Prix fixe appliqué', body: (d, l) => `Aucune proposition retenue : votre course est au prix fixe de ${money(d['totalCents'], l)}.` },
    en: { title: 'Fixed price applied', body: (d, l) => `No proposal was accepted: your ride is at the fixed price of ${money(d['totalCents'], l)}.` },
  },
  'ride.message': {
    fr: { title: 'Nouveau message', body: 'Vous avez un nouveau message concernant votre course.' },
    en: { title: 'New message', body: 'You have a new message about your ride.' },
  },
  'ride.operator_message_sms': {
    fr: { title: 'Message de Neomoov', body: (d) => `Message de Neomoov${ride(d)} : « ${str(d['body'])} ». Répondez à ce texto pour nous répondre.` },
    en: { title: 'Message from Neomoov', body: (d) => `Message from Neomoov${ride(d)}: "${str(d['body'])}". Reply to this text to answer.` },
  },
  'ride.message_sms': {
    fr: { title: 'Message de votre chauffeur', body: (d) => `Message de votre chauffeur${ride(d)} : « ${str(d['body'])} ». Répondez à ce texto pour lui écrire.` },
    en: { title: 'Message from your driver', body: (d) => `Message from your driver${ride(d)}: "${str(d['body'])}". Reply to this text to write back.` },
  },
  'ride.voice_confirmation': {
    fr: { title: 'Réservation Neomoov confirmée', body: (d, l) => `Votre course${ride(d)} est réservée pour le ${when(d['requestedAt'], l)}. Prix fixe : ${money(d['totalCents'], l)}, payé au chauffeur. Merci d'avoir appelé Neomoov.` },
    en: { title: 'Neomoov booking confirmed', body: (d, l) => `Your ride${ride(d)} is booked for ${when(d['requestedAt'], l)}. Fixed price: ${money(d['totalCents'], l)}, paid to the driver. Thank you for calling Neomoov.` },
  },
  'ride.passenger_approaching': {
    fr: { title: 'Votre chauffeur approche', body: (d) => `Votre chauffeur Neomoov arrive dans environ 2 minutes${d['vehicle'] ? ` : ${str(d['vehicle'])}, plaque ${str(d['plate'])}` : ''}.` },
    en: { title: 'Your driver is close', body: (d) => `Your Neomoov driver arrives in about 2 minutes${d['vehicle'] ? `: ${str(d['vehicle'])}, plate ${str(d['plate'])}` : ''}.` },
  },
  'ride.passenger_arrived': {
    fr: { title: 'Votre chauffeur est arrivé', body: (d) => `Votre chauffeur Neomoov vous attend au point de départ${d['vehicle'] ? ` : ${str(d['vehicle'])}, plaque ${str(d['plate'])}` : ''}.` },
    en: { title: 'Your driver has arrived', body: (d) => `Your Neomoov driver is waiting at the pickup point${d['vehicle'] ? `: ${str(d['vehicle'])}, plate ${str(d['plate'])}` : ''}.` },
  },
  'ride.passenger_tracking': {
    fr: { title: 'Votre course Neomoov', body: (d) => `${str(d['passengerName']) ? `${str(d['passengerName'])}, une` : 'Une'} course Neomoov a été réservée pour vous. Suivi : ${str(d['trackingUrl'])}` },
    en: { title: 'Your Neomoov ride', body: (d) => `${str(d['passengerName']) ? `${str(d['passengerName'])}, a` : 'A'} Neomoov ride was booked for you. Tracking: ${str(d['trackingUrl'])}` },
  },
  'ride.removed_no_movement': {
    fr: { title: 'Course retirée', body: 'Aucun déplacement vers le client : la course vous a été retirée.' },
    en: { title: 'Ride removed', body: 'No movement towards the customer: the ride has been removed from you.' },
  },
  'ride.removed_by_operator': {
    fr: { title: 'Course retirée', body: (d) => `L'exploitation a réattribué la course${ride(d)} : elle ne vous est plus confiée. Aucune sanction.` },
    en: { title: 'Ride removed', body: (d) => `Operations reassigned ride${ride(d)}: it is no longer yours. No penalty.` },
  },
  'offer.new': {
    fr: { title: 'Nouvelle offre de course', body: 'Une course vous est proposée. Répondez vite dans l\'application.' },
    en: { title: 'New ride offer', body: 'A ride is offered to you. Respond quickly in the app.' },
  },
  'payment.authorization_failed': {
    fr: { title: 'Paiement refusé', body: (d) => `Votre carte a été refusée pour la course${ride(d)}. Choisissez une autre carte ou payez le chauffeur.` },
    en: { title: 'Payment declined', body: (d) => `Your card was declined for ride${ride(d)}. Choose another card or pay the driver.` },
  },
  'payment.balance_due': {
    fr: { title: 'Solde à régler', body: (d, l) => `Le paiement de la course${ride(d)} n'a pas abouti : ${money(d['amountCents'], l)} restent à régler dans l'application.` },
    en: { title: 'Balance due', body: (d, l) => `Payment for ride${ride(d)} did not go through: ${money(d['amountCents'], l)} remain due in the app.` },
  },
  'invoice.issued': {
    fr: { title: 'Votre facture', body: (d) => `La facture ${str(d['number'])} de votre course est disponible.` },
    en: { title: 'Your invoice', body: (d) => `Invoice ${str(d['number'])} for your ride is available.` },
  },
  'statement.issued': {
    fr: { title: 'Relevé hebdomadaire', body: (d, l) => `Votre relevé du ${str(d['periodStart'])} au ${str(d['periodEnd'])} est disponible. Net : ${money(d['netCents'], l)}.` },
    en: { title: 'Weekly statement', body: (d, l) => `Your statement from ${str(d['periodStart'])} to ${str(d['periodEnd'])} is available. Net: ${money(d['netCents'], l)}.` },
  },
  'statement.paid': {
    fr: { title: 'Versement effectué', body: (d, l) => `${money(d['netCents'], l)} ont été versés sur votre compte.` },
    en: { title: 'Payout sent', body: (d, l) => `${money(d['netCents'], l)} have been paid to your account.` },
  },
  'statement.settlement_failed': {
    fr: { title: 'Règlement du relevé en échec', body: (d, l) => (Number(d['netCents']) < 0 ? `Le prélèvement de ${money(-Number(d['netCents']), l)} a échoué. Mettez à jour votre carte de prélèvement.` : 'Le versement de votre relevé a échoué. Vérifiez votre compte de versement.') },
    en: { title: 'Statement settlement failed', body: (d, l) => (Number(d['netCents']) < 0 ? `The debit of ${money(-Number(d['netCents']), l)} failed. Update your debit card.` : 'The payout of your statement failed. Check your payout account.') },
  },
  'balance.suspended': {
    fr: { title: 'Compte suspendu pour solde impayé', body: (d, l) => `Votre solde de ${money(-Number(d['balanceCents']), l)} est impayé : vous ne recevez plus de courses jusqu'au règlement.` },
    en: { title: 'Account suspended for unpaid balance', body: (d, l) => `Your balance of ${money(-Number(d['balanceCents']), l)} is unpaid: you will not receive rides until it is settled.` },
  },
  'balance.reactivated': {
    fr: { title: 'Compte réactivé', body: 'Votre solde est réglé : vous recevez de nouveau des courses.' },
    en: { title: 'Account reactivated', body: 'Your balance is settled: you receive rides again.' },
  },
  'pack.low': {
    fr: { title: 'Pack presque épuisé', body: (d) => `Il vous reste ${str(d['remaining'])} course(s) sur votre pack.` },
    en: { title: 'Pack almost used up', body: (d) => `You have ${str(d['remaining'])} ride(s) left on your pack.` },
  },
  'pack.exhausted': {
    fr: { title: 'Pack épuisé', body: 'Votre pack est épuisé : activez-en un nouveau pour recevoir des courses.' },
    en: { title: 'Pack used up', body: 'Your pack is used up: activate a new one to receive rides.' },
  },
  'pack.renewed': {
    fr: { title: 'Pack renouvelé', body: (d, l) => `Votre pack est renouvelé (${money(d['priceCents'], l)}, facturé au prochain relevé).` },
    en: { title: 'Pack renewed', body: (d, l) => `Your pack has been renewed (${money(d['priceCents'], l)}, billed on your next statement).` },
  },
  'pack.renewal_failed': {
    fr: { title: 'Renouvellement impossible', body: 'Votre pack n\'a pas pu être renouvelé : choisissez un pack dans l\'application.' },
    en: { title: 'Renewal not possible', body: 'Your pack could not be renewed: choose a pack in the app.' },
  },
  'pack.expired': {
    fr: { title: 'Pack expiré', body: (d) => `Votre pack a expiré${Number(d['unusedRides']) > 0 ? ` avec ${str(d['unusedRides'])} course(s) non utilisée(s), reportées si vous activez un pack dans les 7 jours` : ''}.` },
    en: { title: 'Pack expired', body: (d) => `Your pack has expired${Number(d['unusedRides']) > 0 ? ` with ${str(d['unusedRides'])} unused ride(s), carried over if you activate a pack within 7 days` : ''}.` },
  },
  'guarantee.decided': {
    fr: { title: 'Garantie modèle', body: (d, l) => (d['outcome'] === 'validated' ? `Votre demande est acceptée : ${money(d['refundedCents'], l)} vous sont rendus.` : `Votre demande n'est pas retenue : ${str(d['decision'])}`) },
    en: { title: 'Model guarantee', body: (d, l) => (d['outcome'] === 'validated' ? `Your claim is accepted: ${money(d['refundedCents'], l)} is refunded to you.` : `Your claim was not accepted: ${str(d['decision'])}`) },
  },
  'document.expiring': {
    fr: { title: 'Document bientôt expiré', body: (d) => `Votre document (${str(d['type'])}) expire le ${str(d['expiresOn'])}. Téléversez la nouvelle version.` },
    en: { title: 'Document expiring soon', body: (d) => `Your document (${str(d['type'])}) expires on ${str(d['expiresOn'])}. Upload the new version.` },
  },
  'vehicle.inspection_due': {
    fr: { title: 'Inspection du véhicule à prévoir', body: (d) => `${str(d['label']) || 'Inspection'} à faire au plus tard le ${str(d['dueOn'])}. Sans elle, le véhicule ne pourra plus recevoir de courses.` },
    en: { title: 'Vehicle inspection due', body: (d) => `${str(d['label']) || 'Inspection'} due by ${str(d['dueOn'])}. Without it, the vehicle can no longer receive rides.` },
  },
  'compliance.suspended': {
    fr: { title: 'Courses suspendues', body: (d) => `Échéance dépassée (${str(d['label'])}, ${str(d['dueOn'])}) : vous ne recevez plus de courses. Déposez le document à jour ou faites l'inspection : la reprise est automatique après validation.` },
    en: { title: 'Rides suspended', body: (d) => `Deadline passed (${str(d['label'])}, ${str(d['dueOn'])}): you no longer receive rides. Upload the updated document or complete the inspection: you are reinstated automatically once it is approved.` },
  },
  'compliance.reactivated': {
    fr: { title: 'Vous êtes de nouveau en règle', body: (d) => `${str(d['label'])} validé : vous pouvez de nouveau recevoir des courses.` },
    en: { title: 'You are compliant again', body: (d) => `${str(d['label'])} approved: you can receive rides again.` },
  },
  'safety.hold': {
    fr: { title: 'Compte suspendu à titre préventif', body: (d) => `Un signalement de sécurité a été fait sur la course ${str(d['publicNumber'])}. Vous ne recevez plus de courses le temps que l'équipe l'examine ; elle vous contacte rapidement.` },
    en: { title: 'Account suspended as a precaution', body: (d) => `A safety report was made on ride ${str(d['publicNumber'])}. You will not receive rides while the team reviews it; they will contact you shortly.` },
  },
  'safety.lifted': {
    fr: { title: 'Suspension levée', body: () => 'Après examen du signalement, vous pouvez de nouveau recevoir des courses.' },
    en: { title: 'Suspension lifted', body: () => 'After review of the report, you can receive rides again.' },
  },
  'quality.warning': {
    fr: { title: 'Avertissement qualité', body: (d) => `${str(d['reason'])}. Nous comptons sur vous pour remonter la note ; l'équipe reste disponible pour en parler.` },
    en: { title: 'Quality warning', body: (d) => `${str(d['reason'])}. We count on you to bring your rating back up; the team is available to talk about it.` },
  },
  'quality.restriction': {
    fr: { title: 'Courses VIP et aéroport retirées', body: (d) => `${str(d['reason'])}. Vous recevez toujours les autres courses${d['endsAt'] ? ` ; reprise prévue le ${str(d['endsAt']).slice(0, 10)}` : ''}.` },
    en: { title: 'VIP and airport rides removed', body: (d) => `${str(d['reason'])}. You still receive other rides${d['endsAt'] ? `; expected to resume on ${str(d['endsAt']).slice(0, 10)}` : ''}.` },
  },
  'quality.suspension': {
    fr: { title: 'Suspension temporaire', body: (d) => `${str(d['reason'])}. Vous ne recevez plus de courses${d['endsAt'] ? ` jusqu'au ${str(d['endsAt']).slice(0, 10)}` : ''} ; l'équipe vous contacte.` },
    en: { title: 'Temporary suspension', body: (d) => `${str(d['reason'])}. You no longer receive rides${d['endsAt'] ? ` until ${str(d['endsAt']).slice(0, 10)}` : ''}; the team will contact you.` },
  },
  'fairness.appeal_decided': {
    fr: { title: 'Réponse à votre demande', body: (d) => `Après examen par une personne, ${d['decision'] === 'overturned' ? 'la sanction est levée' : 'la sanction est maintenue'} : ${str(d['note'])}` },
    en: { title: 'Answer to your request', body: (d) => `After review by a person, ${d['decision'] === 'overturned' ? 'the sanction is lifted' : 'the sanction is upheld'}: ${str(d['note'])}` },
  },
  'punctuality.compensated': {
    fr: { title: 'Garantie de ponctualité', body: (d, l) => d['refund'] ? `Votre chauffeur est arrivé avec ${str(d['minutesLate'])} minutes de retard : votre course ${str(d['publicNumber'])} vous est remboursée en crédit (${money(d['amountCents'], l)}). Toutes nos excuses.` : `Votre chauffeur est arrivé avec ${str(d['minutesLate'])} minutes de retard : un crédit de ${money(d['amountCents'], l)} vous est offert pour votre prochaine course. Toutes nos excuses.` },
    en: { title: 'Punctuality guarantee', body: (d, l) => d['refund'] ? `Your driver arrived ${str(d['minutesLate'])} minutes late: ride ${str(d['publicNumber'])} is refunded to you as credit (${money(d['amountCents'], l)}). Our apologies.` : `Your driver arrived ${str(d['minutesLate'])} minutes late: a ${money(d['amountCents'], l)} credit is yours for your next ride. Our apologies.` },
  },
  'quality.reinstated': {
    fr: { title: 'Sanction terminée', body: () => 'Votre sanction est terminée : vous recevez de nouveau toutes les courses.' },
    en: { title: 'Sanction ended', body: () => 'Your sanction has ended: you receive all rides again.' },
  },
  'alert.benchmark_exceeded': {
    fr: { title: 'Veille prix : devis au-dessus des concurrents', body: (d) => `${str(d['count'])} devis des dernières 24 heures dépassaient la cible (au moins 1 $ sous le moins cher d'Uber, de Lyft et du taxi) (${Array.isArray(d['categories']) ? (d['categories'] as unknown[]).map(str).join(', ') : ''}). Remise d'alignement appliquée sur les frais de service quand la marge le permettait. Voir My Hub.` },
    en: { title: 'Price watch: quotes above competitors', body: (d) => `${str(d['count'])} quotes in the last 24 hours exceeded the target (at least $1 below the cheapest of Uber, Lyft and taxi) (${Array.isArray(d['categories']) ? (d['categories'] as unknown[]).map(str).join(', ') : ''}). Alignment discount applied on service fees when the margin allowed. See My Hub.` },
  },
  'alert.appeal_received': {
    fr: { title: 'Chauffeur : demande à traiter', body: (d) => `${d['kind'] === 'appeal' ? 'Appel' : 'Réponse'} du chauffeur ${str(d['driverPublicNumber'])} sur une sanction (${str(d['sanctionType'])}). Une personne lui répond sous 4 heures ouvrables (Charte d'équité) ; un appel est tranché par une autre personne que celle qui a décidé. Voir My Hub.` },
    en: { title: 'Driver: request to handle', body: (d) => `${d['kind'] === 'appeal' ? 'Appeal' : 'Response'} from driver ${str(d['driverPublicNumber'])} on a sanction (${str(d['sanctionType'])}). A person answers within 4 business hours (Fairness charter); an appeal is decided by someone other than the original decider. See My Hub.` },
  },
  'alert.appeal_overdue': {
    fr: { title: 'Charte d\'équité : délai dépassé', body: (d) => `${d['kind'] === 'appeal' ? 'L\'appel' : 'La réponse'} du chauffeur ${str(d['driverPublicNumber'])} attend une décision depuis plus de 4 heures ouvrables. Rappelez-le et tranchez dans My Hub.` },
    en: { title: 'Fairness charter: deadline missed', body: (d) => `The ${d['kind'] === 'appeal' ? 'appeal' : 'response'} from driver ${str(d['driverPublicNumber'])} has waited more than 4 business hours for a decision. Call them back and decide in My Hub.` },
  },
  'alert.precautionary_review_overdue': {
    fr: { title: 'Suspension de précaution à réexaminer', body: (d) => `Le chauffeur ${str(d['driverPublicNumber'])} est suspendu à titre préventif depuis ${str(d['hours'])} heures sans décision humaine. La Charte d'équité prévoit un réexamen sous 24 heures : levez ou maintenez le blocage dans My Hub.` },
    en: { title: 'Precautionary suspension to review', body: (d) => `Driver ${str(d['driverPublicNumber'])} has been suspended as a precaution for ${str(d['hours'])} hours without a human decision. The Fairness charter requires a review within 24 hours: lift or keep the hold in My Hub.` },
  },
  'pilot.auto_accepted': {
    fr: { title: 'Course acceptée pour vous par Pilote', body: (d, l) => `Course${ride(d)}${d['requestedAt'] ? ` du ${when(d['requestedAt'], l)}` : ''} acceptée par Neomoov Pilote selon vos critères, annulable sans frais pendant ${str(d['graceSeconds'])} secondes.` },
    en: { title: 'Ride accepted for you by Pilot', body: (d, l) => `Ride${ride(d)}${d['requestedAt'] ? ` on ${when(d['requestedAt'], l)}` : ''} accepted by Neomoov Pilot based on your criteria; you can cancel at no cost for ${str(d['graceSeconds'])} seconds.` },
  },
  'alert.pilot_zone_exclusion': {
    fr: { title: 'Pilote : zone surveillée exclue', body: (d) => `Le chauffeur ${str(d['driverPublicNumber'])} exclut la zone surveillée « ${str(d['zone'])} » de ses critères Neomoov Pilote (${d['origin'] && d['destination'] ? 'départ et arrivée' : d['origin'] ? 'départ' : 'arrivée'}). Surveillance de la discrimination indirecte : voir le rapport des exclusions dans My Hub.` },
    en: { title: 'Pilot: watched zone excluded', body: (d) => `Driver ${str(d['driverPublicNumber'])} excludes the watched zone "${str(d['zone'])}" from their Neomoov Pilot criteria (${d['origin'] && d['destination'] ? 'pickup and drop-off' : d['origin'] ? 'pickup' : 'drop-off'}). Indirect discrimination monitoring: see the exclusions report in My Hub.` },
  },
  // Neomoov Booster (phase 1, agent G) : alertes de la journée du chauffeur et signalement d'une défectuosité majeure au dispatch.
  'booster.inspection': {
    fr: { title: 'Vérification sommaire à effectuer', body: 'Avant votre première course, photographiez votre véhicule et archivez votre rapport de vérification sommaire (article 55).' },
    en: { title: 'Pre-trip inspection to complete', body: 'Before your first ride, photograph your vehicle and file your pre-trip inspection report (section 55).' },
  },
  'booster.session_info': {
    fr: { title: 'Démarrage de session', body: 'Notez votre odomètre et votre autonomie au départ : votre rapport de performance commence ici.' },
    en: { title: 'Session start', body: 'Note your odometer and range at departure: your performance report starts here.' },
  },
  'booster.session_start': {
    fr: { title: 'Début de session', body: 'C\'est l\'heure habituelle de votre début de session. Bonne route.' },
    en: { title: 'Session start', body: 'It is your usual session start time. Safe driving.' },
  },
  'booster.session_end': {
    fr: { title: 'Fin de session', body: 'Complétez votre rapport de performance : odomètre, autonomie et montants de la journée.' },
    en: { title: 'Session end', body: 'Complete your performance report: odometer, range and the day\'s amounts.' },
  },
  'booster.peak_period': {
    fr: { title: 'Période de gain', body: (d) => `${str(d['labelFr']) || 'Forte demande'} : période de gain de ${str(d['from'])} à ${str(d['to'])}.` },
    en: { title: 'Peak period', body: (d) => `${str(d['labelEn']) || 'High demand'}: peak period from ${str(d['from'])} to ${str(d['to'])}.` },
  },
  'booster.peak_zone': {
    fr: { title: 'Zone de gain', body: (d) => `${str(d['labelFr']) || 'Zone'} : forte demande attendue de ${str(d['from'])} à ${str(d['to'])}.` },
    en: { title: 'Peak zone', body: (d) => `${str(d['labelEn']) || 'Zone'}: high demand expected from ${str(d['from'])} to ${str(d['to'])}.` },
  },
  'booster.alert_test': {
    fr: { title: 'Test d\'alerte Booster', body: (d) => `Son et couleur de l'alerte « ${str(d['alertType'])} » bien reçus.` },
    en: { title: 'Booster alert test', body: (d) => `Sound and colour of the "${str(d['alertType'])}" alert received.` },
  },
  'alert.inspection_major': {
    fr: { title: 'Alerte : défectuosité majeure signalée', body: (d) => `Le chauffeur ${str(d['driverName'])} (${str(d['driverPublicNumber'])}) a archivé un rapport de vérification sommaire avec une défectuosité majeure${d['plate'] ? ` (plaque ${str(d['plate'])})` : ''} : ${str(d['items']) || 'voir le rapport'}. Le véhicule ne doit pas être mis en service avant réparation. Consultez le rapport dans My Hub, Inspections.` },
    en: { title: 'Alert: major defect reported', body: (d) => `Driver ${str(d['driverName'])} (${str(d['driverPublicNumber'])}) filed a pre-trip inspection report with a major defect${d['plate'] ? ` (plate ${str(d['plate'])})` : ''}: ${str(d['items']) || 'see the report'}. The vehicle must not be put into service before repair. See the report in My Hub, Inspections.` },
  },
  'alert.stuck_ride': {
    fr: { title: 'Alerte : course figée', body: (d) => `La course${ride(d)} est « ${str(d['state'])} » depuis ${str(d['minutes'])} minutes. Vérifiez-la dans My Hub.` },
    en: { title: 'Alert: stuck ride', body: (d) => `Ride${ride(d)} has been "${str(d['state'])}" for ${str(d['minutes'])} minutes. Check it in My Hub.` },
  },
  'alert.no_driver': {
    fr: { title: 'Alerte : aucun chauffeur', body: (d) => `Aucun chauffeur pour la course${ride(d)}.` },
    en: { title: 'Alert: no driver', body: (d) => `No driver for ride${ride(d)}.` },
  },
  'alert.scheduled_unconfirmed': {
    fr: { title: 'Alerte : réservation non confirmée', body: (d) => `La réservation${ride(d)} n'a pas de chauffeur à 30 minutes du départ.` },
    en: { title: 'Alert: unconfirmed booking', body: (d) => `Booking${ride(d)} has no driver 30 minutes before pickup.` },
  },
  'alert.sos': {
    fr: { title: 'SOS', body: (d) => `Alerte SOS sur la course${ride(d)}. Intervenez immédiatement.` },
    en: { title: 'SOS', body: (d) => `SOS alert on ride${ride(d)}. Act immediately.` },
  },
  'alert.vehicle_mismatch': {
    fr: { title: 'Alerte : véhicule non conforme', body: (d) => `Véhicule différent de celui garanti signalé sur la course${ride(d)}.` },
    en: { title: 'Alert: vehicle mismatch', body: (d) => `Vehicle different from the guaranteed one reported on ride${ride(d)}.` },
  },
  'alert.settlement_failed': {
    fr: { title: 'Alerte : règlement en échec', body: (d, l) => `Le règlement d'un relevé a échoué (${money(d['netCents'], l)}).` },
    en: { title: 'Alert: settlement failed', body: (d, l) => `A statement settlement failed (${money(d['netCents'], l)}).` },
  },
  // Revue du 2 octobre 2026 (constat 7) : prestataire sans réponse ; rien n'est retenté avant la réconciliation par les finances.
  'alert.settlement_unknown': {
    fr: { title: 'Alerte : règlement sans réponse du prestataire', body: (d, l) => `Le règlement d'un relevé (${money(d['netCents'], l)}) est resté sans réponse du prestataire de paiement : réconciliez-le dans My Hub avant toute nouvelle tentative.` },
    en: { title: 'Alert: settlement outcome unknown', body: (d, l) => `A statement settlement (${money(d['netCents'], l)}) got no answer from the payment provider: reconcile it in My Hub before any retry.` },
  },
  // Agents IA (étape 13) : réponse de l'assistance au client (texte rédigé par l'agent ou accusé de réception), rapport au
  // fondateur, alertes de l'exploitation (conversation escaladée, plafond de dépense atteint).
  'agent.reply': {
    fr: { title: 'Assistance Neomoov', body: (d) => str(d['text']) || 'Vous avez une réponse de l\'assistance Neomoov.' },
    en: { title: 'Neomoov support', body: (d) => str(d['text']) || 'You have a reply from Neomoov support.' },
  },
  'agent.report': {
    fr: { title: (d) => str(d['title']) || 'Rapport Neomoov', body: (d) => str(d['text']) || 'Le rapport est disponible dans My Hub.' },
    en: { title: (d) => str(d['title']) || 'Neomoov report', body: (d) => str(d['text']) || 'The report is available in My Hub.' },
  },
  'alert.agent_escalation': {
    fr: { title: 'Conversation à reprendre', body: (d) => `L'agent relation client transmet une conversation (${str(d['reason']) || 'escalade'}) : ${str(d['summary'])}` },
    en: { title: 'Conversation to take over', body: (d) => `The customer relations agent handed over a conversation (${str(d['reason']) || 'escalation'}): ${str(d['summary'])}` },
  },
  'alert.client_cancellations': {
    fr: { title: 'Annulations répétées d\'un client', body: (d) => `${str(d['clientName']) || 'Un client'}${d['clientPhone'] ? ` (${str(d['clientPhone'])})` : ''} a ${str(d['cancelled'])} annulation(s) et ${str(d['noShows'])} absence(s) sur ${str(d['days'])} jours, dernière course ${str(d['lastPublicNumber'])}. À examiner dans My Hub.` },
    en: { title: 'Repeated client cancellations', body: (d) => `${str(d['clientName']) || 'A client'}${d['clientPhone'] ? ` (${str(d['clientPhone'])})` : ''} has ${str(d['cancelled'])} cancellation(s) and ${str(d['noShows'])} no-show(s) in ${str(d['days'])} days, last ride ${str(d['lastPublicNumber'])}. Review in My Hub.` },
  },
  'alert.agent_budget': {
    fr: { title: 'Agent IA en mode manuel', body: (d) => `Plafond quotidien de dépense atteint : l'agent ${str(d['agentCode'])} passe en mode manuel.` },
    en: { title: 'AI agent switched to manual', body: (d) => `Daily spending cap reached: agent ${str(d['agentCode'])} is now in manual mode.` },
  },
  // Boîte unifiée (phase 1 autonome) : appel manqué toujours sans suite après le délai de rappel.
  'alert.callback_due': {
    fr: { title: 'Rappel à faire : appel manqué', body: (d) => `L'appel manqué de ${str(d['phone']) || 'un numéro masqué'} (${str(d['minutes'])} minutes) n'a pas encore été rappelé : ${str(d['summary']) || 'aucun résumé'}. Rappelez la personne puis terminez la conversation dans My Hub, Boîte de réception.` },
    en: { title: 'Callback due: missed call', body: (d) => `The missed call from ${str(d['phone']) || 'a hidden number'} (${str(d['minutes'])} minutes) has not been called back yet: ${str(d['summary']) || 'no summary'}. Call the person back, then close the conversation in My Hub, Inbox.` },
  },
  // My Hub côté organisation (étape 21) : invitation d'un membre (texto ou courriel, lien à usage unique) et demande
  // d'accès du support de la plateforme, envoyée aux propriétaires du compte.
  'organization.invitation': {
    fr: { title: (d) => `Invitation à rejoindre ${str(d['organizationName']) || 'une organisation'}`, body: (d, l) => `Vous êtes invité à rejoindre ${str(d['organizationName']) || 'une organisation'} sur Neomoov${d['roleName'] ? ` comme ${str(d['roleName'])}` : ''}. Acceptez avec ce lien, valable jusqu'au ${when(d['expiresAt'], l)} : ${str(d['url'])}` },
    en: { title: (d) => `Invitation to join ${str(d['organizationName']) || 'an organization'}`, body: (d, l) => `You are invited to join ${str(d['organizationName']) || 'an organization'} on Neomoov${d['roleName'] ? ` as ${str(d['roleName'])}` : ''}. Accept with this link, valid until ${when(d['expiresAt'], l)}: ${str(d['url'])}` },
  },
  'organization.support_access_requested': {
    fr: { title: 'Demande d\'accès du support Neomoov', body: (d) => `Le support Neomoov demande un accès de ${str(d['durationMinutes'])} minutes à ${str(d['organizationName']) || 'votre organisation'} (motif : ${str(d['reason'])}). Approuvez ou refusez dans My Hub, menu Accès du support.` },
    en: { title: 'Neomoov support access request', body: (d) => `Neomoov support requests ${str(d['durationMinutes'])} minutes of access to ${str(d['organizationName']) || 'your organization'} (reason: ${str(d['reason'])}). Approve or deny in My Hub, Support access menu.` },
  },
  // Facturation de la plateforme (étape 25) : avis au propriétaire du compte de l'organisation.
  ...BILLING_TEMPLATES,
};

const GENERIC: Template = {
  fr: { title: 'Neomoov', body: 'Vous avez une nouvelle notification dans l\'application.' },
  en: { title: 'Neomoov', body: 'You have a new notification in the app.' },
};

export function hasTemplate(code: string): boolean {
  return code in TEMPLATES;
}

export const TEMPLATE_CODES = Object.keys(TEMPLATES);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Marque d'un courriel ou d'un texto (étape 22) : nom commercial et coordonnées de l'assistance. */
export interface NotificationBrand {
  name: string;
  support?: { phone: string | null; email: string | null };
}

/**
 * Rend un gabarit ; la langue vient du destinataire (`fr` par défaut). Avec la marque d'une organisation (étape 22,
 * courriels et textos seulement) : son nom remplace « Neomoov » dans le titre, le texte et l'objet, et le pied du
 * courriel dit « propulsé par Neomoov » ; les coordonnées de l'assistance de la marque y sont ajoutées.
 */
export function renderNotification(code: string, data: Data, language: string | null | undefined, brand?: NotificationBrand): RenderedNotification {
  const l: TemplateLanguage = language === 'en' ? 'en' : 'fr';
  const template = (TEMPLATES[code] ?? GENERIC)[l];
  const brandName = brand?.name && brand.name !== 'Neomoov' ? brand.name : null;
  const branded = (text: string) => (brandName ? text.replaceAll('Neomoov', brandName) : text);
  const title = branded(typeof template.title === 'function' ? template.title(data, l) : template.title);
  const body = branded(typeof template.body === 'function' ? template.body(data, l) : template.body);
  const footer = brandName
    ? (l === 'en' ? `${brandName}, powered by Neomoov.` : `${brandName}, propulsé par Neomoov.`)
    : (l === 'en' ? 'Neomoov, an app designed by customers for drivers.' : 'Neomoov, une application conçue par le client pour les chauffeurs.');
  const contacts = [brand?.support?.phone, brand?.support?.email].filter((v): v is string => Boolean(v));
  const support = contacts.length ? `${l === 'en' ? 'Support' : 'Assistance'} : ${contacts.join(' · ')}` : null;
  const html = `<!doctype html><html lang="${l === 'en' ? 'en' : 'fr-CA'}"><body style="font-family:Arial,Helvetica,sans-serif;color:#0B1F3A;max-width:560px;margin:auto;padding:24px">`
    + `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1><p style="font-size:15px;line-height:1.5;white-space:pre-line">${escapeHtml(body)}</p>`
    + `<p style="font-size:12px;color:#555;margin-top:32px">${escapeHtml(footer)}${support ? `<br>${escapeHtml(support)}` : ''}</p></body></html>`;
  const deepLink: Record<string, string> = { template: code };
  for (const key of ['rideId', 'offerId', 'statementId', 'invoiceId', 'alertType', 'channelId', 'sound', 'color', 'inspectionId']) if (typeof data[key] === 'string') deepLink[key] = data[key] as string;
  // Écran nommé de l'application chauffeur quand la notification ne porte pas d'identifiant (packs, documents, planifiées).
  const screen = code.startsWith('pack.') ? 'packs' : code.startsWith('document.') || code.startsWith('compliance.') || code.startsWith('vehicle.') ? 'documents' : code === 'ride.scheduled_confirmed_driver' ? 'scheduled'
    // Neomoov Booster : la vérification sommaire, le rapport de performance (fin et informations de session), sinon l'accueil Booster.
    : code === 'booster.inspection' ? 'booster-inspection' : code === 'booster.session_end' || code === 'booster.session_info' ? 'booster-performance' : code.startsWith('booster.') ? 'booster' : null;
  if (screen) deepLink['screen'] = screen;
  return { title, body, subject: `${title} · ${brandName ?? 'Neomoov'}`, html, deepLink };
}
