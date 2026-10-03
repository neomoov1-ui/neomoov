/**
 * Lot 1 (P01 à P10) des 50 publications de lancement. Forme courte, convertie par scripts/construire-publications.mjs :
 * jour (0 = premier jour de la période), thème, sujet, photo réelle [sujet, indication], appel à l'action, sensible
 * (motif d'approbation humaine), titres d'image par espace (img), blogue facultatif, puis fb [corps, mots-clics],
 * ig [légende, mots-clics], li [français, anglais, mots-clics], x [français, anglais, mots-clics],
 * tt et sc [séquences, légende, mots-clics], yt [titre, séquences, description, mots-clics], tg et wa (texte).
 * Faits tirés des lignes éditoriales v1.1, des pages publiques de neomoov.net et de l'Academy, rien d'autre.
 */
export default [
  {
    n: 1, jour: 0, theme: 'lancement', sujet: 'Neomoov arrive à Montréal', cta: 'reserve',
    photo: ['ville', 'Photo réelle du centre-ville de Montréal au lever du jour, vue depuis le belvédère du mont Royal (médiathèque, crédit indiqué).'],
    img: { site_blog: 'Neomoov arrive à Montréal', facebook: 'Bienvenue à bord', instagram: 'Montréal, en électrique', linkedin: 'Un nouveau service à Montréal', x: 'Neomoov est lancé', tiktok: 'Voici Neomoov', snapchat: 'Nouveau à Montréal', youtube: 'Le lancement en vidéo', telegram: 'Le premier jour', whatsapp_channel: 'Neomoov démarre' },
    blog: {
      titre: 'Neomoov arrive à Montréal : avancez vers demain',
      extrait: 'Neomoov lance à Montréal un service de transport de personnes en véhicules 100 % électriques, au prix tout compris affiché avant de confirmer.',
      corps: `Montréal compte un nouveau service de transport de personnes. Neomoov, marque du Groupe NSK inc., entreprise montréalaise, propose des courses en ville et vers l'aéroport Montréal-Trudeau en véhicules 100 % électriques récents, avec des chauffeurs professionnels vérifiés. Notre signature tient en trois mots : « Avancez vers demain. »

Dans cet article, nous vous présentons ce qui fait Neomoov, ce que vous pouvez attendre de chaque course et la façon de réserver dès maintenant.

## Une idée simple : un trajet juste, sans surprise

Neomoov est né d'une conviction : le transport de personnes peut être à la fois juste pour le client, juste pour le chauffeur et respectueux de la ville. Notre fondateur cumule plus de vingt ans en création et en gestion d'entreprise et plus de dix ans d'expérience du transport de personnes, au Canada et en Afrique de l'Ouest. Cette double expérience a fixé nos règles de service, et nous les appliquons à chaque course.

Nous résumons souvent notre démarche par une phrase : Neomoov est une application conçue par le client pour les chauffeurs. Ce que vous attendez d'un trajet, nous l'avons placé au centre ; ce dont un chauffeur a besoin pour bien vous servir, nous l'avons placé dans ses outils.

## Un prix tout compris, affiché avant de confirmer

Avec Neomoov, vous connaissez le prix total avant de confirmer votre course. Il comprend le tarif du chauffeur, les frais de service, les péages, la redevance et les taxes. Il est calculé avec le trafic prévu à l'heure de votre départ et ne change plus une fois confirmé, même si la circulation est dense ou si l'itinéraire change. Aucune majoration liée à la demande.

Pour l'aéroport, le forfait Neo Premium depuis le centre-ville de Montréal est de 48,20 $, taxes comprises.

## Des véhicules 100 % électriques, en trois catégories

Toute notre flotte est électrique. Les véhicules ont cinq ans ou moins et sont inspectés à l'inscription, puis chaque trimestre. Vous choisissez votre catégorie :

- Neo Premium : berline ou VUS électrique récent, quatre places, pour vos déplacements de tous les jours ;
- Neo Prestige : haut de gamme, intérieur cuir, silence à bord, pour les rendez-vous qui comptent ;
- Neo XL : jusqu'à six passagers et leurs bagages, pour les familles, les groupes et l'aéroport.

Le véhicule réservé est celui qui arrive : c'est une garantie, pas une intention.

## Des chauffeurs professionnels vérifiés

Avant leur première course, nos chauffeurs passent un contrôle complet : permis, antécédents judiciaires, assurance et formation Neomoov. Ces vérifications sont renouvelées à chaque échéance. Pendant la course, vous suivez le trajet en direct et vous pouvez le partager avec un proche par un simple lien.

## Réserver au moins 2 heures à l'avance

Chez Neomoov, chaque course se réserve au moins 2 heures à l'avance, et jusqu'à 90 jours. Ce délai nous permet de vous confirmer un chauffeur et le véhicule que vous avez choisi, plutôt que de vous envoyer le premier véhicule disponible.

Vous pouvez réserver :

- sur neomoov.net/reserver, sans créer de compte ;
- par WhatsApp, au +1 438 900 4990 ;
- dans l'application Neomoov.

Vous pouvez aussi nous appeler ou nous écrire par texto au +1 438 900 4990 ou au +1 438 805-7974.

## Les commodités de votre choix

Dans tous nos véhicules, vous trouvez de l'eau, des chargeurs, le Wi-Fi et un parapluie à disposition. À la réservation, vous indiquez vos préférences : silence ou discussion, musique, température, langue du chauffeur, aide aux bagages. Un siège d'enfant est disponible sur demande, et votre animal de compagnie peut voyager en cage à bord des catégories Neo XL et Neo Prestige.

## Payer comme vous le souhaitez

Vous payez par carte dans l'application ou directement au chauffeur, à la fin de la course. Un reçu et une facture vous sont envoyés par courriel.

## Pour les entreprises et les chauffeurs

Les entreprises peuvent ouvrir un compte pour leurs équipes, leurs clients et leurs invités, avec une facturation mensuelle. Les chauffeurs professionnels qui partagent nos exigences peuvent poser leur candidature sur neomoov.net/chauffeurs/#candidature.

## Avancez vers demain

Neomoov commence à Montréal, avec une ambition claire : offrir à chaque passager un trajet sûr et sans surprise. Nous serons heureux de vous accueillir à bord.

Réservez votre prochaine course au moins 2 heures à l'avance : https://neomoov.net/reserver`,
    },
    fb: [`Neomoov arrive à Montréal.

Un nouveau service de transport de personnes, en véhicules 100 % électriques récents, avec des chauffeurs professionnels vérifiés. Le prix tout compris s'affiche avant que vous confirmiez, et il ne change plus.

Réservez au moins 2 heures à l'avance, jusqu'à 90 jours, sur notre site ou par WhatsApp au +1 438 900 4990.

Avancez vers demain.`, ['#Neomoov', '#Montréal']],
    ig: [`Neomoov arrive à Montréal ⚡

Des véhicules 100 % électriques récents, des chauffeurs professionnels vérifiés et un prix tout compris affiché avant de confirmer.

Réservez au moins 2 heures à l'avance : lien dans la bio, ou par WhatsApp au +1 438 900 4990.

Avancez vers demain.`, ['#Neomoov', '#Montréal', '#MTL', '#VéhiculeÉlectrique', '#MobilitéDurable', '#TransportDePersonnes', '#Québec']],
    li: [`Neomoov est lancé à Montréal.

Marque du Groupe NSK inc., Neomoov propose un service de transport de personnes en véhicules 100 % électriques récents, avec des chauffeurs professionnels vérifiés. Nos principes :
• un prix tout compris affiché avant de confirmer, qui ne change plus ;
• une réservation au moins 2 heures à l'avance, pour confirmer le chauffeur et le véhicule choisis ;
• un suivi de la course en direct et une facture certifiée par courriel.

Entreprises, hôtels, cliniques, organisateurs d'événements : parlons de vos déplacements.

Avancez vers demain.`, `Neomoov is now live in Montréal. A Groupe NSK inc. brand, Neomoov offers passenger transportation in recent 100% electric vehicles, with vetted professional drivers: an all-inclusive price shown before you confirm, bookings at least 2 hours ahead, live trip tracking and certified invoices by email.

Businesses, hotels, clinics and event organizers: let's talk about your travel needs.`, ['#Neomoov', '#Montréal', '#MobilitéDurable']],
    x: [`Neomoov arrive à Montréal : véhicules 100 % électriques, chauffeurs vérifiés, prix tout compris affiché avant de confirmer. Réservez au moins 2 h à l'avance. Avancez vers demain.`, `Neomoov is now live in Montréal: 100% electric vehicles, vetted drivers and an all-inclusive price shown before you confirm. Book at least 2 hours ahead.`, ['#Montréal'], ['#Montreal']],
    tt: [[`Montréal, voici Neomoov.`, `Des véhicules 100 % électriques récents.`, `Des chauffeurs professionnels vérifiés.`, `Le prix tout compris, affiché avant de confirmer.`, `Réservez au moins 2 heures à l'avance. Avancez vers demain.`], `Neomoov arrive à Montréal ⚡ Réservez sur neomoov.net/reserver ou par WhatsApp au +1 438 900 4990.`, ['#Neomoov', '#Montréal', '#MTL', '#VoitureÉlectrique']],
    sc: [[`Nouveau à Montréal : Neomoov.`, `100 % électrique.`, `Le prix connu avant de confirmer.`], `Neomoov arrive à Montréal ⚡ Réservez 2 h à l'avance sur neomoov.net/reserver`, ['#Neomoov', '#Montréal']],
    yt: [`Neomoov arrive à Montréal | Avancez vers demain`, [`Montréal, voici Neomoov.`, `Des véhicules 100 % électriques récents et des chauffeurs professionnels vérifiés.`, `Le prix tout compris s'affiche avant que vous confirmiez.`, `Réservez au moins 2 heures à l'avance, jusqu'à 90 jours.`], `Neomoov est un service de transport de personnes à Montréal et vers l'aéroport Montréal-Trudeau, en véhicules 100 % électriques récents, avec des chauffeurs professionnels vérifiés. Le prix tout compris s'affiche avant que vous confirmiez. Réservez au moins 2 heures à l'avance, jusqu'à 90 jours.`, ['#Neomoov', '#Montréal', '#Shorts']],
    tg: `Neomoov arrive à Montréal. Véhicules 100 % électriques, chauffeurs vérifiés, prix tout compris affiché avant de confirmer. Réservez au moins 2 heures à l'avance :`,
    wa: `Bonjour ! Neomoov est lancé à Montréal. Réservez votre course au moins 2 heures à l'avance, en ligne ou par message WhatsApp au +1 438 900 4990. Le prix tout compris s'affiche avant de confirmer.`,
  },
  {
    n: 2, jour: 0, theme: 'lancement', sujet: 'La signature « Avancez vers demain. »', cta: 'reserve',
    photo: ['vehicule', 'Photo réelle d\'un véhicule électrique récent de catégorie Neo Premium dans une rue du Vieux-Montréal, en lumière de fin de journée (médiathèque, crédit indiqué).'],
    img: { facebook: 'Notre signature', instagram: 'Avancez vers demain.', linkedin: 'Trois mots, un engagement', x: 'Une promesse simple', tiktok: 'Une signature en vidéo', snapchat: 'Trois mots', youtube: 'La signature Neomoov', telegram: 'Notre promesse', whatsapp_channel: 'Votre trajet, demain' },
    fb: [`Avancez vers demain.

C'est notre signature, et c'est une promesse simple : des trajets plus sereins, en véhicule 100 % électrique, avec un prix tout compris connu avant de confirmer.

Où irez-vous en premier avec Neomoov ?`, ['#Neomoov']],
    ig: [`Avancez vers demain. 🚗

Notre signature dit l'essentiel : un trajet serein, un véhicule 100 % électrique, un chauffeur vérifié et un prix connu avant de confirmer.

Réservez au moins 2 heures à l'avance, lien dans la bio.`, ['#Neomoov', '#AvancezVersDemain', '#Montréal', '#MTL', '#MobilitéÉlectrique', '#VéhiculeÉlectrique']],
    li: [`« Avancez vers demain. »

Notre signature résume notre engagement : faire du transport de personnes à Montréal une expérience plus juste pour le client, plus juste pour le chauffeur et plus respectueuse de la ville. Concrètement : des véhicules 100 % électriques, des chauffeurs vérifiés et un prix tout compris affiché avant de confirmer.`, `Our signature, « Avancez vers demain. », sums up our commitment: passenger transportation in Montréal that is fairer for riders, fairer for drivers and kinder to the city. In practice: 100% electric vehicles, vetted drivers and an all-inclusive price shown before you confirm.`, ['#Neomoov', '#Montréal', '#MobilitéDurable']],
    x: [`« Avancez vers demain. » Notre signature, notre engagement : un trajet serein, 100 % électrique, à un prix tout compris connu avant de confirmer.`, `Our signature, « Avancez vers demain. », says it all: a calm ride, 100% electric, at an all-inclusive price you know before you confirm.`, ['#Neomoov']],
    tt: [[`Trois mots, une promesse.`, `Avancez : un véhicule 100 % électrique vous attend.`, `Vers : un chauffeur vérifié, un trajet suivi en direct.`, `Demain : un prix connu avant de confirmer.`], `Avancez vers demain. 🚗 Réservez au moins 2 h à l'avance : lien dans la bio.`, ['#Neomoov', '#AvancezVersDemain', '#Montréal']],
    sc: [[`Avancez`, `vers`, `demain.`], `Notre signature, notre promesse 🚗 neomoov.net/reserver`, ['#Neomoov', '#Montréal']],
    yt: [`Avancez vers demain : la signature de Neomoov`, [`Neomoov, c'est une signature : Avancez vers demain.`, `Des véhicules 100 % électriques récents.`, `Des chauffeurs vérifiés et un trajet suivi en direct.`, `Un prix tout compris, connu avant de confirmer.`], `Avancez vers demain. C'est la signature de Neomoov, service de transport de personnes à Montréal en véhicules 100 % électriques. Réservez au moins 2 heures à l'avance.`, ['#Neomoov', '#Montréal', '#Shorts']],
    tg: `Avancez vers demain. C'est la signature de Neomoov : véhicules 100 % électriques, chauffeurs vérifiés, prix tout compris connu avant de confirmer.`,
    wa: `Avancez vers demain. Notre signature, et notre promesse pour chacun de vos trajets à Montréal. Réservez au moins 2 heures à l'avance :`,
  },
  {
    n: 3, jour: 1, theme: 'aeroport', sujet: 'Forfait aéroport Neo Premium depuis le centre-ville', cta: 'reserve',
    sensible: 'Prix publié (48,20 $) : sujet « argent », approbation humaine prévue par les lignes éditoriales.',
    photo: ['aeroport', 'Photo réelle du débarcadère des départs de l\'aéroport Montréal-Trudeau, sans personne identifiable (médiathèque, crédit indiqué).'],
    img: { facebook: 'Votre prix pour YUL', instagram: 'Direction l\'aéroport', linkedin: 'Voyages d\'affaires vers YUL', x: 'Forfait aéroport', tiktok: 'Bientôt dans les airs ?', snapchat: 'Cap sur YUL', youtube: '48,20 $ depuis le centre-ville', telegram: 'Montréal-Trudeau, prix fixe', whatsapp_channel: 'Avant votre vol' },
    fb: [`Aéroport Montréal-Trudeau : connaissez votre prix avant de partir.

Le forfait Neo Premium depuis le centre-ville est de 48,20 $, taxes comprises. Réservez avec votre numéro de vol, au moins 2 heures à l'avance et jusqu'à 90 jours : votre chauffeur est confirmé la veille.

Bon voyage !`, ['#YUL']],
    ig: [`Direction YUL ✈️

Depuis le centre-ville de Montréal, le forfait aéroport Neo Premium est de 48,20 $, taxes comprises. Votre chauffeur est confirmé la veille : vous recevez son nom, son véhicule et sa plaque par texto.

Réservez au moins 2 heures à l'avance, lien dans la bio.`, ['#Neomoov', '#YUL', '#AéroportMontréal', '#MontréalTrudeau', '#Montréal', '#Voyage']],
    li: [`Déplacements d'affaires vers l'aéroport Montréal-Trudeau : un prix connu d'avance.

Depuis le centre-ville, le forfait Neo Premium est de 48,20 $, taxes comprises. Réservation avec numéro de vol jusqu'à 90 jours à l'avance, chauffeur confirmé la veille, facture certifiée par courriel.`, `Business travel to Montréal-Trudeau airport, with the price known upfront. From downtown, the Neo Premium airport flat rate is $48.20, taxes included. Book with your flight number up to 90 days ahead; your driver is confirmed the day before and a certified invoice is emailed to you.`, ['#YUL', '#VoyageDAffaires', '#Montréal']],
    x: [`Aéroport Montréal-Trudeau : forfait Neo Premium à 48,20 $ depuis le centre-ville, taxes comprises. Chauffeur confirmé la veille.`, `Montréal-Trudeau airport: Neo Premium flat rate of $48.20 from downtown, taxes included. Your driver is confirmed the day before.`, ['#YUL']],
    tt: [[`Vous prenez l'avion bientôt ?`, `Depuis le centre-ville : 48,20 $ en Neo Premium, taxes comprises.`, `Réservez avec votre numéro de vol.`, `Votre chauffeur est confirmé la veille.`], `Le prix de votre trajet vers YUL, connu d'avance ✈️ Réservez sur neomoov.net/reserver`, ['#YUL', '#Montréal', '#Neomoov', '#Voyage']],
    sc: [[`Direction l'aéroport ?`, `48,20 $ depuis le centre-ville.`, `Neo Premium, taxes comprises.`], `Votre forfait aéroport ✈️ Réservez 2 h à l'avance : neomoov.net/reserver`, ['#YUL', '#Montréal']],
    yt: [`Aéroport Montréal-Trudeau : 48,20 $ depuis le centre-ville`, [`Vous prenez l'avion à Montréal-Trudeau ?`, `Depuis le centre-ville, le forfait Neo Premium est de 48,20 $, taxes comprises.`, `Réservez avec votre numéro de vol, jusqu'à 90 jours à l'avance.`, `Votre chauffeur est confirmé la veille, par texto.`], `Forfait aéroport Neo Premium depuis le centre-ville de Montréal : 48,20 $, taxes comprises. Réservation au moins 2 heures à l'avance, chauffeur confirmé la veille.`, ['#YUL', '#Montréal', '#Neomoov', '#Shorts']],
    tg: `Aéroport Montréal-Trudeau : forfait Neo Premium à 48,20 $ depuis le centre-ville, taxes comprises. Chauffeur confirmé la veille.`,
    wa: `Vous prenez l'avion bientôt ? Depuis le centre-ville, le forfait Neo Premium vers l'aéroport Montréal-Trudeau est de 48,20 $, taxes comprises. Réservez :`,
  },
  {
    n: 4, jour: 1, theme: 'electrique', sujet: 'Une flotte 100 % électrique', cta: 'reserve',
    photo: ['vehicule', 'Photo réelle d\'un véhicule électrique récent branché à une borne de recharge publique à Montréal (médiathèque, crédit indiqué).'],
    img: { facebook: 'Une flotte électrique', instagram: '100 % électrique', linkedin: 'Mobilité durable au travail', x: 'Zéro essence', tiktok: 'Pas de moteur à essence', snapchat: 'Électrique, toujours', youtube: 'Trois catégories électriques', telegram: 'La flotte Neomoov', whatsapp_channel: 'Bon à savoir' },
    fb: [`Chez Neomoov, toute la flotte est électrique.

Des véhicules récents, de cinq ans ou moins, inspectés à l'inscription puis chaque trimestre. Trois catégories : Neo Premium pour tous les jours, Neo Prestige pour les rendez-vous qui comptent, Neo XL jusqu'à six passagers.

Et le véhicule que vous réservez est celui qui arrive.`, ['#VéhiculeÉlectrique']],
    ig: [`100 % électrique, sur chaque trajet ⚡

Neo Premium, Neo Prestige ou Neo XL : vous choisissez votre catégorie, et le véhicule réservé est celui qui arrive. Des véhicules récents, inspectés chaque trimestre.

Réservez au moins 2 heures à l'avance, lien dans la bio.`, ['#Neomoov', '#VéhiculeÉlectrique', '#VoitureÉlectrique', '#Montréal', '#MobilitéDurable', '#MTL']],
    li: [`Une flotte 100 % électrique, sans exception.

Pour vos déplacements professionnels à Montréal, Neomoov propose trois catégories de véhicules électriques récents (cinq ans ou moins) : Neo Premium, Neo Prestige et Neo XL. Chaque véhicule est inspecté à l'inscription, puis chaque trimestre. Des véhicules récents, sans émission, pour des déplacements cohérents avec vos engagements de mobilité durable.`, `A 100% electric fleet, no exceptions. Neomoov offers three categories of recent electric vehicles (five years old or less) in Montréal: Neo Premium, Neo Prestige and Neo XL, each inspected at registration and every quarter. Zero-emission vehicles for business travel that matches your sustainability commitments.`, ['#MobilitéDurable', '#VéhiculeÉlectrique', '#Montréal']],
    x: [`Toute la flotte Neomoov est 100 % électrique : véhicules de cinq ans ou moins, inspectés chaque trimestre. Le véhicule réservé est celui qui arrive.`, `Neomoov's entire fleet is 100% electric: vehicles five years old or less, inspected every quarter. The vehicle you book is the one that shows up.`, ['#VéhiculeÉlectrique'], ['#EV']],
    tt: [[`Chez Neomoov, pas de moteur à essence.`, `Toute la flotte est 100 % électrique.`, `Des véhicules de cinq ans ou moins.`, `Inspectés chaque trimestre.`, `Et le véhicule réservé est celui qui arrive.`], `Silencieux, récents, électriques ⚡ Réservez au moins 2 h à l'avance sur neomoov.net/reserver`, ['#VoitureÉlectrique', '#Montréal', '#Neomoov', '#MTL']],
    sc: [[`100 % électrique.`, `Cinq ans ou moins.`, `Inspecté chaque trimestre.`], `La flotte Neomoov ⚡ neomoov.net/reserver`, ['#Neomoov', '#Électrique']],
    yt: [`Une flotte 100 % électrique à Montréal`, [`Chez Neomoov, toute la flotte est électrique.`, `Des véhicules récents, de cinq ans ou moins.`, `Inspectés à l'inscription, puis chaque trimestre.`, `Trois catégories : Neo Premium, Neo Prestige et Neo XL.`], `Neomoov roule 100 % électrique : véhicules récents, inspectés chaque trimestre, en trois catégories. Le véhicule réservé est celui qui arrive.`, ['#VoitureÉlectrique', '#Montréal', '#Neomoov', '#Shorts']],
    tg: `Toute la flotte Neomoov est 100 % électrique : véhicules de cinq ans ou moins, inspectés chaque trimestre, en trois catégories.`,
    wa: `Bon à savoir : chez Neomoov, chaque véhicule est 100 % électrique, récent et inspecté chaque trimestre. Réservez votre prochaine course :`,
  },
  {
    n: 5, jour: 2, theme: 'aeroport', sujet: 'Le transfert aéroport, étape par étape', cta: 'reserve',
    sensible: 'Prix publié (48,20 $) dans l\'article : sujet « argent », approbation humaine prévue par les lignes éditoriales.',
    photo: ['aeroport', 'Photo réelle du hall des arrivées de l\'aéroport Montréal-Trudeau, voyageurs de dos avec leurs valises, aucun visage reconnaissable (médiathèque, crédit indiqué).'],
    img: { site_blog: 'Le guide de l\'aéroport', facebook: 'Votre transfert, étape par étape', instagram: 'Quatre étapes vers YUL', linkedin: 'Les voyages de vos équipes', x: 'Retard de vol ? Pas de souci', tiktok: 'Sans stress jusqu\'à YUL', snapchat: 'Votre chauffeur aussi', youtube: 'Comment ça se passe', telegram: 'Transfert aéroport', whatsapp_channel: 'Avant le décollage' },
    blog: {
      titre: 'Aller à l\'aéroport Montréal-Trudeau avec Neomoov : le guide',
      extrait: 'Forfait depuis le centre-ville, numéro de vol, chauffeur confirmé la veille, retard de vol : tout pour un trajet vers ou depuis YUL sans surprise.',
      corps: `Un départ en voyage commence bien avant l'embarquement. Pour que le trajet vers l'aéroport Montréal-Trudeau, ou le retour à la maison, se fasse sans stress, Neomoov a prévu un déroulement simple, un prix connu d'avance et un chauffeur confirmé la veille. Voici ce qu'il faut savoir.

## Un prix connu avant de partir

Depuis le centre-ville de Montréal, le forfait aéroport Neo Premium est de 48,20 $, taxes comprises. Ce prix est fixé à la réservation : il ne dépend ni de la circulation ni de l'itinéraire emprunté le jour venu. Depuis un autre quartier, le prix fixe est calculé à la réservation et affiché en totalité avant que vous confirmiez.

Comme pour toutes nos courses, le prix comprend le tarif du chauffeur, les frais de service, les péages, la redevance et les taxes. Aucune majoration liée à la demande, même aux heures de pointe.

## Réserver avec votre numéro de vol

Vous pouvez réserver votre transfert au moins 2 heures à l'avance et jusqu'à 90 jours. Pour un voyage prévu de longue date, réservez dès que vos billets sont achetés : c'est une chose de moins à penser.

À la réservation, indiquez votre numéro de vol : il permet d'organiser la prise en charge au bon moment. Précisez aussi le nombre et la taille de vos bagages, ainsi que vos demandes particulières.

Vous réservez pour une autre personne, un parent ou un client par exemple ? Indiquez son nom et son numéro de téléphone : elle reçoit par texto le suivi de sa course, puis l'approche et l'arrivée du chauffeur, avec le modèle et la plaque du véhicule.

Trois façons de réserver :

- sur neomoov.net/reserver, sans créer de compte ;
- par WhatsApp, au +1 438 900 4990 ;
- dans l'application Neomoov.

## Votre chauffeur, confirmé la veille

La veille de votre départ, vous recevez par texto le nom de votre chauffeur, son véhicule et sa plaque. Le jour même, un texto vous prévient quand le chauffeur est en route, puis à son arrivée. Vous savez à tout moment qui vient vous chercher.

## À l'arrivée : un point de rencontre précis

Si vous rentrez à Montréal, le point de rencontre aux arrivées vous est précisé dans la confirmation, avec le nom du chauffeur, le modèle et la plaque du véhicule. Inutile de chercher un véhicule au hasard à la sortie de l'aérogare.

Votre vol est en retard ? Signalez-le : l'heure de prise en charge est ajustée, sans frais supplémentaires pour un retard annoncé.

## Choisir la bonne catégorie

Les bagages sont compris dans la limite du coffre de la catégorie choisie. Quelques repères :

- Neo Premium : berline ou VUS électrique, quatre places et deux valises ;
- Neo Prestige : haut de gamme, quatre places et deux valises, pour voyager dans le calme ;
- Neo XL : jusqu'à six passagers et six valises, pour les familles, les groupes ou l'équipement volumineux.

Vous voyagez avec un jeune enfant ? Demandez un siège d'enfant à la réservation : il est fourni sans frais pour les forfaits aéroport.

## À bord

Tous nos véhicules sont 100 % électriques, récents et inspectés chaque trimestre. Vous y trouvez de l'eau, des chargeurs et le Wi-Fi, bien pratiques avant un vol. Vous pouvez aussi demander une ambiance silencieuse pour vous reposer, ou indiquer la langue souhaitée pour votre chauffeur. La connaissance de Montréal et de l'aéroport fait d'ailleurs partie de nos critères de recrutement.

## Payer et recevoir sa facture

Vous payez par carte dans l'application ou directement au chauffeur, à la fin de la course. Un reçu et une facture certifiée vous sont envoyés par courriel : pratique pour vos notes de frais de voyage d'affaires.

## En résumé

1. Réservez au moins 2 heures à l'avance, idéalement dès que vos billets sont achetés.
2. Indiquez votre numéro de vol et vos bagages.
3. Recevez le nom de votre chauffeur la veille.
4. Partez l'esprit tranquille, au prix affiché.

Bon voyage, et à bientôt à bord.

Réservez votre transfert vers l'aéroport Montréal-Trudeau : https://neomoov.net/reserver`,
    },
    fb: [`Votre prochain vol part de Montréal-Trudeau ?

Voici comment se passe votre transfert avec Neomoov : réservation avec votre numéro de vol, chauffeur confirmé la veille par texto, point de rencontre précisé aux arrivées, et attente ajustée sans frais pour un retard annoncé.

Réservez votre transfert :`, ['#YUL', '#Montréal']],
    ig: [`Le transfert aéroport, étape par étape ✈️

1. Réservez avec votre numéro de vol.
2. Recevez le nom de votre chauffeur la veille, par texto.
3. Retrouvez-le au point de rencontre indiqué.
4. Vol en retard ? L'attente est ajustée sans frais pour un retard annoncé.

Lien dans la bio.`, ['#YUL', '#AéroportMontréal', '#MontréalTrudeau', '#Voyage', '#Neomoov', '#Montréal']],
    li: [`Vos équipes voyagent souvent ?

Le transfert aéroport Neomoov suit un déroulement précis : réservation avec numéro de vol jusqu'à 90 jours à l'avance, chauffeur confirmé la veille, texto quand il est en route, point de rencontre précisé aux arrivées et facture certifiée par courriel pour vos notes de frais.`, `Does your team travel often? Neomoov airport transfers follow a clear process: booking with flight number up to 90 days ahead, driver confirmed the day before, a text when the driver is on the way, a set meeting point at arrivals and a certified invoice by email for expense reports.`, ['#YUL', '#VoyageDAffaires', '#Montréal']],
    x: [`Transfert vers YUL : réservez avec votre numéro de vol, recevez le nom de votre chauffeur la veille. Retard annoncé ? L'attente est ajustée sans frais.`, `Airport transfer to YUL: book with your flight number and get your driver's name the day before. Delay reported? Pickup is adjusted at no extra cost.`, ['#YUL']],
    tt: [[`Le transfert aéroport sans stress, en quatre étapes.`, `Un : réservez avec votre numéro de vol.`, `Deux : le nom de votre chauffeur arrive la veille.`, `Trois : un texto quand il est en route.`, `Quatre : vol en retard ? L'attente est ajustée.`], `Montréal-Trudeau, sans stress ✈️ Réservez sur neomoov.net/reserver`, ['#YUL', '#Montréal', '#Voyage', '#Neomoov']],
    sc: [[`Votre vol est réservé ?`, `Votre chauffeur aussi.`, `Confirmé la veille, par texto.`], `Transfert aéroport ✈️ neomoov.net/reserver`, ['#YUL', '#Montréal']],
    yt: [`Transfert aéroport Montréal-Trudeau : comment ça se passe`, [`Vous prenez l'avion à Montréal-Trudeau ?`, `Réservez avec votre numéro de vol, jusqu'à 90 jours à l'avance.`, `La veille, vous recevez le nom du chauffeur, le véhicule et la plaque.`, `Vol en retard ? L'attente est ajustée sans frais pour un retard annoncé.`], `Le déroulement d'un transfert vers ou depuis l'aéroport Montréal-Trudeau avec Neomoov : réservation avec numéro de vol, chauffeur confirmé la veille, point de rencontre précisé aux arrivées.`, ['#YUL', '#Montréal', '#Neomoov', '#Shorts']],
    tg: `Transfert aéroport : réservez avec votre numéro de vol, recevez le nom de votre chauffeur la veille, et l'attente est ajustée sans frais si votre retard est annoncé.`,
    wa: `Votre transfert vers ou depuis Montréal-Trudeau, étape par étape : numéro de vol à la réservation, chauffeur confirmé la veille, point de rencontre précisé. Réservez :`,
  },
  {
    n: 6, jour: 2, theme: 'reservation', sujet: 'Pourquoi réserver au moins 2 heures à l\'avance', cta: 'reserve',
    photo: ['client', 'Photo réelle d\'une cliente qui consulte son téléphone dans un café de Montréal (modèle, licence commerciale, crédit indiqué).'],
    img: { facebook: 'Pourquoi 2 heures ?', instagram: 'Planifier, c\'est arriver à l\'heure', linkedin: 'Un choix de fiabilité', x: '2 h à l\'avance', tiktok: 'La question qu\'on nous pose', snapchat: 'Chauffeur confirmé', youtube: 'Réserver à l\'avance', telegram: 'Rappel de réservation', whatsapp_channel: 'Une course demain ?' },
    fb: [`Pourquoi réserver au moins 2 heures à l'avance ?

Parce que ce délai nous permet de vous confirmer un chauffeur et le véhicule que vous avez choisi, plutôt que de vous envoyer le premier véhicule disponible. Vous pouvez réserver jusqu'à 90 jours à l'avance, sur notre site, par WhatsApp au +1 438 900 4990 ou dans l'application.`, []],
    ig: [`Planifier, c'est déjà arriver à l'heure 📱

Chez Neomoov, chaque course se réserve au moins 2 heures à l'avance, et jusqu'à 90 jours. Ce délai nous permet de vous confirmer votre chauffeur et le véhicule choisi.

Lien dans la bio, ou WhatsApp au +1 438 900 4990.`, ['#Neomoov', '#Montréal', '#MTL', '#Réservation', '#TransportDePersonnes']],
    li: [`Réservation au moins 2 heures à l'avance : un choix de fiabilité.

Pour vos rendez-vous professionnels, Neomoov confirme un chauffeur et le véhicule choisi avant le départ, plutôt que d'envoyer le premier véhicule disponible. Les courses se planifient jusqu'à 90 jours à l'avance.`, `Booking at least 2 hours ahead: a reliability choice. For your business appointments, Neomoov confirms a driver and the vehicle you chose before departure, instead of sending the first available car. Rides can be scheduled up to 90 days ahead.`, ['#Montréal', '#Mobilité']],
    x: [`Chez Neomoov, chaque course se réserve au moins 2 h à l'avance, jusqu'à 90 jours : de quoi vous confirmer chauffeur et véhicule avant le départ.`, `At Neomoov, every ride is booked at least 2 hours ahead, up to 90 days: enough time to confirm your driver and vehicle before departure.`, ['#Montréal'], ['#Montreal']],
    tt: [[`Pourquoi réserver 2 heures à l'avance ?`, `Pour confirmer votre chauffeur.`, `Pour garantir le véhicule que vous avez choisi.`, `Et vous pouvez réserver jusqu'à 90 jours à l'avance.`], `Planifiez, nous nous occupons du reste 📱 neomoov.net/reserver`, ['#Neomoov', '#Montréal', '#MTL']],
    sc: [[`2 heures avant.`, `Chauffeur confirmé.`, `Véhicule garanti.`], `Réservez à l'avance 📱 neomoov.net/reserver`, ['#Neomoov', '#MTL']],
    yt: [`Pourquoi réserver 2 heures à l'avance avec Neomoov`, [`Chez Neomoov, chaque course se réserve au moins 2 heures à l'avance.`, `Ce délai permet de confirmer un chauffeur avant le départ.`, `Et de garantir le véhicule que vous avez choisi.`, `Vous pouvez réserver jusqu'à 90 jours à l'avance.`], `Réservation au moins 2 heures à l'avance et jusqu'à 90 jours, sur neomoov.net/reserver, par WhatsApp ou dans l'application Neomoov.`, ['#Neomoov', '#Montréal', '#Shorts']],
    tg: `Rappel : chaque course Neomoov se réserve au moins 2 heures à l'avance, et jusqu'à 90 jours. Ce délai nous permet de confirmer votre chauffeur et votre véhicule.`,
    wa: `Une course demain matin ? Réservez-la dès aujourd'hui : au moins 2 heures à l'avance, jusqu'à 90 jours. Sur notre site ou par message au +1 438 900 4990.`,
  },
  {
    n: 7, jour: 3, theme: 'prix', sujet: 'Le prix affiché est le prix payé', cta: 'reserve',
    photo: ['client', 'Photo réelle d\'un passager souriant à l\'arrière d\'un véhicule électrique, téléphone en main (modèle, licence commerciale, crédit indiqué).'],
    img: { facebook: 'Le prix affiché, le prix payé', instagram: 'Tout est compris', linkedin: 'Transparence du prix', x: 'Aucune majoration', tiktok: 'Le prix change ? Pas ici', snapchat: 'Aucune surprise', youtube: 'Le vrai prix, d\'avance', telegram: 'Prix garanti', whatsapp_channel: 'Le prix total, avant' },
    fb: [`Le prix affiché est le prix payé.

Avant de confirmer votre course, vous voyez le prix total : tarif du chauffeur, frais de service, péages, redevance et taxes compris. Il est calculé avec le trafic prévu à l'heure de votre départ et ne change plus une fois confirmé. Aucune majoration liée à la demande.`, []],
    ig: [`Le prix affiché est le prix payé 🧾

Tout est compris : tarif du chauffeur, frais de service, péages, redevance et taxes. Le prix tient compte du trafic prévu et ne bouge plus une fois confirmé.

Réservez au moins 2 heures à l'avance, lien dans la bio.`, ['#Neomoov', '#PrixTransparent', '#Montréal', '#MTL', '#TransportDePersonnes']],
    li: [`Transparence du prix : ce que nous affichons, vous le payez.

Chaque course Neomoov est proposée à un prix tout compris (tarif du chauffeur, frais de service, péages, redevance et taxes), calculé avec le trafic prévu et garanti une fois confirmé. Aucune majoration liée à la demande : une prévisibilité appréciable pour les budgets de déplacement.`, `Price transparency: what we show is what you pay. Every Neomoov ride comes with an all-inclusive price (driver fare, service fee, tolls, government fee and taxes), based on expected traffic and guaranteed once confirmed. No demand-based pricing, for predictable travel budgets.`, ['#Transparence', '#Montréal', '#Mobilité']],
    x: [`Le prix affiché est le prix payé : péages, redevance et taxes compris, calculé avec le trafic prévu, garanti une fois confirmé. Aucune majoration liée à la demande.`, `The price you see is the price you pay: tolls, fees and taxes included, based on expected traffic, guaranteed once confirmed. No demand-based surcharge.`, []],
    tt: [[`Le prix change pendant la course ? Pas chez Neomoov.`, `Avant de confirmer, vous voyez le prix total.`, `Péages, redevance et taxes compris.`, `Une fois confirmé, il ne bouge plus.`], `Le prix affiché est le prix payé 🧾 neomoov.net/reserver`, ['#Neomoov', '#Montréal', '#MTL']],
    sc: [[`Prix total affiché.`, `Avant de confirmer.`, `Il ne bouge plus.`], `Aucune surprise 🧾 neomoov.net/reserver`, ['#Neomoov', '#MTL']],
    yt: [`Le prix affiché est le prix payé`, [`Chez Neomoov, vous voyez le prix total avant de confirmer.`, `Il comprend le tarif du chauffeur, les frais de service, les péages, la redevance et les taxes.`, `Il tient compte du trafic prévu à l'heure de votre départ.`, `Et une fois confirmé, il ne change plus.`], `Comment Neomoov affiche un prix tout compris avant chaque course, sans majoration liée à la demande.`, ['#Neomoov', '#Montréal', '#Shorts']],
    tg: `Le prix affiché est le prix payé : péages, redevance et taxes compris, garanti une fois la course confirmée.`,
    wa: `Bon à savoir : avant de confirmer votre course, vous voyez le prix total, tout compris. Il ne change plus ensuite.`,
  },
  {
    n: 8, jour: 3, theme: 'chauffeurs', sujet: 'Neomoov recrute des chauffeurs professionnels', cta: 'preregister',
    photo: ['chauffeur', 'Photo réelle d\'un chauffeur professionnel souriant, en tenue soignée, près d\'un véhicule électrique (modèle, licence commerciale, crédit indiqué).'],
    img: { facebook: 'Neomoov recrute', instagram: 'Chauffeurs, à vous', linkedin: 'Ce que nous demandons', x: 'Recrutement chauffeurs', tiktok: 'Chauffeur à Montréal ?', snapchat: 'Vos heures, votre clientèle', youtube: 'Devenir chauffeur Neomoov', telegram: 'Candidatures ouvertes', whatsapp_channel: 'Un chauffeur à recommander ?' },
    fb: [`Chauffeurs professionnels de Montréal : Neomoov recrute.

Vous avez un permis valide, l'autorisation de transport rémunéré de personnes (ou vous souhaitez être accompagné pour l'obtenir) et un véhicule électrique récent ? Vous choisissez vos heures, et la clientèle que vous vous constituez vous appartient.

Envoyez votre candidature : deux minutes suffisent.`, []],
    ig: [`Chauffeurs professionnels, Neomoov vous attend 🚗

Vous choisissez vos heures, vous retrouvez votre clientèle dans votre espace « Mes clients », et chaque course est planifiée au moins 2 heures à l'avance.

Candidature en deux minutes, lien dans la bio.`, ['#Neomoov', '#ChauffeurMontréal', '#Chauffeur', '#Montréal', '#VoitureÉlectrique', '#TransportDePersonnes']],
    li: [`Neomoov recrute des chauffeurs professionnels à Montréal.

Ce que nous demandons : un permis valide de la classe requise au Québec, l'autorisation de transport rémunéré de personnes (nous accompagnons les démarches), une vérification des antécédents, une assurance conforme et un véhicule 100 % électrique admis.

Ce que nous offrons : des courses planifiées au moins 2 heures à l'avance, la liberté de choisir vos heures, une clientèle qui vous appartient et des décisions toujours prises par une personne.`, `Neomoov is recruiting professional drivers in Montréal. Requirements: a valid Québec licence of the required class, a paid passenger transportation authorization (we help with the process), a background check, proper insurance and an approved 100% electric vehicle. In return: rides scheduled at least 2 hours ahead, freedom to choose your hours, a clientele that is yours, and decisions always made by a person.`, ['#Recrutement', '#Chauffeur', '#Montréal']],
    x: [`Chauffeurs professionnels de Montréal : Neomoov recrute. Courses planifiées 2 h à l'avance, vos heures, votre clientèle. Candidature en deux minutes.`, `Professional drivers in Montréal: Neomoov is recruiting. Rides scheduled 2 hours ahead, your hours, your clientele. Apply in two minutes.`, []],
    tt: [[`Vous êtes chauffeur professionnel à Montréal ?`, `Avec Neomoov, vous choisissez vos heures.`, `Les courses sont planifiées au moins 2 heures à l'avance.`, `Votre clientèle vous appartient.`, `Candidature en deux minutes.`], `Chauffeurs, Neomoov recrute 🚗 Candidature sur neomoov.net/chauffeurs/#candidature`, ['#ChauffeurMontréal', '#Neomoov', '#Montréal', '#VoitureÉlectrique']],
    sc: [[`Chauffeur à Montréal ?`, `Vos heures.`, `Votre clientèle.`], `Neomoov recrute 🚗 neomoov.net/chauffeurs/#candidature`, ['#Chauffeur', '#MTL']],
    yt: [`Devenir chauffeur Neomoov à Montréal`, [`Neomoov recrute des chauffeurs professionnels à Montréal.`, `Il faut un permis valide, l'autorisation de transport rémunéré et un véhicule électrique admis.`, `Vous choisissez vos heures, sans exclusivité.`, `Candidature en deux minutes, vérification sous 48 heures.`], `Conditions et étapes pour devenir chauffeur Neomoov : formulaire, documents, entretien, vérification sous 48 heures validée par une personne, formation en ligne.`, ['#ChauffeurMontréal', '#Neomoov', '#Shorts']],
    tg: `Chauffeurs professionnels de Montréal : Neomoov recrute. Vos heures, votre clientèle, des courses planifiées. Candidature :`,
    wa: `Vous connaissez un chauffeur professionnel qui roule en véhicule électrique ? Neomoov recrute à Montréal. Candidature en deux minutes :`,
  },
  {
    n: 9, jour: 4, theme: 'quartiers', sujet: 'Action de grâce : se déplacer en famille', cta: 'reserve',
    photo: ['client', 'Photo réelle d\'une famille qui range ses bagages dans un VUS électrique, feuillage d\'automne en arrière-plan (modèles, licence commerciale, crédit indiqué).'],
    img: { facebook: 'Bonne Action de grâce', instagram: 'En famille cet automne', linkedin: 'Pensez à vos invités', x: 'Six places en Neo XL', tiktok: 'Toute la famille vient ?', snapchat: 'Toute la famille à bord', youtube: 'Voyager en famille', telegram: 'Longue fin de semaine', whatsapp_channel: 'Visites en famille' },
    fb: [`Longue fin de semaine de l'Action de grâce : vous rendez visite à la famille ?

Avec Neo XL, jusqu'à six passagers voyagent ensemble avec leurs bagages. Siège d'enfant sur demande. Réservez au moins 2 heures à l'avance pour vos allers et retours.

Bonne Action de grâce à tous !`, ['#ActionDeGrâce']],
    ig: [`Action de grâce en famille 🍁

Jusqu'à six passagers et leurs bagages en Neo XL, siège d'enfant sur demande, prix tout compris connu avant de confirmer.

Réservez vos allers et retours, lien dans la bio.`, ['#ActionDeGrâce', '#Montréal', '#MTL', '#Famille', '#Neomoov', '#Automne']],
    li: [`Longue fin de semaine de l'Action de grâce : pensez à vos invités.

Hôtels, conciergeries, organisateurs : Neomoov transporte jusqu'à six passagers en Neo XL et permet de réserver pour une autre personne, qui reçoit le suivi de sa course par texto.`, `Thanksgiving long weekend: think of your guests. Hotels, concierges and event organizers: Neomoov carries up to six passengers in Neo XL and lets you book for someone else, who receives ride tracking by text.`, ['#Montréal', '#Hôtellerie']],
    x: [`Action de grâce : en famille jusqu'à six passagers avec Neo XL, bagages compris dans la limite du coffre. Réservez vos allers et retours dès maintenant.`, `Thanksgiving weekend: travel together, up to six passengers in Neo XL, luggage included within trunk capacity. Book your trips now.`, ['#ActionDeGrâce'], ['#Thanksgiving']],
    tt: [[`Action de grâce : toute la famille vient ?`, `Neo XL : jusqu'à six passagers.`, `Les bagages suivent.`, `Siège d'enfant sur demande.`], `En famille pour l'Action de grâce 🍁 Réservez sur neomoov.net/reserver`, ['#ActionDeGrâce', '#Montréal', '#Famille', '#Neomoov']],
    sc: [[`Toute la famille ?`, `Six places en Neo XL.`, `Et leurs bagages.`], `Bonne Action de grâce 🍁 neomoov.net/reserver`, ['#ActionDeGrâce', '#MTL']],
    yt: [`Action de grâce : voyager en famille avec Neo XL`, [`Longue fin de semaine de l'Action de grâce ?`, `Neo XL accueille jusqu'à six passagers et leurs bagages.`, `Siège d'enfant sur demande, à la réservation.`, `Réservez au moins 2 heures à l'avance, jusqu'à 90 jours.`], `Pour vos déplacements en famille pendant l'Action de grâce à Montréal : Neo XL, jusqu'à six passagers et leurs bagages, prix tout compris affiché avant de confirmer.`, ['#ActionDeGrâce', '#Montréal', '#Shorts']],
    tg: `Bonne Action de grâce ! Pour vos visites en famille, Neo XL accueille jusqu'à six passagers et leurs bagages.`,
    wa: `Bonne longue fin de semaine de l'Action de grâce 🍁 En famille ? Neo XL accueille jusqu'à six passagers. Réservez :`,
  },
  {
    n: 10, jour: 4, theme: 'commodites', sujet: 'Ce qui vous attend à bord', cta: 'reserve',
    photo: ['vehicule', 'Photo réelle de l\'intérieur d\'un véhicule électrique récent : banquette arrière propre, bouteille d\'eau et câble de recharge à disposition (médiathèque, crédit indiqué).'],
    img: { facebook: 'Tout est à bord', instagram: 'Ce qui vous attend', linkedin: 'Arriver prêt', x: 'Votre trajet, votre façon', tiktok: 'Ce qu\'il y a à bord', snapchat: 'Eau, chargeurs, Wi-Fi', youtube: 'À bord d\'un véhicule Neomoov', telegram: 'Les commodités', whatsapp_channel: 'Petit rappel' },
    fb: [`À bord de chaque véhicule Neomoov : de l'eau, des chargeurs, le Wi-Fi et un parapluie à disposition.

Et à la réservation, vous choisissez le reste : silence ou discussion, musique, température, langue du chauffeur. Votre trajet, à votre façon.`, []],
    ig: [`Ce qui vous attend à bord 💧

Eau, chargeurs, Wi-Fi, parapluie : c'est compris dans tous nos véhicules. Silence ou discussion, musique, température : c'est vous qui choisissez.

Réservez au moins 2 heures à l'avance, lien dans la bio.`, ['#Neomoov', '#Confort', '#Montréal', '#MTL', '#VoitureÉlectrique', '#TransportDePersonnes']],
    li: [`Le confort d'un déplacement professionnel tient aux détails.

Dans chaque véhicule Neomoov : eau, chargeurs, Wi-Fi et parapluie. À la réservation : ambiance silencieuse pour préparer une réunion, langue du chauffeur, température. De quoi arriver prêt.`, `Comfort on a business trip comes down to details. In every Neomoov vehicle: water, chargers, Wi-Fi and an umbrella. When booking: a quiet ride to prepare for a meeting, driver language, temperature. Arrive ready.`, ['#VoyageDAffaires', '#Montréal']],
    x: [`Dans chaque véhicule Neomoov : eau, chargeurs, Wi-Fi et parapluie. Silence, musique, température : vous choisissez à la réservation.`, `In every Neomoov vehicle: water, chargers, Wi-Fi and an umbrella. Quiet ride, music, temperature: you choose when booking.`, []],
    tt: [[`Ce qu'il y a à bord d'un véhicule Neomoov :`, `De l'eau.`, `Des chargeurs et le Wi-Fi.`, `Un parapluie, au cas où.`, `Et l'ambiance que vous choisissez.`], `Votre trajet, à votre façon 💧 neomoov.net/reserver`, ['#Neomoov', '#Montréal', '#Confort']],
    sc: [[`Eau.`, `Chargeurs. Wi-Fi.`, `Parapluie.`], `Tout est à bord 💧 neomoov.net/reserver`, ['#Neomoov', '#MTL']],
    yt: [`À bord d'un véhicule Neomoov`, [`Dans chaque véhicule Neomoov, de l'eau vous attend.`, `Des chargeurs et le Wi-Fi, pour rester connecté.`, `Un parapluie à disposition.`, `Et à la réservation, vous choisissez l'ambiance, la musique et la température.`], `Les commodités comprises dans tous les véhicules Neomoov, et les préférences que vous indiquez à la réservation.`, ['#Neomoov', '#Montréal', '#Shorts']],
    tg: `À bord de chaque véhicule Neomoov : eau, chargeurs, Wi-Fi et parapluie. Vos préférences (silence, musique, température) s'indiquent à la réservation.`,
    wa: `Petit rappel : eau, chargeurs, Wi-Fi et parapluie sont à disposition dans tous nos véhicules. Réservez votre prochaine course :`,
  },
];
