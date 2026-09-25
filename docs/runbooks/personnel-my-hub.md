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

1. `POST /v1/auth/staff/login` avec courriel et mot de passe → `{ status: "mfa_enrollment_required", mfaToken }`.
2. `POST /v1/auth/staff/mfa/enroll` avec le `mfaToken` → secret, `otpauthUri` et QR (SVG) à scanner dans l'application d'authentification.
3. `POST /v1/auth/staff/mfa/confirm` avec le `mfaToken` et le premier code → dix codes de secours (affichés une seule fois, à ranger dans le gestionnaire de mots de passe) et les jetons.

Connexions suivantes : `login` → `{ status: "mfa_required", mfaToken }` → `mfa/verify` avec le code (ou `mfa/backup` avec un code de secours, consommé).

## 3. Les autres membres du personnel

Par un administrateur connecté : `POST /v1/admin/staff` (téléphone, courriel, nom, rôles, mot de passe initial). Le nouveau membre change son mot de passe… (V1 : par un administrateur, `POST /v1/admin/staff/{id}/password`) et inscrit son second facteur à sa première connexion.

## 4. Téléphone perdu, compte verrouillé

- Second facteur perdu : `POST /v1/admin/staff/{id}/mfa/reset` (administrateur). La prochaine connexion refait l'inscription. Sinon, un code de secours.
- Verrouillage après 5 mots de passe faux : 15 minutes, doublées à chaque nouvelle série. `POST /v1/admin/staff/{id}/password` remet le compteur à zéro et révoque les sessions.
- Un membre du personnel qui se connecte par code SMS (comme client) n'obtient pas ses rôles du personnel : My Hub exige le mot de passe et le second facteur.

## 5. Clés de service (agents et intégrations)

`POST /v1/admin/api-keys` (administrateur) : nom, portées (`agents:run`, `agents:read`, `tools:*`, `rides:read`, …), agent, expiration. Le secret `nmk_…` n'est affiché qu'une fois. Vérification : `GET /v1/internal/service/whoami` avec `Authorization: Bearer nmk_…`. Révocation : `DELETE /v1/admin/api-keys/{id}`. Toute action d'une clé est attribuée à son agent dans le journal d'audit.

## 6. Journal d'audit

`GET /v1/admin/audit?entity=users&entityId=…&before=…&limit=50` : toute mutation (acteur, action, entité, avant et après masqués, adresse IP, identifiant de corrélation). La table est en ajout seul.
