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
| 9 | Aucune fonction visible qui ne marche pas : l'application et la réservation web n'affichent que les modes renvoyés par le devis (livré le 26 septembre 2026) ; vérifier sur l'API de production que le devis ne contient ni `card_app` ni `apple_pay` ni `google_pay` tant que la feuille de paiement Stripe (ajout de carte) n'existe pas dans l'application, et que `GET /v1/config` donne `features.cardPayments` à faux | ☐ | sans objet | C (code livré), F (réglage de production) |
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
| 22 | URL de suppression de compte hors application déclarée à Google : https://reserver.neomoov.net/supprimer-mon-compte (démarche, données supprimées et conservées, confirmation après code par texto) ; vérifier qu'elle s'ouvre en production avant la déclaration | ☐ | ☐ | Page livrée le 26 septembre 2026 ; F (déclaration dans la console) |
| 23 | Décision sur l'option « mobilité réduite » (donnée sensible) | ☐ | sans objet | F |
| 24 | Descriptions sans promesse non tenue (paiement par carte, « données au Canada ») | ☐ | ☐ | Relues dans les fiches |

## 5. Fiche du magasin

| # | Point | Client | Chauffeur | État |
|---|---|---|---|---|
| 25 | Nom, sous-titre, descriptions FR et EN, mots-clés | ☐ | ☐ | Textes prêts, à relire |
| 26 | Captures aux tailles exigées (section 7), faites de préférence sur appareil réel ou simulateur (les captures web de `docs/screens/`, 780 × 1688, ne sont pas acceptées) | ☐ | ☐ | F ou C (procédure en section 7) |
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

## 7. Captures d'écran : tailles exigées et procédure

État au 26 septembre 2026 : les captures de `docs/screens/client/` (16) et `docs/screens/driver/` (36) font 780 × 1688 pixels (version web, écran de 390 × 844 à 2x). Apple les refuse (taille absente de sa liste) et Google aussi (grand côté égal à 2,16 fois le petit, au-delà de 2). Aucune capture aux bonnes tailles n'a été produite : le parcours web qui les fabrique exige une API locale branchée sur une base de données, ce qui n'était pas faisable proprement pendant le travail en parallèle sur la base de développement partagée, et la version web diffère de l'application native sur plusieurs écrans (voir la procédure B).

### Tailles exigées (vérifiées le 26 septembre 2026 sur les pages d'Apple et de Google)

| Magasin | Emplacement | Tailles acceptées, en portrait (pixels) | Obligatoire | Nombre | Format |
|---|---|---|---|---|---|
| App Store | iPhone 6,9 pouces (iPhone 16 Pro Max, 15 Pro Max, 14 Pro Max, 16 Plus, 15 Plus) | **1320 × 2868** (conseillée), 1290 × 2796, 1260 × 2736 | Un jeu 6,9 pouces ou un jeu 6,5 pouces est obligatoire ; le jeu 6,9 pouces suffit, Apple le réduit pour les autres iPhone | 1 à 10 | PNG ou JPEG, RVB, sans couche alpha ni transparence |
| App Store | iPhone 6,5 pouces (iPhone 11 Pro Max, XS Max, 14 Plus, 13 Pro Max, 12 Pro Max) | 1242 × 2688, 1284 × 2778 | Seulement si aucun jeu 6,9 pouces n'est fourni | 1 à 10 | Idem |
| App Store | iPad | Sans objet : `supportsTablet` vaut `false` dans les deux applications | | | |
| Google Play | Téléphone | Chaque côté entre 320 et 3 840 ; le grand côté au plus le double du petit. **1080 × 1920** (9:16) conseillée | Au moins 2 ; au moins 4 d'au moins 1080 pixels de large pour être mis en avant | 2 à 8 | PNG 24 bits sans alpha, ou JPEG ; 8 Mo au plus |
| Google Play | Image de présentation | 1024 × 500 | Oui | 1 | PNG 24 bits sans alpha, ou JPEG |

