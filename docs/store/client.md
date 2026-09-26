# Fiche magasin : application client Neomoov

Préparée pour App Store Connect et Google Play Console (prompt 10, tâche 9 ; complétée à l'étape 16, prompt 16, tâche 5). Les textes publics restent à relire par le fondateur avant soumission. Les étiquettes de confidentialité ci-dessous sont alignées sur ce que le code de l'application collecte réellement au 26 septembre 2026 ; elles doivent être revues à chaque version qui ajoute une donnée (paiement par carte, Sentry, connexion Apple ou Google). Liste de vérification de soumission : `verification-soumission.md`.

## Identité

| Élément | Valeur |
|---|---|
| Nom | Neomoov |
| Sous-titre App Store (30 caractères au plus) | FR : « Voiture avec chauffeur, MTL » ; EN : « Chauffeured rides, Montréal » |
| Identifiant iOS et Android | `com.neomoov.client` |
| Catégorie | Voyages (App Store) ; Cartes et navigation (Google Play, choix fait à la création de la fiche) |
| Langues | Français (Canada), anglais |
| Slogan (D44) | « Neomoov, une application conçue par le client pour les chauffeurs. » |
| Site | https://neomoov.net |
| Assistance (URL exigée par Apple) | Page d'assistance de neomoov.net avec téléphone et courriel : **à créer ou à confirmer** |
| Conditions d'utilisation | https://neomoov.net/conditions-d-utilisation/ |
| Politique de confidentialité | https://neomoov.net/politique-de-confidentialite/ (doit décrire les données du tableau plus bas, la conservation, les fournisseurs hors Québec et les droits Loi 25) |
| Suppression de compte hors de l'application (exigée par Google) | https://reserver.neomoov.net/supprimer-mon-compte : démarche, données supprimées et conservées, suppression après vérification du numéro par texto (FR et EN par le sélecteur de langue ; recours par courriel à l'assistance pour qui ne reçoit plus les textos) |
| Classement | 4+ (App Store) ; questionnaire IARC de Google : aucun contenu sensible, communications entre utilisateurs (messagerie avec le chauffeur) |
| Visuels (D46) | Captures réelles de l'application, photos réelles ; aucune illustration dessinée |

## Descriptions

### Français

Description courte (Google Play, 80 caractères au plus) :

> Réservez une voiture électrique avec chauffeur à Montréal, à prix fixe.

Texte promotionnel (App Store, 170 caractères au plus) :

> Prix fixe tout compris annoncé avant de réserver, véhicules électriques récents, chauffeurs professionnels de Montréal.

Description complète :

> Neomoov, une application conçue par le client pour les chauffeurs.
>
> Réservez votre course à Montréal au moins deux heures à l'avance et jusqu'à 30 jours, au prix fixe annoncé avant de confirmer : taxes, frais et redevance compris, sans majoration surprise.
>
> Choisissez votre catégorie :
> • Neo Premium : berline ou VUS électrique récent, quatre places.
> • Neo Prestige : haut de gamme, intérieur soigné, silence à bord.
> • Neo XL : jusqu'à six passagers et leurs bagages.
>
> Précisez vos préférences : conversation ou silence, musique, température, aide aux bagages, siège d'enfant, accessibilité. Réservez pour un proche : il reçoit le lien de suivi par texto. Suivez votre chauffeur en direct, écrivez-lui sans échanger vos numéros, partagez votre trajet, et utilisez le bouton d'urgence en cas de besoin.
>
> Vous payez votre chauffeur à la fin de la course, puis vous l'évaluez et laissez un pourboire si vous le souhaitez.
>
> Vous gardez la main sur vos données : copie de vos données, retrait de vos consentements et suppression du compte depuis votre profil.

### English

Short description (Google Play, 80 characters max):

> Book an electric car with a professional driver in Montréal, at a fixed price.

Promotional text (App Store, 170 characters max):

> All-inclusive fixed price shown before you book, recent electric vehicles, professional drivers in Montréal.

Full description:

> Neomoov, an app designed by riders for drivers.
>
> Book your ride in Montréal at least two hours ahead and up to 30 days in advance, at the fixed price shown before you confirm: taxes, fees and the regulatory charge included, with no surprise surge.
>
> Choose your category:
> • Neo Premium: recent electric sedan or SUV, four seats.
> • Neo Prestige: high-end, refined interior, quiet ride.
> • Neo XL: up to six passengers and their luggage.
>
> Set your preferences: chat or quiet, music, temperature, help with luggage, child seat, accessibility. Book for someone else: they get the tracking link by text message. Follow your driver live, message them without sharing phone numbers, share your trip, and use the emergency button if needed.
>
> You pay your driver at the end of the ride, then rate them and leave a tip if you wish.
>
> You stay in control of your data: copy of your data, consent withdrawal and account deletion from your profile.

