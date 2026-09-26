/**
 * Gabarits des notifications (section 5.14), en français (FR-CA) et en anglais : titre et texte (push, texto,
 * WhatsApp), objet et corps HTML (courriel). Fonctions pures, testées ; un gabarit inconnu donne un texte générique
 * plutôt qu'une erreur (une notification n'est jamais perdue pour un libellé manquant).
 */
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
  'ride.message_sms': {
    fr: { title: 'Message de votre chauffeur', body: (d) => `Message de votre chauffeur${ride(d)} : « ${str(d['body'])} ». Répondez à ce texto pour lui écrire.` },
    en: { title: 'Message from your driver', body: (d) => `Message from your driver${ride(d)}: "${str(d['body'])}". Reply to this text to write back.` },
  },
  'ride.passenger_tracking': {
    fr: { title: 'Votre course Neomoov', body: (d) => `${str(d['passengerName']) ? `${str(d['passengerName'])}, une` : 'Une'} course Neomoov a été réservée pour vous. Suivi : ${str(d['trackingUrl'])}` },
    en: { title: 'Your Neomoov ride', body: (d) => `${str(d['passengerName']) ? `${str(d['passengerName'])}, a` : 'A'} Neomoov ride was booked for you. Tracking: ${str(d['trackingUrl'])}` },
  },
  'ride.removed_no_movement': {
    fr: { title: 'Course retirée', body: 'Aucun déplacement vers le client : la course vous a été retirée.' },
    en: { title: 'Ride removed', body: 'No movement towards the customer: the ride has been removed from you.' },
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

/** Rend un gabarit ; la langue vient du destinataire (`fr` par défaut). */
export function renderNotification(code: string, data: Data, language: string | null | undefined): RenderedNotification {
  const l: TemplateLanguage = language === 'en' ? 'en' : 'fr';
  const template = (TEMPLATES[code] ?? GENERIC)[l];
  const title = typeof template.title === 'function' ? template.title(data, l) : template.title;
  const body = typeof template.body === 'function' ? template.body(data, l) : template.body;
  const footer = l === 'en' ? 'Neomoov, an app designed by customers for drivers.' : 'Neomoov, une application conçue par le client pour les chauffeurs.';
  const html = `<!doctype html><html lang="${l === 'en' ? 'en' : 'fr-CA'}"><body style="font-family:Arial,Helvetica,sans-serif;color:#0B1F3A;max-width:560px;margin:auto;padding:24px">`
    + `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1><p style="font-size:15px;line-height:1.5">${escapeHtml(body)}</p>`
    + `<p style="font-size:12px;color:#555;margin-top:32px">${escapeHtml(footer)}</p></body></html>`;
  const deepLink: Record<string, string> = { template: code };
  for (const key of ['rideId', 'offerId', 'statementId', 'invoiceId']) if (typeof data[key] === 'string') deepLink[key] = data[key] as string;
  return { title, body, subject: `${title} · Neomoov`, html, deepLink };
}
