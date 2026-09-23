# Partie C. Amendements v1.1 aux prompts (23 septembre 2026)

Décisions du fondateur D31 à D47 (document de référence v1.1, section 0.5). Ces amendements s'appliquent en plus des prompts 00 à 17 ; en cas de contradiction, l'amendement l'emporte. Lis ce fichier avec chaque prompt concerné avant de commencer une étape.

## Règles transversales

- **Préavis de 2 heures (D32).** En V1, toute course est réservée au moins 2 heures avant l'heure de prise en charge et jusqu'à 30 jours à l'avance. Réglage `rides.min_lead_seconds` = 7200. Aucune course « maintenant » : drapeau `FEATURE_IMMEDIATE_RIDES` désactivé, code d'erreur `LEAD_TIME_TOO_SHORT`, message « Réservez au moins 2 heures à l'avance ». Les textes d'interface ne parlent jamais de « course immédiate » en V1.
- **Slogan commercial (D44).** « Neomoov, une application conçue par le client pour les chauffeurs. » sur l'écran d'accueil des deux applications et dans les courriels de bienvenue.
- **Visuels (D46).** Aucune illustration dessinée : photos réelles (voitures de luxe de dernière génération, clients souriants) ou captures réelles de l'application. Crédits dans `docs/design/credits-photos.md`. Les pictogrammes d'interface (navigation, actions) restent permis.
- **Organisations (D42).** Table `organizations` et colonne `organization_id` sur `drivers`, `vehicles`, `rides`, `statements` et `settings` dès le schéma (prompt 02), organisation `neomoov` seule utilisée en V1.

## Prompt 02 (schéma) : tables et colonnes à ajouter

`organizations`, `organization_id` (voir ci-dessus) ; `client_driver_links` (client, chauffeur, `favorite_since`, `rides_count`, `last_ride_at`) ; `ride_series` (lots de courses récurrentes, V1.1 : trajet, jours, heures, début, fin, mode de paiement, prix figé) ; `competitor_benchmarks` (catégorie, zones, plage horaire, prix Uber et Lyft en cents, `observed_at`, source) ; `interview_results` (candidat, niveaux de français et d'anglais, expérience, disponibilités, points d'attention, transcription) ; `recruitment_criteria` (critère, obligatoire ou atout, seuil) ; `recording_consents` et `recordings` (V2, structure seulement) ; `installment_plans` (V1.1) ; colonnes `preferences` étendues sur `clients` (ambiance, musique, température, langue du chauffeur, aide aux bagages avec nombre et taille, siège enfant, accessibilité, demandes spéciales) ; `payment_choice` sur `rides` (`prepaid`, `pay_driver_after`) et `installment_provider_ref` ; colonne `tolls_cents` dans les lignes de devis. Données de départ : `rides.min_lead_seconds` 7200, `pricing.negotiation_floor_ppm` 700 000, `pricing.negotiation_ceiling_ppm` 1 300 000, `pricing.benchmark_margin_ppm` 50 000, `payments.installment_min_cents` 15 000, drapeaux `FEATURE_IMMEDIATE_RIDES`, `FEATURE_NEGOTIATION_ABOVE_MAX`, `FEATURE_INSTALLMENTS`, `FEATURE_RIDE_SERIES` désactivés.

## Prompt 04 (tarification)

- Ligne « Péages » : montant réel renvoyé par l'API Routes (`tollInfo`) ajouté au sous-total avant taxes ; `tollsCents` en entrée du moteur, ligne `tolls` dans le devis, jamais dans le tarif chauffeur.
- Trafic : la durée vient de l'API Routes avec `departureTime` = heure de prise en charge demandée (`trafficAware`). Aucun multiplicateur : le trafic n'agit que par la durée.
- `benchmarkCheck(quote, benchmarks, marginPpm)` : fonction pure ; référence la plus proche (mêmes zones et plage horaire, moins de 14 jours) ; si le prix Neomoov dépasse `référence × (1 − marge)`, ligne « Remise d'alignement » qui réduit les frais de service jusqu'à 0, jamais le tarif chauffeur ; événement `benchmark_exceeded`. Sans référence, aucun ajustement. Tests : avec et sans référence, référence périmée, plancher atteint.
- Garde `LEAD_TIME_TOO_SHORT` dans le devis.

## Prompt 05 (courses) et prompt 06 (répartition et négociation)

- Réservation avec préavis : offres aux chauffeurs disponibles sur le créneau dès la réservation, fenêtre de 10 minutes, attribution confirmée au plus tard 90 minutes avant, réattribution à 60 minutes, attribution manuelle par l'opérateur toujours possible (D40).
- Chauffeur favori : priorité absolue s'il est disponible ; sinon repli automatique sur un autre favori du client (`client_driver_links`), sinon score ; le client est prévenu (D37).
- Sélection précise du véhicule : le devis renvoie la liste des véhicules disponibles sur le créneau (modèle, couleur, année, photo, chauffeur, note) ; le choix du client restreint l'offre à ce chauffeur d'abord, puis à la catégorie (garantie modèle).
- Négociation (drapeau `FEATURE_NEGOTIATION`) : curseur borné à `pricing.negotiation_floor_ppm` (70 %) ; contre-proposition du chauffeur entre P' et P ; offre au-dessus de P (jusqu'à `pricing.negotiation_ceiling_ppm`) seulement si `FEATURE_NEGOTIATION_ABOVE_MAX` est actif, avec motif obligatoire et acceptation écrite du client conservée dans `ride_events` (texte exact, horodatage). Fenêtre de 10 minutes.
- Mode de paiement transmis avec la demande ; un chauffeur ne reçoit que des demandes compatibles avec les modes qu'il accepte.