Mots-clés App Store (100 caractères au plus, séparés par des virgules) : FR « chauffeur,voiture,montréal,réservation,électrique,prix fixe,aéroport,course,transport » ; EN « driver,car,montreal,booking,electric,fixed price,airport,ride,chauffeur ».

Points à vérifier avant publication : ne pas écrire « vos données restent au Canada » : c'est vrai pour la base et les documents (Supabase, Montréal), pas pour les serveurs applicatifs et les sauvegardes du serveur, en France tant que la migration n'est pas faite (`docs/operations/migration-canada.md`), ni pour plusieurs fournisseurs situés aux États-Unis. Quand le paiement par carte sera branché (feuille de paiement Stripe), ajouter « carte, Apple Pay, Google Pay » au paragraphe du paiement ; ne pas l'annoncer avant.

## Autorisations demandées et justification

| Autorisation | Plateforme | Quand | Justification affichée (texte réel de `app.json`) |
|---|---|---|---|
| Localisation pendant l'utilisation | iOS (`NSLocationWhenInUseUsageDescription`), Android (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) | Au toucher de « Utiliser ma position », après une explication dans l'application | « Neomoov utilise votre position pendant l'utilisation de l'application, pour proposer votre adresse de départ. / Neomoov uses your location while you use the app, to suggest your pickup address. » |
| Localisation en arrière-plan | Aucune | Jamais | Refusée explicitement (`ACCESS_BACKGROUND_LOCATION` bloquée, `isIosBackgroundLocationEnabled: false`) |
| Notifications | iOS, Android 13 et plus | Après la connexion | Attribution du chauffeur, arrivée, rappels de réservation, messages |

Aucun accès aux contacts, aux photos, à l'appareil photo, au microphone ni au calendrier en V1 (l'enregistrement à bord est prévu en V2, avec son propre consentement).

## Données réellement collectées par l'application (V1)

Relevé dans le code (`apps/mobile-client/src`, schémas de `packages/domain`) :

