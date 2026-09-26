# Comptes de test et de démonstration

Étape 16 (prompt 16, tâche 8). Liste des comptes à créer pour la bêta et pour la revue des magasins. **Aucun mot de passe, aucun code, aucune donnée personnelle réelle ici** : les mots de passe et codes de secours vont dans Bitwarden (dossier `Neomoov`), la correspondance entre codes de testeurs et personnes réelles vit hors du dépôt.

Conventions :

- Numéros fictifs : plage `+1 514 555 0100` à `+1 514 555 0199`, réservée à la fiction dans le plan de numérotation nord-américain (elle ne reçoit aucun texto).
- Courriels fonctionnels du domaine (`…@neomoov.net`, redirigés vers la boîte de Neomoov), jamais une adresse personnelle.
- Noms visiblement fictifs (« Démo Client », « Démo Chauffeur »).

## 1. Déjà créés par les données de départ

Le chargement des données de départ (`docs/runbooks/base-de-donnees.md`, section 4) crée des comptes de démonstration sur **toute** base où il est lancé, production comprise :

| Compte | Numéro | Rôle | État après chargement |
|---|---|---|---|
| Admin Neomoov | `+1 514 555 0100` | `admin` (sans mot de passe : ne se connecte pas à My Hub) | Actif |
| Opérateur De jour | `+1 514 555 0101` | `operator` (sans mot de passe) | Actif |
| Trois chauffeurs (Neo Premium, Neo Prestige, Neo XL) | `+1 514 555 0110` à `0112` | `driver` | **Actifs**, documents approuvés, véhicules actifs |
| Cinq clients | `+1 514 555 0120` à `0124` | `client` | Actifs |

En production, décider pour chacun : le garder comme compte de démonstration pour la revue des magasins (section 3), ou le suspendre (My Hub, **Chauffeurs**, fiche, **Suspendre**). Un chauffeur de démonstration actif n'est sollicité que s'il passe en ligne, mais il apparaît dans les listes et les rapports. Manque signalé : les données de départ ne distinguent pas la production.

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

**Blocage actuel** : la connexion se fait uniquement par code SMS, et l'API n'a aucun mécanisme de compte de démonstration à code fixe. Un examinateur ne peut donc pas se connecter. Manque signalé au code : un réglage qui associe un ou deux numéros fictifs à un code fixe, refusé pour tout autre numéro, journalisé à chaque usage, désactivable dans My Hub. Tant qu'il n'existe pas, aucune soumission à la revue (TestFlight externe compris) ne peut aboutir.

## 4. Comptes de la bêta

| Code | Qui | Création |
|---|---|---|
| `F` | Fondateur, comme client et comme chauffeur (tests au volant, cahier des charges section 12, point 5) | Par les applications, avec son numéro réel ; dossier chauffeur validé dans My Hub |
| `D01` à `D10` | Chauffeurs de la bêta | Par l'application chauffeur ; validation dans My Hub (`procedure.md`, section 3) |
| `C01` à `C30` | Clients de la bêta | Par l'application client |

## 5. Clés et comptes techniques

| Élément | Création | Rangement |
|---|---|---|
| Clé publique « Site web » (portée `public:write`) pour la réservation web et WordPress | `POST /v1/admin/api-keys` (`docs/runbooks/personnel-my-hub.md`, section 5) | `NEOMOOV_PUBLIC_API_KEY` dans `/opt/neomoov/.env` et réglage du site WordPress |
| Paiements de test | Cartes de test publiées par Stripe, en mode test seulement | Documentation Stripe, rien à ranger |
| Testeurs internes des magasins | App Store Connect (Utilisateurs et accès) ; Play Console (liste du test interne) | Adresses dans la liste hors dépôt |
