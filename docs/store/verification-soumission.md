# Liste de vérification avant soumission aux magasins

Étape 16 (prompt 16, tâche 5). À cocher pour chaque application (client, chauffeur) avant une soumission à TestFlight externe, au test fermé Google Play ou à la production. Fiches : `client.md`, `driver.md`. Procédure de build : `docs/runbooks/publication-mobile.md`.

Légende de l'état au 26 septembre 2026 : **B** = bloquant aujourd'hui (manque dans le code ou chez un fournisseur), **F** = à faire par le fondateur, **C** = à faire par Claude sur demande.

## 1. Comptes et identifiants

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 1 | Compte Apple Developer (organisation) validé ; identifiants d'application créés avec leurs capacités | ☐ | ☐ | F |
| 2 | Compte Google Play Console (organisation) validé ; fiche d'application créée | ☐ | ☐ | F |
| 3 | Projet EAS créé et lié : `EAS_PROJECT_ID` déclaré dans les variables du projet EAS et posé dans le terminal (`docs/runbooks/publication-mobile.md`, section 4), ce qui active aussi les mises à jour à la volée et les notifications push ; `appleTeamId` et `ascAppId` remplis dans `eas.json` | ☐ | ☐ | C après 1 et 2 |
| 4 | Clés Google Maps iOS et Android dans les variables d'environnement du projet Expo | ☐ | ☐ | F |
| 5 | API de production en ligne et saine (`/v1/health`), fournisseurs réels branchés (Twilio indispensable à la connexion) | ☐ | ☐ | F et C |

## 2. Application elle-même

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 6 | Version affichée (`app.json`) à jour ; numéro de build incrémenté par EAS | ☐ | ☐ | |
| 7 | Build `production` installé et essayé sur un iPhone et un Android réels (parcours principaux) | ☐ | ☐ | |
| 8 | Suppression du compte accessible dans l'application (Profil) et fonctionnelle | ☐ | ☐ | Livrée |
| 9 | Aucune fonction visible qui ne marche pas : options de prépaiement (carte, Apple Pay, Google Pay, Interac) masquées tant que la feuille de paiement Stripe n'est pas branchée | ☐ | sans objet | B |
| 10 | Écran Assistance avec téléphone et courriel (réglages `support.phone`, `support.email` créés) | ☐ | ☐ | F |
| 11 | Modes d'arrière-plan iOS limités à ceux réellement utilisés : `location` et `audio` (sonnerie d'une offre) ; `fetch` et `remote-notification` retirés le 26 septembre 2026 (contrôle : `npx expo config --type introspect`, ligne `UIBackgroundModes`) ; justification du mode `audio` prête dans `driver.md` | sans objet | ☐ | Livré |
| 12 | Textes des demandes d'autorisation conformes à l'usage réel (localisation, appareil photo, photos) | ☐ | ☐ | Livrés |
| 13 | Connexion Apple ajoutée si une connexion Google est proposée (aujourd'hui : aucune des deux, pas d'obligation) | ☐ | ☐ | |

## 3. Revue

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 14 | Compte de démonstration utilisable sans texto (code fixe) avec des données de démonstration | ☐ | ☐ | B (mécanisme absent de l'API) |
| 15 | Notes pour l'examen collées (anglais), informations de connexion remplies (App Store) et « Accès aux applications » (Google Play) | ☐ | ☐ | Textes prêts dans les fiches |
| 16 | Vidéo de démonstration de la localisation en arrière-plan en ligne, lien dans la déclaration Google Play | sans objet | ☐ | F |
| 17 | Déclaration « Autorisations de localisation » remplie dans Google Play | sans objet | ☐ | Textes prêts |

## 4. Confidentialité et textes légaux

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 18 | Politique de confidentialité publiée, à jour (données, conservation, fournisseurs hors Québec, lieu des serveurs, droits), lien dans la fiche et dans l'application | ☐ | ☐ | F (avec l'avocat) |
| 19 | Conditions d'utilisation publiées | ☐ | ☐ | F |
| 20 | Étiquettes de confidentialité Apple remplies selon la fiche | ☐ | ☐ | Textes prêts |
| 21 | Formulaire « Sécurité des données » Google rempli selon la fiche | ☐ | ☐ | Textes prêts |
| 22 | URL de suppression de compte hors application déclarée à Google | ☐ | ☐ | F (page à créer ; la page `/droits` ne propose pas la suppression) |
| 23 | Décision sur l'option « mobilité réduite » (donnée sensible) | ☐ | sans objet | F |
| 24 | Descriptions sans promesse non tenue (paiement par carte, « données au Canada ») | ☐ | ☐ | Relues dans les fiches |

## 5. Fiche du magasin

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 25 | Nom, sous-titre, descriptions FR et EN, mots-clés | ☐ | ☐ | Textes prêts, à relire |
| 26 | Captures aux tailles exigées, faites sur appareils réels (les captures web de `docs/screens/` ne sont pas acceptées) | ☐ | ☐ | F ou C |
| 27 | Icône 1024 × 1024 sans transparence (Apple) et icône 512 × 512 (Google), bannière 1024 × 500 (Google) | ☐ | ☐ | À vérifier (`infra/scripts/make-app-icons.ps1`) |
| 28 | Classement (questionnaire d'âge, IARC) rempli | ☐ | ☐ | F |
| 29 | URL d'assistance et adresse de contact | ☐ | ☐ | F |
| 30 | Pays de diffusion : Canada (et seulement le Canada en V1) | ☐ | ☐ | F |

## 6. Après la soumission

| # | Point |
|---|---|
| 31 | Suivre l'état dans App Store Connect et Play Console ; répondre aux questions des examinateurs dans les 24 heures |
| 32 | En cas de refus : noter le motif et la règle citée dans le registre d'exploitation, corriger, soumettre de nouveau |
| 33 | Après acceptation : publication progressive, surveillance des plantages pendant 48 heures |
