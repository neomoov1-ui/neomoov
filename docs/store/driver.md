# Fiche magasin : application Neomoov Chauffeur

Préparée pour App Store Connect et Google Play Console (prompt 11, tâche 9). Les textes publics restent à relire par le fondateur avant soumission. La vidéo de démonstration de la localisation en arrière-plan est à produire par le fondateur (voir plus bas).

## Identité

| Élément | Valeur |
|---|---|
| Nom | Neomoov Chauffeur |
| Identifiant iOS et Android | `com.neomoov.driver` |
| Catégorie | Affaires (App Store), Transports et navigation (Google Play) |
| Langues | Français (Canada), anglais |
| Public | Chauffeurs professionnels de Neomoov (autorisés par la SAAQ ou inscrits auprès d'un répondant) |
| Site | https://neomoov.net |
| Conditions d'utilisation | https://neomoov.net/conditions-d-utilisation/ |
| Politique de confidentialité | https://neomoov.net/politique-de-confidentialite/ |
| Classement | 4+ (App Store), Tout public (Google Play) |
| Visuels (D46) | Captures réelles de l'application (`docs/screens/driver/`) ; aucune illustration dessinée |

## Autorisations demandées et justification

| Autorisation | Plateforme | Quand | Justification affichée |
|---|---|---|---|
| Localisation pendant l'utilisation | iOS (`NSLocationWhenInUseUsageDescription`), Android (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) | Au premier passage en ligne, après l'écran d'explication de l'application | « Neomoov Chauffeur utilise votre position quand vous êtes en ligne, pour vous proposer des courses proches et montrer au client où vous êtes. » |
| Localisation en arrière-plan (« Toujours ») | iOS (`NSLocationAlwaysAndWhenInUseUsageDescription`, mode `location` de `UIBackgroundModes`), Android (`ACCESS_BACKGROUND_LOCATION`, service de premier plan `FOREGROUND_SERVICE_LOCATION`) | Juste après, avec la même explication | « Quand vous êtes en ligne, Neomoov Chauffeur envoie votre position toutes les 5 secondes, même écran verrouillé ou application en arrière-plan, pour recevoir des offres et suivre vos courses. Hors ligne, aucune position n'est envoyée. » |
| Appareil photo | iOS (`NSCameraUsageDescription`), Android (`CAMERA`) | Au toucher de « Prendre une photo » d'un document | Photographier les documents (permis, assurance, immatriculation) ; en V1.1, vérification faciale en début de quart si elle est activée |
| Photos | iOS (`NSPhotoLibraryUsageDescription`) | Au toucher de « Choisir une photo » | Joindre un document déjà photographié |
| Notifications | iOS, Android 13 et plus | Après la connexion | Offres de course (canal prioritaire, son distinct), courses planifiées, relevés, échéances de documents, packs |
| Vibration, maintien de l'écran | Android (`VIBRATE`, `WAKE_LOCK`) | Pendant une offre et une course | Sonnerie et vibration de l'offre ; écran allumé sur le support pendant la course |

Aucun accès aux contacts, au microphone ni au calendrier.

## Données collectées (étiquettes de confidentialité)

| Catégorie | Données | Finalité | Liée à l'identité | Suivi publicitaire |
|---|---|---|---|---|
| Coordonnées | Téléphone, nom, courriel | Compte, connexion par code SMS, relevés, assistance | Oui | Non |
| Localisation | Position précise, en ligne seulement (y compris en arrière-plan) | Offres de course, suivi par le client, tableau de conduite, obligations de conservation (90 jours) | Oui | Non |
| Identifiants gouvernementaux | Numéros de TPS et TVQ, numéros de documents (permis, assurance) | Conformité du transport rémunéré de personnes, factures | Oui | Non |
| Photos | Documents et, en V1.1, photo du visage (vérification faciale, sous consentement biométrique) | Vérification du dossier | Oui | Non |
| Informations financières | Compte de versement géré par Stripe Connect (Neomoov ne stocke pas les coordonnées bancaires) | Versements hebdomadaires | Oui | Non |
| Contenu | Messages au client, évaluations, signalements d'incident | Service, sécurité | Oui | Non |
| Identifiants | Jeton de notification de l'appareil | Notifications | Oui | Non |
| Diagnostics | Rapports de plantage (Sentry, quand il sera branché) | Stabilité | Non | Non |

Aucune donnée vendue ni utilisée pour le suivi publicitaire. Retrait du consentement de géolocalisation dans Profil, avec sa conséquence expliquée (plus de passage en ligne) ; copie des données et suppression du compte dans l'application (Loi 25).

## Notes pour l'examen (Apple App Review et Google Play)

### Localisation en arrière-plan (à coller dans « Notes » d'App Store Connect et dans la déclaration « Location permissions » de Google Play)

> Neomoov Driver is the app professional drivers use to receive and complete ride bookings. Background location is the core feature: while the driver is **online**, the app sends their location every 5 seconds (or 50 metres) so that (1) the dispatch can offer them the nearest bookings, (2) the client can see the driver approaching and (3) safety features (SOS) know where the driver is. Drivers typically navigate in Google Maps or Waze, so Neomoov Driver runs in the background during the ride. As soon as the driver goes **offline**, location updates stop completely and no location leaves the device. An in-app explanation screen is shown before the system permission prompt. On Android, a persistent foreground-service notification ("Neomoov Driver online") is displayed while location is shared.

Version française (Google Play, fiche en français) : même texte traduit, fourni ci-dessus dans la justification.

### Vidéo de démonstration (à produire par le fondateur)

Exigée par Google Play pour `ACCESS_BACKGROUND_LOCATION` et utile pour Apple. Durée : 30 à 60 secondes, téléphone réel, build `preview`.

1. Ouvrir l'application, se connecter avec le compte de démonstration.
2. Toucher « Passer en ligne » : montrer l'écran « Votre position, seulement en ligne », puis la demande système, choisir « Toujours autoriser » (iOS) ou « Autoriser tout le temps » (Android).
3. Montrer la notification persistante « Neomoov Chauffeur en ligne » (Android) ou l'indicateur bleu (iOS).
4. Passer sur Google Maps : l'offre arrive quand même (sonnerie), la toucher, accepter.
5. Revenir à l'accueil, toucher « Passer hors ligne » : la notification disparaît.

Mettre la vidéo en ligne (YouTube non répertorié) et en coller le lien dans la déclaration Google Play.

### Compte de démonstration

Les examinateurs ne reçoivent pas les textos : créer avant la soumission un numéro de démonstration avec un code fixe (réglage à prévoir côté API, étape 16) et un chauffeur déjà validé, avec des courses de démonstration.

## Builds (EAS)

| Profil | Distribution | API |
|---|---|---|
| `development` | Interne, client de développement | `http://10.0.2.2:4000` (émulateur Android vers l'API locale) |
| `preview` | Interne, APK Android | `https://api.neomoov.net` |
| `production` | Magasins, numéro de build incrémenté | `https://api.neomoov.net` |

Prérequis restants (fondateur) : projet EAS lié (`eas init` dans `apps/mobile-driver`, qui active aussi les notifications push), comptes Apple Developer et Google Play validés, clés Google Maps Android et iOS restreintes fournies au build (`GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_MAPS_IOS_KEY`, voir `app.config.ts`), API déployée sur `api.neomoov.net`, vidéo de démonstration.