## Prompt 07 (paiements)

- Deux choix à la réservation (D35) : `prepaid` (carte, Apple Pay, Google Pay par Stripe ; Interac avec référence et rapprochement) ou `pay_driver_after` (espèces, terminal). Prépaiement autorisé à la réservation pour le prix maximal consenti.
- Adaptateur `InstallmentProvider` (`createPlan`, webhook) avec implémentation simulée ; proposé seulement si le total dépasse `payments.installment_min_cents` et si `FEATURE_INSTALLMENTS` est actif.
- Lots de courses (V1.1) : prépaiement de la série capturé à la commande et consommé course par course, ou paiement après chaque course.

## Prompt 08 (packs, promotions, favoris)

- « Mes chauffeurs » côté client et « Mes clients » côté chauffeur, alimentés par `client_driver_links` (D38) ; endpoints de lecture des deux côtés ; le chauffeur voit le nombre de courses par client, jamais les coordonnées complètes sans course en cours.
- Préférences étendues (D37) enregistrées dans le profil et copiées sur chaque course.

## Prompt 10 (application client)

- Parcours en trois écrans : (1) départ détecté, destination détectée, date et heure (au moins 2 heures après), vol ; (2) catégorie, véhicule précis, prix détaillé (avec péages), options ; (3) commodités et demandes spéciales avec le message « Choisissez toutes les commodités de votre voyage, et indiquez-nous vos demandes spéciales », rappel des commodités incluses (eau, chargeurs, Wi-Fi, parapluie), mode de paiement, récapitulatif, confirmation.
- Écran d'accueil : slogan commercial, photo réelle en fond. Profil : « Mes chauffeurs ». Négociation : offre au-dessus du prix affiché présentée à part avec son motif et acceptation explicite.

## Prompt 11 (application chauffeur)

- Inscription : langues parlées, expérience, équipement d'accueil du véhicule (eau, chargeurs, Wi-Fi, parapluies), rendez-vous pour l'entretien téléphonique (V1.1).
- Écran « Mes clients » (D38). Modes de paiement acceptés : espèces et terminal en plus du prépaiement. Offre de course : mode de paiement du client, préférences complètes, motif obligatoire pour une contre-offre au-dessus du prix affiché (V1.1).

## Prompt 12 (My Hub et réservation web)

- Répartition : attribution manuelle depuis le tableau des courses, files d'attente par créneau et par zone, réattribution (D40).
- Module « Veille prix » : saisie des relevés Uber et Lyft sur les trajets témoins (`competitor_benchmarks`), historique, alertes `benchmark_exceeded`.
- Module « Recrutement » : dossier documentaire, résultat d'entretien (V1.1), critères et score, validation humaine.
- Réservation web publique : mêmes règles (préavis, commodités, deux modes de paiement) que l'application.

## Prompt 13 (notifications, agents, vocal)

- Agent recrutement : entretien par appel avec le candidat (V1.1) sur l'infrastructure Vapi : français puis anglais, expérience, Montréal et aéroport, disponibilités ; sortie structurée `interview_results` ; recommandation, jamais décision.
- Notifications : rappel « au moins 2 heures à l'avance » dans les réponses de l'agent vocal et du chat quand un client demande une course trop proche, avec proposition du prochain créneau possible.

## Prompt 14 (conformité)

- Consentement distinct « enregistrement audio et vidéo à bord » (V2) prévu dans le modèle et dans la politique de confidentialité ; conservation 30 jours ; stockage canadien chiffré.
- Journal des acceptations écrites de prix (négociation) conservé 7 ans avec les factures.

## Prompt 01 (monorepo, infra) et prompt 16 (déploiement) : serveurs chez LWS (D48, 24 septembre 2026)

- Base de développement : Supabase `neomoov-dev` (Canada central), migrée et semée le 24 septembre 2026 ; `DATABASE_URL` dans le `.env` de la racine ; les scripts de `packages/db` chargent ce `.env` (`src/env.ts`) et exigent TLS hors localhost.
- Hébergement V1 : VPS KVM chez LWS (Ubuntu 24.04, Docker, Compose, Caddy). Écrire `infra/compose.prod.yml` (caddy, api ×2, worker, web, redis), `infra/Caddyfile`, `infra/deploy.sh` (SSH : `docker compose pull`, migrations avec verrou, `up -d`, vérification de santé, retour arrière sur l'image précédente en cas d'échec) et le manuel `docs/runbooks/deploiement-lws.md`. Images publiées sur GHCR par GitHub Actions. Aucun PostgreSQL sur le VPS.
- Railway et Vercel ne sont plus la cible ; les garder seulement comme secours documenté.
- Résidence des données : voir la section 10.3 du cahier des charges ; prévoir dès maintenant que `compose.prod.yml` fonctionne à l'identique sur un hôte canadien.

## Prompts 16 et 17

- Bêta : vérifier le parcours complet avec préavis de 2 heures, les deux modes de paiement, le repli du chauffeur favori et l'absence de toute illustration dessinée dans les écrans.
- Revue finale : contrôler que les drapeaux `FEATURE_IMMEDIATE_RIDES`, `FEATURE_NEGOTIATION_ABOVE_MAX`, `FEATURE_INSTALLMENTS` et `FEATURE_RIDE_SERIES` sont désactivés en production de test et documentés.
