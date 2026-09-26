# Comptes du personnel de My Hub

Étape 3 (prompt 03). Les rôles `admin`, `operator`, `finance` et `readonly` se connectent à My Hub par courriel et mot de passe, puis second facteur obligatoire (application d'authentification : Google Authenticator, 1Password, Authy…). Clients et chauffeurs n'ont jamais de mot de passe.

## 1. Créer le premier administrateur (une fois, depuis le poste ou le serveur)

Le mot de passe passe par une variable d'environnement, jamais par un argument (il resterait dans l'historique du shell).

```
cd C:\Users\PC\code\neomoov
set STAFF_PASSWORD=<mot de passe d'au moins 12 caractères>      # PowerShell : $env:STAFF_PASSWORD = '…'
pnpm --filter @neomoov/api create-staff --email admin@neomoov.net --phone +15145550100 --first Christopher --last N --roles admin
```

Sur le serveur : même commande dans le conteneur de l'API (`docker compose -f infra/compose.prod.yml run --rm --no-deps -e STAFF_PASSWORD api node dist/scripts/create-staff.js --email … --phone … --first … --last … --roles admin`).

Rôles : `admin` (tout), `operator` (exploitation), `finance` (relevés, factures), `readonly` (lecture seule). Plusieurs rôles séparés par des virgules.

## 2. Première connexion

Sur le web (étape 12) : `https://<site>/hub/connexion`. Courriel et mot de passe, puis code QR à scanner (ou clé à saisir), premier code, et dix codes de secours affichés une seule fois. Les jetons restent sur le serveur web (témoins `httpOnly`) ; la session dure 30 jours sans activité, « Se déconnecter » la révoque.

Par l'API directement :

1. `POST /v1/auth/staff/login` avec courriel et mot de passe → `{ status: "mfa_enrollment_required", mfaToken }`.
2. `POST /v1/auth/staff/mfa/enroll` avec le `mfaToken` → secret, `otpauthUri` et QR (SVG) à scanner dans l'application d'authentification.
3. `POST /v1/auth/staff/mfa/confirm` avec le `mfaToken` et le premier code → dix codes de secours (affichés une seule fois, à ranger dans le gestionnaire de mots de passe) et les jetons.

Connexions suivantes : `login` → `{ status: "mfa_required", mfaToken }` → `mfa/verify` avec le code (ou `mfa/backup` avec un code de secours, consommé).

## 3. Les autres membres du personnel

Dans My Hub (administrateur) : **Administration**, **Équipe**, **Ajouter un membre** (nom, courriel, téléphone, langue, rôles, mot de passe initial ; **Générer** propose un mot de passe aléatoire de 20 caractères, à transmettre par un canal sûr). Un courriel ou un téléphone déjà connu met à jour ce compte (rôles ajoutés). Par l'API : `POST /v1/admin/staff` (téléphone, courriel, nom, rôles, mot de passe initial). Le nouveau membre change son mot de passe… (V1 : par un administrateur, `POST /v1/admin/staff/{id}/password`) et inscrit son second facteur à sa première connexion.

## 4. Téléphone perdu, compte verrouillé

- Second facteur perdu : My Hub, **Équipe**, **Réinitialiser le second facteur** sur la ligne du membre, après avoir vérifié son identité (ou `POST /v1/admin/staff/{id}/mfa/reset`, administrateur). Ses sessions sont fermées. La prochaine connexion refait l'inscription. Sinon, un code de secours.
- Verrouillage après 5 mots de passe faux : 15 minutes, doublées à chaque nouvelle série. `POST /v1/admin/staff/{id}/password` (My Hub : **Remplacer le mot de passe**) remet le compteur à zéro et révoque les sessions.
- Un membre du personnel qui se connecte par code SMS (comme client) n'obtient pas ses rôles du personnel : My Hub exige le mot de passe et le second facteur.

## 5. Clés de service (agents et intégrations)

My Hub (administrateur) : **Administration**, **Clés de service** : liste (préfixe, portées, agent, dernier usage, expiration, état), **Créer une clé**, **Révoquer**. Par l'API : `POST /v1/admin/api-keys` : nom, portées (`agents:run`, `agents:read`, `tools:*`, `rides:read`, …), agent, expiration. Le secret `nmk_…` n'est affiché qu'une fois (dialogue « Clé créée », bouton **Copier la clé**) : le ranger aussitôt. Vérification : `GET /v1/internal/service/whoami` avec `Authorization: Bearer nmk_…`. Révocation : `DELETE /v1/admin/api-keys/{id}`. Toute action d'une clé est attribuée à son agent dans le journal d'audit.

### Clé publique du site (réservation web, préinscription, WordPress)

Une clé à la seule portée `public:write` (`POST /v1/admin/api-keys` avec `{"name": "Site web", "scopes": ["public:write"]}`) ouvre `POST /v1/public/quotes`, `POST /v1/public/leads` et `GET /v1/public/places/*`, rien d'autre. Elle se range dans la variable `NEOMOOV_PUBLIC_API_KEY` du serveur web (jamais dans une page) ; le site WordPress l'utilise de la même façon, depuis son serveur. Détail et exemple d'appel : `docs/api-publique.md`.

## 6. Journal d'audit

My Hub, **Journal d'audit** : filtres par objet, action et période ; **Exporter en CSV** (administrateur, 50 000 lignes au plus, export lui-même journalisé). Par l'API : `GET /v1/admin/audit?entity=users&entityId=…&from=…&to=…&limit=50` et `GET /v1/admin/audit/export` : toute mutation (acteur, action, entité, avant et après masqués, adresse IP, identifiant de corrélation). La table est en ajout seul.
