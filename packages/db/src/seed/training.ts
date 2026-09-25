/**
 * Formation Neomoov des chauffeurs (prompt 11, écran Formation) : réglage `training.modules`. Version de travail à
 * valider par le fondateur ; les vidéos (`videoUrl`) sont à produire, le résumé tient lieu de contenu en attendant.
 * Les bonnes réponses (`answerIndex`) restent dans l'API et ne sont jamais envoyées à l'application.
 */
export const TRAINING_MODULES = [
  {
    code: 'service',
    title: { fr: "Le service Neomoov", en: 'The Neomoov service' },
    summary: {
      fr: "Neomoov est un service de réservation haut de gamme : chaque course est réservée au moins 2 heures à l'avance, le prix est connu et accepté avant la course. Accueillez le client par son nom, proposez l'aide aux bagages, respectez ses préférences (conversation, musique, température) affichées sur la fiche de course. L'eau, les chargeurs et le parapluie sont inclus dans tous les véhicules. Soyez sur place à l'heure : la ponctualité compte dans votre tableau de conduite.",
      en: 'Neomoov is a premium booking service: every ride is booked at least 2 hours ahead and the price is known and accepted before the ride. Greet the client by name, offer help with luggage and respect the preferences shown on the ride card (conversation, music, temperature). Water, chargers and an umbrella are included in every vehicle. Be on site on time: punctuality counts in your driving dashboard.',
    },
    videoUrl: null,
    durationMinutes: 8,
    questions: [
      { id: 'service-1', prompt: { fr: 'Où trouvez-vous les préférences du client ?', en: "Where do you find the client's preferences?" }, choices: [{ fr: 'Je lui demande en route', en: 'I ask during the ride' }, { fr: 'Sur la fiche de course dans l\'application', en: 'On the ride card in the app' }, { fr: 'Elles ne sont pas transmises', en: 'They are not shared' }], answerIndex: 1 },
      { id: 'service-2', prompt: { fr: 'Quelles commodités sont incluses dans tous les véhicules ?', en: 'Which amenities are included in every vehicle?' }, choices: [{ fr: 'Eau, chargeurs, parapluie', en: 'Water, chargers, umbrella' }, { fr: 'Aucune', en: 'None' }, { fr: 'Seulement le Wi-Fi', en: 'Only Wi-Fi' }], answerIndex: 0 },
      { id: 'service-3', prompt: { fr: 'Le prix de la course peut-il être renégocié avec le client dans le véhicule ?', en: 'Can the fare be renegotiated with the client in the vehicle?' }, choices: [{ fr: 'Oui, en espèces', en: 'Yes, in cash' }, { fr: 'Non, le prix est fixé à la réservation', en: 'No, the price is set at booking' }], answerIndex: 1 },
    ],
  },
  {
    code: 'safety',
    title: { fr: 'Sécurité', en: 'Safety' },
    summary: {
      fr: "Conduisez en souplesse : les accélérations et freinages brusques sont mesurés à partir des positions et apparaissent dans votre tableau de conduite. En cas de danger, le bouton SOS alerte immédiatement l'équipe Neomoov. Tout incident (accident, dommage, comportement) se signale depuis la course. Un siège d'enfant n'est installé que s'il a été demandé et que vous l'avez déclaré.",
      en: 'Drive smoothly: harsh acceleration and braking are measured from your positions and appear in your driving dashboard. In danger, the SOS button alerts the Neomoov team immediately. Any incident (accident, damage, behaviour) is reported from the ride. A child seat is installed only when requested and declared by you.',
    },
    videoUrl: null,
    durationMinutes: 6,
    questions: [
      { id: 'safety-1', prompt: { fr: 'Que fait le bouton SOS ?', en: 'What does the SOS button do?' }, choices: [{ fr: 'Il appelle le client', en: 'It calls the client' }, { fr: "Il alerte immédiatement l'équipe Neomoov", en: 'It alerts the Neomoov team immediately' }, { fr: 'Il annule la course', en: 'It cancels the ride' }], answerIndex: 1 },
      { id: 'safety-2', prompt: { fr: 'Comment votre conduite est-elle mesurée ?', en: 'How is your driving measured?' }, choices: [{ fr: 'À partir des positions envoyées en ligne', en: 'From the positions sent while online' }, { fr: 'Par une caméra', en: 'By a camera' }, { fr: "Elle n'est pas mesurée", en: 'It is not measured' }], answerIndex: 0 },
    ],
  },
  {
    code: 'app',
    title: { fr: "L'application chauffeur", en: 'The driver app' },
    summary: {
      fr: "Passez en ligne d'un geste quand vos documents, votre véhicule et votre formation sont en règle. Une offre dure 15 secondes : acceptez ou déclinez. Pendant la conduite, vous n'appuyez que sur un bouton par étape (en route, arrivé, client à bord, terminé). La navigation s'ouvre dans Google Maps ou Waze. Hors ligne, aucune position n'est envoyée. En paiement direct (espèces, Interac, terminal), confirmez le montant reçu à la fin de la course.",
      en: 'Go online in one tap once your documents, vehicle and training are in order. An offer lasts 15 seconds: accept or decline. While driving you only press one button per step (en route, arrived, client on board, completed). Navigation opens in Google Maps or Waze. Offline, no position is sent. With direct payment (cash, Interac, terminal), confirm the amount received at the end of the ride.',
    },
    videoUrl: null,
    durationMinutes: 7,
    questions: [
      { id: 'app-1', prompt: { fr: 'Combien de temps dure une offre de course ?', en: 'How long does a ride offer last?' }, choices: [{ fr: '5 secondes', en: '5 seconds' }, { fr: '15 secondes', en: '15 seconds' }, { fr: '2 minutes', en: '2 minutes' }], answerIndex: 1 },
      { id: 'app-2', prompt: { fr: 'Votre position est-elle envoyée quand vous êtes hors ligne ?', en: 'Is your position sent while you are offline?' }, choices: [{ fr: 'Oui, toujours', en: 'Yes, always' }, { fr: 'Non, jamais', en: 'No, never' }], answerIndex: 1 },
      { id: 'app-3', prompt: { fr: 'Que faites-vous à la fin d\'une course payée en espèces ?', en: 'What do you do at the end of a cash ride?' }, choices: [{ fr: 'Je confirme le montant reçu', en: 'I confirm the amount received' }, { fr: 'Rien', en: 'Nothing' }, { fr: "J'envoie un texto au client", en: 'I text the client' }], answerIndex: 0 },
    ],
  },
  {
    code: 'rules',
    title: { fr: 'Règles, documents et confidentialité', en: 'Rules, documents and privacy' },
    summary: {
      fr: "Vos documents (permis, assurance, immatriculation, vérification mécanique, antécédents) ont des échéances : vous recevez des rappels 30, 7 et 1 jour avant. À l'échéance, votre compte est suspendu jusqu'au dépôt du nouveau document. La note minimale à maintenir est 4,60. Les données des clients sont confidentielles (Loi 25) : ne notez ni ne partagez leurs numéros, adresses ou conversations.",
      en: 'Your documents (licence, insurance, registration, mechanical inspection, background check) expire: you get reminders 30, 7 and 1 day before. On the expiry date your account is suspended until the new document is uploaded. The minimum rating to maintain is 4.60. Client data is confidential (Quebec Law 25): never write down or share their numbers, addresses or conversations.',
    },
    videoUrl: null,
    durationMinutes: 6,
    questions: [
      { id: 'rules-1', prompt: { fr: "Que se passe-t-il à l'échéance d'un document ?", en: 'What happens when a document expires?' }, choices: [{ fr: 'Rien', en: 'Nothing' }, { fr: 'Suspension jusqu\'au dépôt du nouveau document', en: 'Suspension until the new document is uploaded' }, { fr: 'Une amende', en: 'A fine' }], answerIndex: 1 },
      { id: 'rules-2', prompt: { fr: 'Quelle note minimale devez-vous maintenir ?', en: 'What minimum rating must you maintain?' }, choices: [{ fr: '4,00', en: '4.00' }, { fr: '4,60', en: '4.60' }, { fr: '5,00', en: '5.00' }], answerIndex: 1 },
      { id: 'rules-3', prompt: { fr: 'Pouvez-vous garder le numéro d\'un client pour le recontacter ?', en: "Can you keep a client's number to contact them later?" }, choices: [{ fr: 'Oui', en: 'Yes' }, { fr: 'Non, les échanges passent par l\'application', en: 'No, contact goes through the app' }], answerIndex: 1 },
    ],
  },
] as const;