Conséquence pratique : un jeu **1320 × 2868** pour l'App Store et un jeu **1080 × 1920** pour Google Play, par application et par langue (français, anglais). Les captures d'un téléphone Android récent (1080 × 2400, rapport 2,22) sont refusées telles quelles.

Écrans à montrer (4 à 8 par application, aucune donnée personnelle réelle, compte de démonstration) : client : accueil, choix de l'heure, catégories et prix, commodités, récapitulatif, suivi en direct, profil et droits, Mes factures ; chauffeur : accueil en ligne, offre, course en cours, fin de course, revenus, relevé, documents, tableau de conduite.

### Procédure A (conseillée) : appareil réel ou simulateur

C'est l'application réelle (carte, barre d'état, polices natives), ce qu'Apple attend (règle 2.3.3 : les captures montrent l'application en usage) et ce que demande D46 (captures réelles).

- **iPhone** : build TestFlight ou `preview` sur un iPhone 16 Pro Max ou 15 Pro Max (capture par bouton latéral et volume haut : 1320 × 2868 ou 1290 × 2796, acceptées telles quelles). Sans ces appareils : simulateur « iPhone 16 Pro Max » de Xcode (Mac nécessaire, absent du poste), capture par `xcrun simctl io booted screenshot capture.png`.
- **Android** : émulateur d'Android Studio avec un profil 1080 × 1920 (par exemple « Pixel 2 », ou un profil matériel personnalisé à 1080 × 1920), build `preview` installé par `adb install`, capture par `adb exec-out screencap -p > capture.png`. Un téléphone réel plus allongé exige de recadrer à 1080 × 1920.

### Procédure B (sans Mac ni téléphone) : parcours web de démonstration à la bonne taille

Les scripts `apps/mobile-client/e2e/web-journeys.cjs` et `apps/mobile-driver/e2e/web-journeys.cjs` acceptent la variable `SHOT_DEVICE` (`scripts/e2e/cdp.cjs`) : `iphone-6.9` (écran de 440 × 956 à 3x, soit 1320 × 2868), `iphone-6.5` (414 × 896 à 3x, soit 1242 × 2688), `android` (360 × 640 à 3x, soit 1080 × 1920) ; sans elle, 780 × 1688 comme avant. Dimensions et absence de couche alpha vérifiées le 26 septembre 2026 avec Edge sans interface.

1. Base : une base de démonstration réservée à cet usage, ou un créneau convenu où personne d'autre n'utilise la base de développement (le parcours crée des comptes, des courses et valide un chauffeur).
2. Prérequis de chaque script (en tête de fichier) : API locale en développement avec son journal dans un fichier, export web (`npx expo export --platform web`) servi sur le port 8081.
3. Dans `apps\mobile-client` (puis `apps\mobile-driver`), PowerShell :
   ```
   $env:API_LOG = "<journal de l'API>"
   $env:SHOT_DEVICE = "iphone-6.9"; node e2e/web-journeys.cjs ..\..\docs\store\captures\client\iphone-6.9
   $env:SHOT_DEVICE = "android"; node e2e/web-journeys.cjs ..\..\docs\store\captures\client\android
   ```
4. Garder 4 à 8 captures par jeu, en retirant celles qui montrent la carte (la version web affiche un encadré à la place de la carte interactive : `RideMap.web.tsx`), et les refaire par la procédure A. La version anglaise : même parcours après bascule de la langue (les scripts cliquent sur les libellés français : à adapter, ou captures anglaises par la procédure A).
5. Contrôle des dimensions avant envoi : `node -e "const b=require('fs').readFileSync(process.argv[1]);console.log(b.readUInt32BE(16)+'x'+b.readUInt32BE(20))" <fichier.png>`.

Risque de la procédure B : la version web n'est pas l'application native (pas de barre d'état, carte remplacée, rendu des polices différent). Apple peut refuser des captures qui ne correspondent pas à l'application (règle 2.3.3) ; les réserver à Google Play ou à un premier dépôt, puis les remplacer par la procédure A.
