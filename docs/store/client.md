# Fiche magasin : application client Neomoov

Préparée pour App Store Connect et Google Play Console (prompt 10, tâche 9). Les textes publics restent à relire par le fondateur avant soumission.

## Identité

| Élément | Valeur |
|---|---|
| Nom | Neomoov |
| Identifiant iOS et Android | `com.neomoov.client` |
| Catégorie | Voyages (App Store), Transports et navigation (Google Play) |
| Langues | Français (Canada), anglais |
| Slogan (D44) | « Neomoov, une application conçue par le client pour les chauffeurs. » |
| Site | https://neomoov.net |
| Conditions d'utilisation | https://neomoov.net/conditions-d-utilisation/ |
| Politique de confidentialité | https://neomoov.net/politique-de-confidentialite/ |
| Classement | 4+ (App Store), Tout public (Google Play) : aucun contenu sensible |
| Visuels (D46) | Captures réelles de l'application (`docs/screens/client/`), photos réelles ; aucune illustration dessinée |

## Autorisations demandées et justification

| Autorisation | Plateforme | Quand | Justification affichée |
|---|---|---|---|
| Localisation pendant l'utilisation | iOS (`NSLocationWhenInUseUsageDescription`), Android (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) | Au toucher de « Utiliser ma position », après une explication dans l'application | « Neomoov utilise votre position pendant l'utilisation de l'application, pour proposer votre adresse de départ. » |
| Localisation en arrière-plan | Aucune | Jamais | Refusée explicitement (`ACCESS_BACKGROUND_LOCATION` bloquée, `isIosBackgroundLocationEnabled: false`) |
| Notifications | iOS, Android 13 et plus | Après la connexion | Attribution du chauffeur, arrivée, rappels de réservation, messages |

Aucun accès aux contacts, photos, caméra, microphone ou calendrier en V1 (l'enregistrement à bord est prévu en V2, avec son propre consentement).

## Données collectées (étiquettes de confidentialité)

| Catégorie | Données | Finalité | Liée à l'identité | Suivi publicitaire |
|---|---|---|---|---|
| Coordonnées | Numéro de téléphone (obligatoire), courriel et nom (facultatifs) | Compte, connexion par code SMS, reçus, assistance | Oui | Non |
| Localisation | Position précise pendant l'utilisation seulement | Adresse de départ | Oui | Non |
| Achats | Historique des courses, montants | Réservation, facturation, assistance | Oui | Non |
| Informations financières | Aucune stockée par Neomoov (paiement par Stripe à l'étape 7) | Paiement | Non | Non |
| Contenu | Messages au chauffeur, évaluations, demandes spéciales | Service, qualité | Oui | Non |
| Identifiants | Jeton de notification de l'appareil | Notifications | Oui | Non |
| Diagnostics | Rapports de plantage (Sentry, quand il sera branché) | Stabilité | Non | Non |

Aucune donnée n'est vendue ni utilisée pour le suivi publicitaire. Données hébergées au Canada (base Supabase, région Canada central). Exercice des droits (Loi 25) dans l'application : copie des données (Profil), retrait des consentements, suppression du compte.

## Exigences des magasins

- **Suppression du compte dans l'application** : Profil, « Supprimer mon compte » (`DELETE /v1/me`), accès coupé immédiatement.
- **Sign in with Apple** : exigé sur iOS dès qu'une connexion tierce (Google) est proposée ; l'API la prend en charge (`POST /v1/auth/apple`), le bouton sera ajouté avec les identifiants Apple (compte Developer en validation).
- **Compte de démonstration pour l'examen** : numéro de test et code fixes à créer avant la soumission (l'examinateur ne reçoit pas les textos).
- **Paiement** : les courses sont des services physiques, hors achats intégrés ; Stripe est permis.

## Builds (EAS)

| Profil | Distribution | API |
|---|---|---|
| `development` | Interne, client de développement | `http://10.0.2.2:4000` (émulateur Android vers l'API locale) |
| `preview` | Interne, APK Android | `https://api.neomoov.net` |
| `production` | Magasins, numéro de build incrémenté | `https://api.neomoov.net` |

Prérequis restants (fondateur) : projet EAS lié (`eas init`, `extra.eas.projectId`, qui active aussi les notifications push), comptes Apple Developer et Google Play validés, clés Google Maps Android et iOS restreintes fournies au build (`GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_MAPS_IOS_KEY`, voir `app.config.ts`), API déployée sur `api.neomoov.net`.
