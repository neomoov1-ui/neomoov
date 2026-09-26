# Fiche magasin : application Neomoov Chauffeur

Préparée pour App Store Connect et Google Play Console (prompt 11, tâche 9 ; complétée à l'étape 16, prompt 16, tâche 5). Les textes publics restent à relire par le fondateur avant soumission. La vidéo de démonstration de la localisation en arrière-plan est à produire par le fondateur (voir plus bas). Les étiquettes de confidentialité sont alignées sur ce que le code collecte au 26 septembre 2026. Liste de vérification de soumission : `verification-soumission.md`.

## Identité

| Élément | Valeur |
|---|---|
| Nom | Neomoov Chauffeur (EN : Neomoov Driver) |
| Sous-titre App Store (30 caractères au plus) | FR : « Courses pour chauffeurs pros » ; EN : « Rides for pro drivers » |
| Identifiant iOS et Android | `com.neomoov.driver` |
| Catégorie | Affaires (App Store) ; Cartes et navigation ou Entreprise (Google Play, choix fait à la création de la fiche) |
| Langues | Français (Canada), anglais |
| Public | Chauffeurs professionnels de Neomoov (autorisés par la SAAQ ou inscrits auprès d'un répondant) |
| Site | https://neomoov.net |
| Assistance | Page d'assistance de neomoov.net : **à créer ou à confirmer** |
| Conditions d'utilisation | https://neomoov.net/conditions-d-utilisation/ |
| Politique de confidentialité | https://neomoov.net/politique-de-confidentialite/ (doit décrire la localisation en arrière-plan, les documents, la conservation de 90 jours des positions et l'export réglementaire) |
| Suppression de compte hors de l'application | Même page que l'application client (`client.md`) : **à créer** |
| Classement | 4+ (App Store) ; IARC de Google : communications entre utilisateurs, partage de la position avec d'autres utilisateurs |
| Visuels (D46) | Captures réelles de l'application ; aucune illustration dessinée |

## Descriptions

### Français

Description courte (Google Play) :

> Recevez des courses réservées à Montréal et suivez vos revenus.

Description complète :

> Neomoov Chauffeur est l'application des chauffeurs professionnels partenaires de Neomoov à Montréal.
>
> • Inscription guidée : dossier, véhicule, documents photographiés dans l'application, formation Neomoov avec quiz.
> • Courses réservées à l'avance : offre avec la distance, la durée, les arrêts et les préférences du client, compte à rebours et sonnerie dédiée.
> • Réservations planifiées : proposez-vous sur les courses à venir et confirmez-les.
> • Pendant la course : navigation dans Google Maps ou Waze, messagerie avec le client sans échange de numéros, bouton d'urgence.
> • Revenus du jour, de la semaine et du mois, relevés hebdomadaires en PDF, packs de courses.
> • Tableau de conduite : ponctualité, accélérations et freinages, conseils.
> • Échéances de vos documents rappelées à l'avance.
>
> Votre position n'est partagée que lorsque vous êtes en ligne. Hors ligne, rien n'est envoyé.

### English

Short description (Google Play):

> Receive pre-booked rides in Montréal and track your earnings.

Full description:

> Neomoov Driver is the app for Neomoov's professional partner drivers in Montréal.
>
> • Guided sign-up: profile, vehicle, documents photographed in the app, Neomoov training with a quiz.
> • Pre-booked rides: offers show distance, duration, stops and rider preferences, with a countdown and a dedicated ringtone.
> • Scheduled bookings: claim upcoming rides and confirm them.
> • During the ride: navigate with Google Maps or Waze, message the rider without sharing phone numbers, emergency button.
> • Daily, weekly and monthly earnings, weekly PDF statements, ride packs.
> • Driving dashboard: punctuality, acceleration and braking, tips.
> • Reminders before your documents expire.
>
> Your location is shared only while you are online. Offline, nothing is sent.

À ajouter quand ce sera branché : versements par Stripe (compte de versement), vérification faciale (drapeau `FEATURE_FACE_CHECK`, V1.1).

## Autorisations demandées et justification

| Autorisation | Plateforme | Quand | Justification affichée (texte réel de `app.json`) |
|---|---|---|---|
| Localisation pendant l'utilisation | iOS (`NSLocationWhenInUseUsageDescription`), Android (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) | Au premier passage en ligne, après l'écran d'explication de l'application | « Neomoov Chauffeur utilise votre position quand vous êtes en ligne, pour vous proposer des courses proches et montrer au client où vous êtes. » |
| Localisation en arrière-plan (« Toujours ») | iOS (`NSLocationAlwaysAndWhenInUseUsageDescription`, mode `location` de `UIBackgroundModes`), Android (`ACCESS_BACKGROUND_LOCATION`, service de premier plan `FOREGROUND_SERVICE_LOCATION`) | Juste après, avec la même explication | « Quand vous êtes en ligne, Neomoov Chauffeur envoie votre position toutes les 5 secondes, même écran verrouillé ou application en arrière-plan, pour recevoir des offres et suivre vos courses. Hors ligne, aucune position n'est envoyée. » |
| Appareil photo | iOS (`NSCameraUsageDescription`), Android (`CAMERA`) | Au toucher de « Prendre une photo » d'un document | Photographier les documents (permis, assurance, immatriculation) ; en V1.1, vérification faciale en début de quart si elle est activée |
| Photos | iOS (`NSPhotoLibraryUsageDescription`) | Au toucher de « Choisir une photo » | Joindre un document déjà photographié |
| Notifications | iOS, Android 13 et plus | Après la connexion | Offres de course (canal prioritaire, son distinct), courses planifiées, relevés, échéances de documents, packs |
| Vibration, maintien de l'écran | Android (`VIBRATE`, `WAKE_LOCK`) | Pendant une offre et une course | Sonnerie et vibration de l'offre ; écran allumé sur le support pendant la course |

Aucun accès aux contacts, au microphone (refusé explicitement dans `app.json`) ni au calendrier.

Point à vérifier avant la revue d'Apple : `UIBackgroundModes` déclare aussi `fetch` et `remote-notification`. Aucun code de rafraîchissement en arrière-plan ni de notification silencieuse n'a été trouvé dans l'application : Apple refuse les modes d'arrière-plan non utilisés (règle 2.5.4). Retirer ces deux modes ou justifier leur usage (manque signalé).

## Données réellement collectées par l'application (V1)

| Donnée | Écran | Obligatoire | Envoyée à |
|---|---|---|---|
| Téléphone | Connexion | Oui | API, Twilio (code SMS) |
| Prénom, nom, courriel (facultatif), qualification (autorisé SAAQ ou inscrit), langue, code de parrainage | Candidature | Oui, sauf courriel et parrainage | API |
| Numéros de TPS et TVQ, raison sociale, langues parlées, années d'expérience, paiements acceptés, courriel Interac, zones préférées | Profil, accueil | Non | API (numéros de taxes chiffrés en base) |
| Véhicule : marque, modèle, année, couleur, plaque, places | Véhicule | Oui | API |
| Documents : photos ou PDF du permis, de l'attestation de formation, des antécédents judiciaires, de l'assurance, de l'immatriculation, de la vérification mécanique, photo de profil, preuve de TPS et TVQ ; numéros et dates | Documents | Oui pour passer en ligne | API (analyse antivirus, stockage au Canada), agent recrutement (extraction des champs par un modèle de langage, fournisseur Anthropic) |
| Réponses au quiz de formation | Formation | Oui pour passer en ligne | API |
| Position précise, en ligne seulement, y compris en arrière-plan, toutes les 5 secondes ou 50 mètres | En ligne | Oui pour travailler | API (conservée 90 jours), client de la course (pendant la course), export mensuel pseudonymisé exigé par la réglementation |
| Messages au client, évaluation du client, signalement d'incident, SOS | Course | Non | API, client de la course |
| Paiement direct reçu (montant confirmé) | Fin de course | Selon le mode de paiement | API |
| Consentement de géolocalisation, demandes Loi 25 | Profil | | API |
| Jeton de notification | Automatique | Non | API, Expo |

Non collectés par l'application : coordonnées bancaires (saisies sur la page hébergée de Stripe, hors application ; versements non encore branchés), photo du visage (drapeau `FEATURE_FACE_CHECK` inactif), son (le microphone est refusé), rapports de plantage (Sentry non branché), statistiques d'usage, identifiant publicitaire. Les accélérations et freinages du tableau de conduite sont calculés par le serveur à partir des positions, pas relevés par les capteurs du téléphone.

## Étiquettes de confidentialité Apple (App Privacy)

Aucune donnée utilisée pour le suivi (tracking).

| Type de données Apple | Collecté | Lié à l'identité | Finalités |
|---|---|---|---|
| Coordonnées : Nom, Adresse courriel, Numéro de téléphone | Oui | Oui | Fonctionnalité de l'app |
| Localisation : Position précise | Oui | Oui | Fonctionnalité de l'app ; Autres finalités (obligation réglementaire : export de géolocalisation pseudonymisé) |
| Contenu utilisateur : Photos ou vidéos (documents, photo de profil) | Oui | Oui | Fonctionnalité de l'app |
| Contenu utilisateur : Autre contenu (messages, évaluations des clients, signalements, réponses au quiz) | Oui | Oui | Fonctionnalité de l'app |
| Informations financières : Autres informations financières (paiements acceptés, montants encaissés déclarés, courriel Interac) | Oui | Oui | Fonctionnalité de l'app |
| Identifiants : Identifiant d'utilisateur, Identifiant de l'appareil (jeton de notification) | Oui | Oui | Fonctionnalité de l'app |
| Autres types de données : numéros de permis et de documents, antécédents judiciaires, qualification, numéros de TPS et TVQ, véhicule et plaque | Oui | Oui | Fonctionnalité de l'app |
| Données sensibles (biométrie) | Non en V1 ; **oui dès l'activation de la vérification faciale** | | |
| Santé, Contacts, Historique de navigation ou de recherche, Données d'utilisation, Diagnostics | Non (V1) | | |

## Sécurité des données Google Play (Data safety)

| Question | Réponse |
|---|---|
| Données chiffrées en transit | Oui |
| Suppression des données | Dans l'application (Profil) et par l'URL de suppression (à créer) ; certaines données sont conservées par obligation légale (factures et registres 7 ans, documents 12 mois après la fin de la relation) : le préciser dans la fiche |
| Partage | Non au sens de Google : la position et le prénom montrés au client découlent de la course acceptée ; l'export de géolocalisation pseudonymisé est une obligation légale, exemptée de la déclaration de partage. À faire valider par l'avocat |

| Catégorie Google | Types | Facultatif | Finalités |
|---|---|---|---|
| Position | Position exacte et approximative, y compris en arrière-plan | Non (nécessaire pour travailler) | Fonctionnalité de l'application ; obligations légales |
| Informations personnelles | Nom, adresse e-mail, numéro de téléphone | Courriel facultatif | Fonctionnalité de l'application, gestion du compte |
| Informations personnelles | Autres informations (qualification, antécédents judiciaires, numéros de documents et de taxes, véhicule, langues) | Non | Fonctionnalité de l'application, prévention des fraudes et conformité |
| Informations financières | Autres informations financières (paiements acceptés, montants encaissés, courriel Interac) | Oui | Fonctionnalité de l'application |
| Photos et vidéos | Photos (documents, photo de profil) | Non | Fonctionnalité de l'application, conformité |
| Fichiers et documents | Documents PDF téléversés | Oui | Fonctionnalité de l'application, conformité |
| Messages | Autres messages dans l'application | Oui | Fonctionnalité de l'application |
| Activité dans les applications | Autres contenus générés par l'utilisateur (évaluations des clients, signalements, quiz) | Oui | Fonctionnalité de l'application |
| Appareil ou autres identifiants | Jeton de notification | Oui | Fonctionnalité de l'application |

## Justificatifs de la localisation en arrière-plan

### Déclaration Google Play (« Autorisations de localisation », `ACCESS_BACKGROUND_LOCATION`)

| Question de la console | Réponse proposée |
|---|---|
| Fonctionnalité principale qui utilise la localisation en arrière-plan | Réception des offres de course et suivi de la course par le client pendant que le chauffeur est en ligne |
| Pourquoi la localisation au premier plan ne suffit pas | Le chauffeur conduit avec Google Maps ou Waze au premier plan : l'application doit continuer à transmettre sa position écran verrouillé ou en arrière-plan, sinon il cesse de recevoir des offres et le client ne le voit plus approcher |
| L'utilisateur en est-il informé | Oui : écran d'explication avant la demande du système, notification permanente « Neomoov Chauffeur en ligne » tant que la position est partagée |
| Quand la collecte s'arrête | Dès le passage hors ligne : tâche arrêtée, file vidée, aucune position envoyée |
| Vidéo | Lien YouTube non répertorié (ci-dessous) |

### Notes pour l'examen (à coller dans App Store Connect et, traduites si besoin, dans la déclaration Google Play)

> Neomoov Driver is the app professional drivers use to receive and complete ride bookings. Background location is the core feature: while the driver is **online**, the app sends their location every 5 seconds (or 50 metres) so that (1) the dispatch can offer them the nearest bookings, (2) the client can see the driver approaching and (3) safety features (SOS) know where the driver is. Drivers typically navigate in Google Maps or Waze, so Neomoov Driver runs in the background during the ride. As soon as the driver goes **offline**, location updates stop completely and no location leaves the device. An in-app explanation screen is shown before the system permission prompt. On Android, a persistent foreground-service notification ("Neomoov Driver online") is displayed while location is shared.
>
> Demo account: phone number and fixed code in the "Sign-In Information" fields; the account is an approved driver with a vehicle and approved documents. Ride offers are only sent for bookings inside the Montréal service area: the attached video shows an offer being received and completed. Account deletion: Profile > "Delete my account".

Version française (fiche Google Play en français) : la justification de la section « Autorisations » ci-dessus.

### Vidéo de démonstration (à produire par le fondateur)

Exigée par Google Play pour `ACCESS_BACKGROUND_LOCATION` et utile pour Apple. Durée : 30 à 60 secondes, téléphone réel, build `preview`, compte de démonstration (aucune donnée personnelle réelle à l'écran).

1. Ouvrir l'application, se connecter avec le compte de démonstration.
2. Toucher « Passer en ligne » : montrer l'écran « Votre position, seulement en ligne », puis la demande système, choisir « Toujours autoriser » (iOS) ou « Autoriser tout le temps » (Android).
3. Montrer la notification persistante « Neomoov Chauffeur en ligne » (Android) ou l'indicateur bleu (iOS).
4. Passer sur Google Maps : l'offre arrive quand même (sonnerie), la toucher, accepter.
5. Revenir à l'accueil, toucher « Passer hors ligne » : la notification disparaît.

Mettre la vidéo en ligne (YouTube non répertorié) et en coller le lien dans la déclaration Google Play. Protocole d'essai sur appareil réel : `docs/testing/background-location.md`.

## Compte de démonstration

Les examinateurs ne reçoivent pas les textos. **Bloquant** : l'API n'a aucun mécanisme de code fixe pour un numéro de démonstration (`docs/beta/comptes-de-test.md`, section 3). Le compte à préparer : chauffeur actif, véhicule Neo Premium, documents approuvés marqués « SPÉCIMEN », formation certifiée, quelques courses terminées (revenus, relevé).

## Captures d'écran

Les captures de `docs/screens/driver/` viennent de la version web (même limite que pour l'application client : tailles refusées par les deux magasins). Les refaire sur appareils réels avec le compte de démonstration : accueil en ligne, offre, course acceptée, en route, fin de course, revenus, relevé, documents, formation, tableau de conduite.

## Builds (EAS)

| Profil | Distribution | API |
|---|---|---|
| `development` | Interne, client de développement | `http://10.0.2.2:4000` (émulateur Android vers l'API locale) |
| `preview` | Interne, APK Android | `https://api.neomoov.net` |
| `production` | Magasins, numéro de build incrémenté | `https://api.neomoov.net` |

Prérequis restants et procédure : `docs/runbooks/publication-mobile.md`, `docs/operations/acces-a-fournir.md` (section 7) et la vidéo de démonstration.