| Donnée | Écran | Obligatoire | Envoyée à |
|---|---|---|---|
| Numéro de téléphone | Connexion | Oui | API (compte), Twilio (code SMS) |
| Langue | Profil | Oui (par défaut, langue du téléphone) | API |
| Consentements (géolocalisation, marketing), acceptation des conditions | Consentements, profil | Conditions : oui | API |
| Position précise, sur demande | Réservation (« Utiliser ma position ») | Non | API, Google Maps (adresse la plus proche) |
| Adresses de départ, d'arrivée et d'arrêts, lieux enregistrés | Réservation, profil | Départ et arrivée : oui | API, Google Maps (saisie et itinéraire) |
| Nom et téléphone d'un passager tiers | Réservation, « Je réserve pour quelqu'un d'autre » | Non | API, Twilio (texto de suivi au passager) |
| Préférences de confort, dont **accessibilité (mobilité réduite)**, siège d'enfant, bagages | Réservation, profil | Non | API, chauffeur de la course |
| Demandes spéciales, numéro de vol | Réservation | Non | API, chauffeur |
| Messages au chauffeur | Course | Non | API, chauffeur |
| Messages à l'assistance | Assistance (conversation avec l'agent relation client, relais humain au besoin) | Non | API, Anthropic (modèle de langage de l'agent), équipe Neomoov |
| Évaluation, étiquettes, commentaire, pourboire | Fin de course | Non | API |
| Historique des courses et montants | Réservations | Oui (effet du service) | API |
| Jeton de notification de l'appareil | Automatique après connexion | Non (refus possible) | API, Expo |
| Identifiant de compte | Automatique | Oui | API |

Non collectés par l'application aujourd'hui : nom et courriel du client lui-même (l'API les accepte, aucun écran ne les demande ; conséquence : la facture, envoyée par courriel, n'atteint pas un client sans courriel ; elle reste consultable dans l'application, Profil ou Historique, « Mes factures », depuis le 26 septembre 2026), données de carte (feuille de paiement Stripe non branchée), rapports de plantage (Sentry est branché dans l'application mais inactif tant que `EXPO_PUBLIC_SENTRY_DSN` n'est pas posé dans le projet EAS ; dès qu'il l'est, déclarer « Diagnostics, Données de plantage », non lié à l'identité, section suivante), statistiques d'usage, identifiant publicitaire.
## Étiquettes de confidentialité Apple (App Privacy)

Réponse générale : « Oui, nous collectons des données ». Aucune donnée n'est utilisée pour le suivi (tracking) : répondre « Non » partout à la question du suivi.

| Type de données Apple | Collecté | Lié à l'identité | Finalités |
|---|---|---|---|
| Coordonnées : Numéro de téléphone | Oui | Oui | Fonctionnalité de l'app |
| Coordonnées : Nom (passager tiers) | Oui | Oui | Fonctionnalité de l'app |
| Coordonnées : Adresse physique (lieux enregistrés) | Oui | Oui | Fonctionnalité de l'app |
| Localisation : Position précise | Oui | Oui | Fonctionnalité de l'app |
| Données sensibles (handicap : option « mobilité réduite ») | Oui, si l'option reste dans l'application | Oui | Fonctionnalité de l'app |
| Achats : Historique d'achats (courses) | Oui | Oui | Fonctionnalité de l'app |
| Contenu utilisateur : Autre contenu (messages au chauffeur, évaluations, commentaires, demandes spéciales) | Oui | Oui | Fonctionnalité de l'app |
| Contenu utilisateur : Assistance client (conversation de l'écran Assistance) | Oui | Oui | Fonctionnalité de l'app |
| Identifiants : Identifiant d'utilisateur | Oui | Oui | Fonctionnalité de l'app |
| Identifiants : Identifiant de l'appareil (jeton de notification) | Oui | Oui | Fonctionnalité de l'app |
| Informations financières, Contacts, Santé, Historique de navigation, Historique de recherche, Données d'utilisation, Diagnostics | Non (V1) | | |

Décision à prendre par le fondateur : l'option « mobilité réduite » relève de la catégorie « Données sensibles » d'Apple (handicap). La déclarer, ou la remplacer par une formulation neutre qui ne décrit pas l'état de la personne (par exemple « véhicule accessible souhaité »), avec l'avis de l'avocat (Loi 25 : renseignement sensible).

À ajouter quand ce sera actif : Informations financières, Informations de paiement (feuille de paiement Stripe, selon le guide de confidentialité publié par Stripe) ; Diagnostics, Données de plantage (Sentry, non lié ; le code est branché, il s'active avec `EXPO_PUBLIC_SENTRY_DSN`).

## Sécurité des données Google Play (Data safety)

| Question | Réponse |
|---|---|
| Collecte ou partage de données | Oui, collecte |
| Données chiffrées en transit | Oui (HTTPS, TLS 1.2 au moins) |
| Moyen de demander la suppression des données | Oui : dans l'application (Profil, « Supprimer mon compte ») et par l'URL de suppression https://reserver.neomoov.net/supprimer-mon-compte |
| Partage avec des tiers | Non au sens de Google : les fournisseurs (Twilio, Google Maps, Expo, hébergeurs) traitent pour le compte de Neomoov, et la transmission au chauffeur ou au passager tiers découle d'une action de l'utilisateur (réservation). À faire valider par l'avocat |

| Catégorie Google | Type | Collecté | Facultatif | Finalités |
|---|---|---|---|---|
| Position | Position approximative, position exacte | Oui | Oui | Fonctionnalité de l'application |
| Informations personnelles | Numéro de téléphone | Oui | Non | Fonctionnalité de l'application, gestion du compte |
| Informations personnelles | Nom (passager tiers), adresse (lieux enregistrés) | Oui | Oui | Fonctionnalité de l'application |
| Informations personnelles | Autres informations (préférences de confort, accessibilité) | Oui | Oui | Fonctionnalité de l'application |
| Informations financières | Historique d'achats | Oui | Non | Fonctionnalité de l'application |
| Messages | Autres messages dans l'application (messages au chauffeur, conversation avec l'assistance) | Oui | Oui | Fonctionnalité de l'application |
| Activité dans les applications | Autres contenus générés par l'utilisateur (évaluations, commentaires, demandes spéciales) | Oui | Oui | Fonctionnalité de l'application |
| Appareil ou autres identifiants | Jeton de notification | Oui | Oui | Fonctionnalité de l'application |

## Exigences des magasins

- **Suppression du compte dans l'application** : Profil, « Supprimer mon compte » (`DELETE /v1/me`), accès coupé immédiatement, anonymisation par le worker.
- **Suppression hors de l'application (Google Play)** : URL à déclarer dans la console (Règles, « Suppression des données ») : https://reserver.neomoov.net/supprimer-mon-compte (livrée le 26 septembre 2026). La page nomme les deux applications, donne la démarche (numéro du compte, code par texto, confirmation), ce qui est supprimé et ce qui est conservé avec les durées (courses sans coordonnées, adresses anonymisées après 12 mois, factures émises 7 ans sans modification, relevés et documents des chauffeurs), et un recours par courriel (réglage `support.email`) pour qui ne reçoit plus les textos. La suppression passe par `DELETE /v1/me` comme dans l'application : accès coupé tout de suite, anonymisation par le worker. La page `/droits` y renvoie aussi. Limite connue : la suppression n'annule pas les réservations à venir (la page demande de les annuler d'abord).
- **Sign in with Apple** : exigé seulement si une connexion tierce (Google) est proposée. En V1, l'application ne propose que la connexion par code SMS : pas d'obligation tant qu'aucun bouton Google n'est ajouté. L'API gère déjà Apple et Google (`POST /v1/auth/apple`, `/v1/auth/google`).
- **Compte de démonstration pour l'examen** : l'examinateur ne reçoit pas les textos. Mécanisme livré le 26 septembre 2026 : les numéros listés dans `REVIEW_PHONES` (serveur de production) reçoivent toujours le code fixe `REVIEW_OTP_CODE`, sans texto ; tout autre numéro suit la règle normale. Le numéro et le code se saisissent dans les « Sign-In Information » d'App Store Connect et l'« Accès aux applications » de Google Play, nulle part ailleurs. Compte à préparer sur la production et retrait des deux variables après la publication : `docs/beta/comptes-de-test.md`, section 3.
- **Paiement** : les courses sont des services physiques, hors achats intégrés ; Stripe est permis.
- **Options de paiement** : depuis le 26 septembre 2026, l'application (écran 3 de la réservation) et la réservation web n'affichent que les modes renvoyés par le devis (`paymentMethods`) : l'API retire la carte, Apple Pay et Google Pay quand le paiement réel n'est pas configuré en production, et ne propose le paiement au chauffeur (espèces, Interac, terminal) que si des chauffeurs l'acceptent. Reste à faire avant d'ouvrir la carte : l'application n'a aucun écran d'ajout de carte (feuille de paiement Stripe) ; tant qu'il manque, garder le paiement par carte fermé en production, sinon un prépaiement échoue (« Aucune carte enregistrée »).
- **Coordonnées d'assistance** : l'écran Assistance affiche une conversation avec l'agent relation client, puis le téléphone et le courriel des réglages `support.phone` et `support.email`, créés vides par les données de départ et masqués tant qu'ils le restent : à remplir dans My Hub, **Paramètres**, avant la soumission.

## Notes pour l'examen (App Review, à coller en anglais)

> Neomoov is a pre-booked chauffeured ride service in Montréal, Canada. Rides must be booked at least 2 hours in advance; the app shows an all-inclusive fixed price before the user confirms. Rides are physical services, paid to the driver at the end of the ride (no digital goods, no in-app purchase).
>
> Sign-in is by SMS code only. Demo account: phone number and fixed code provided in the "Sign-In Information" fields. The demo account has one past ride and one upcoming booking.
>
> Location is requested only while the app is in use, when the user taps "Use my location" to fill the pickup address. The app never uses background location.
>
> Account deletion: Profile > "Delete my account", or without the app at https://reserver.neomoov.net/supprimer-mon-compte. Data export and consent withdrawal are in Profile as well (Québec privacy law, Law 25). Invoices: Profile (or History) > "My invoices".

Pour Google Play, section « Accès aux applications » : mêmes informations de connexion, en indiquant que la connexion se fait par code SMS et que le code de démonstration est fixe.

## Captures d'écran

Les captures de `docs/screens/client/` viennent de la version web (780 × 1688 pixels) : elles servent de modèle, mais ne sont acceptées ni par Apple (tailles imposées, par exemple 1320 × 2868 pour l'iPhone 6,9 pouces) ni par Google (le grand côté ne doit pas dépasser le double du petit). Tailles exactes et procédure : `verification-soumission.md`, section 7. Les refaire sur un iPhone et un Android réels à partir d'un build TestFlight ou `preview`, avec le compte de démonstration : accueil, choix de l'heure, catégories et prix, préférences, récapitulatif, suivi en direct, évaluation, profil et droits. Aucune donnée personnelle réelle à l'écran.

## Builds (EAS)

| Profil | Distribution | API |
|---|---|---|
| `development` | Interne, client de développement | `http://10.0.2.2:4000` (émulateur Android vers l'API locale) |
| `preview` | Interne, APK Android | `https://api.neomoov.net` |
| `production` | Magasins, numéro de build incrémenté | `https://api.neomoov.net` |

Prérequis restants et procédure : `docs/runbooks/publication-mobile.md` et `docs/operations/acces-a-fournir.md`, section 7.
