# Comptes de test et de démonstration

Étape 16 (prompt 16, tâche 8). Liste des comptes à créer pour la bêta et pour la revue des magasins. **Aucun mot de passe, aucun code, aucune donnée personnelle réelle ici** : les mots de passe et codes de secours vont dans Bitwarden (dossier `Neomoov`), la correspondance entre codes de testeurs et personnes réelles vit hors du dépôt.

Conventions :

- Numéros fictifs : plage `+1 514 555 0100` à `+1 514 555 0199`, réservée à la fiction dans le plan de numérotation nord-américain (elle ne reçoit aucun texto).
- Courriels fonctionnels du domaine (`…@neomoov.net`, redirigés vers la boîte de Neomoov), jamais une adresse personnelle.
- Noms visiblement fictifs (« Démo Client », « Démo Chauffeur »).

## 1. Comptes créés par les données de départ (hors production seulement)

Le chargement des données de départ (`docs/runbooks/base-de-donnees.md`, section 4) crée ces comptes de démonstration sur les bases de développement et de test, **jamais en production** (`NODE_ENV=production`), sauf si `SEED_DEMO=on` est posé, ce qu'il ne faut pas faire sur la base de production (décision du 26 septembre 2026) :

| Compte | Numéro | Rôle | État après chargement |
|---|---|---|---|
| Admin Neomoov | `+1 514 555 0100` | `admin` (sans mot de passe : ne se connecte pas à My Hub) | Actif |
| Opérateur De jour | `+1 514 555 0101` | `operator` (sans mot de passe) | Actif |
| Trois chauffeurs (Neo Premium, Neo Prestige, Neo XL) | `+1 514 555 0110` à `0112` | `driver` | **Actifs**, documents approuvés (fichiers fictifs, sans contenu dans le stockage), véhicules actifs |
| Cinq clients | `+1 514 555 0120` à `0124` | `client` | Actifs |

En production, la base ne contient donc aucun compte au départ : le personnel se crée par `create-staff` puis **Équipe** (section 2), les comptes de démonstration pour les magasins par les applications elles-mêmes (section 3), les testeurs par les applications (section 4). Une base de production chargée avant le 26 septembre 2026 peut encore porter ces comptes : les suspendre (My Hub, **Chauffeurs**, fiche, **Suspendre**) ou les réutiliser pour la section 3.

## 2. Personnel de My Hub

| Code | Rôle | Courriel proposé | Usage | Création |
|---|---|---|---|---|
| `STAFF-ADMIN` | `admin` | adresse du fondateur au domaine | Exploitation, paramètres | `create-staff` (`docs/runbooks/personnel-my-hub.md`, section 1) |
| `STAFF-OPS` | `operator` | `operations@neomoov.net` | Opérateur de garde pendant la bêta | My Hub, **Équipe**, **Ajouter un membre** (ou `POST /v1/admin/staff`) |
| `STAFF-FIN` | `finance` | `comptes@neomoov.net` | Relevés, factures, registres | Idem |
| `STAFF-RO` | `readonly` | `lecture@neomoov.net` | Démonstration de My Hub à un tiers (avocat, investisseur) sans droit d'écriture | Idem |

Chacun inscrit son second facteur à la première connexion ; mots de passe et codes de secours dans Bitwarden.

## 3. Démonstration pour la revue des magasins

Apple et Google exigent un compte qui permet à l'examinateur d'utiliser l'application sans recevoir de texto.

| Code | Application | Contenu à préparer |
|---|---|---|
| `DEMO-CLIENT-FR` | Client | Langue française, consentements donnés, un lieu enregistré (adresse publique, par exemple une gare), une course terminée et une réservation à venir |
| `DEMO-CLIENT-EN` | Client | Même chose en anglais |
| `DEMO-CHAUFFEUR` | Chauffeur | Chauffeur actif, véhicule Neo Premium, documents approuvés (pièces marquées « SPÉCIMEN »), formation certifiée, paiement au chauffeur accepté, quelques courses terminées pour montrer les revenus et un relevé |

La connexion se fait uniquement par code SMS. Mécanisme d'examen livré le 26 septembre 2026 (`apps/api/src/modules/auth/otp.service.ts`) :

- `REVIEW_PHONES` : numéros d'examen au format E.164, séparés par des virgules, pris dans la plage fictive (par exemple un numéro pour `DEMO-CLIENT-FR`, un pour `DEMO-CLIENT-EN`, un pour `DEMO-CHAUFFEUR`) ;
- `REVIEW_OTP_CODE` : code fixe de 6 chiffres ; l'API refuse de démarrer s'il manque alors que `REVIEW_PHONES` est posé, ou s'il est trop simple (six fois le même chiffre, `123456`, `654321`) ;
- ces numéros reçoivent toujours ce code, sans texto (chaque demande est journalisée, numéro masqué) ; tout autre numéro suit la règle normale. Les limites ordinaires s'appliquent : 5 codes par heure et par numéro, 5 essais par code.

Mise en place, sur le serveur de production :

1. Ajouter `REVIEW_PHONES=…` et `REVIEW_OTP_CODE=…` dans `/opt/neomoov/.env`, puis `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker` (`docs/runbooks/redemarrer-un-service.md`, section 7). Le code va dans Bitwarden et dans les informations de connexion des deux consoles, nulle part ailleurs.
2. Préparer chaque compte depuis un téléphone, avec le numéro d'examen et le code fixe (aucun texto n'est nécessaire) : client (langue, consentements, un lieu enregistré, une réservation à venir ; la course terminée demande un chauffeur réel ou le compte `DEMO-CHAUFFEUR`) ; chauffeur (candidature, véhicule, documents « SPÉCIMEN », formation), puis validation des documents et **Activer** dans My Hub.
3. Essayer la connexion de chaque compte depuis un second téléphone avant la soumission.
4. Après la publication : vider les deux variables et recréer `api` et `worker`. Les reposer pour chaque nouvelle revue (nouvelle version, TestFlight externe).

Le mécanisme ne se règle pas dans My Hub : il dépend seulement de ces deux variables du serveur.

## 4. Comptes de la bêta

| Code | Qui | Création |
|---|---|---|
| `F` | Fondateur, comme client et comme chauffeur (tests au volant, cahier des charges section 12, point 5) | Par les applications, avec son numéro réel ; dossier chauffeur validé dans My Hub |
| `D01` à `D10` | Chauffeurs de la bêta | Par l'application chauffeur ; validation dans My Hub (`procedure.md`, section 3) |
| `C01` à `C30` | Clients de la bêta | Par l'application client |

## 5. Clés et comptes techniques

| Élément | Création | Rangement |
|---|---|---|
| Clé publique « Site web » (portée `public:write`) pour la réservation web et WordPress | My Hub, Administration, **Clés de service** (ou `POST /v1/admin/api-keys`, `docs/runbooks/personnel-my-hub.md`, section 5) | `NEOMOOV_PUBLIC_API_KEY` dans `/opt/neomoov/.env` et réglage du site WordPress |
| Numéros et code d'examen des magasins | Section 3 | `REVIEW_PHONES`, `REVIEW_OTP_CODE` dans `/opt/neomoov/.env` ; code dans Bitwarden |
| Paiements de test | Cartes de test publiées par Stripe, en mode test seulement | Documentation Stripe, rien à ranger |
| Testeurs internes des magasins | App Store Connect (Utilisateurs et accès) ; Play Console (liste du test interne) | Adresses dans la liste hors dépôt |
