# Manuels d'exploitation

Procédures pas à pas pour exploiter la plateforme Neomoov. Chaque manuel tient sur une page, se lit en situation d'urgence et ne contient aucun secret (les secrets sont dans `.env` sur le serveur et dans le gestionnaire de mots de passe).

| Manuel | Contenu | État |
|---|---|---|
| `deploiement-lws.md` | DNS, préparation du VPS LWS (`infra/server-setup.sh`), déploiement par `git push lws main` (`infra/deploy.sh`), vérification, journaux, retour arrière | Écrit le 24 septembre 2026 |
| `personnel-my-hub.md` | Premier administrateur (`create-staff`), connexion avec second facteur, codes de secours, autres membres du personnel, téléphone perdu, clés de service, journal d'audit | Écrit le 25 septembre 2026 |
| `sauvegardes.md` | Sauvegarde logique chiffrée quotidienne (`infra/scripts/backup.sh`), vérification, confirmation qui autorise les purges de conservation, restauration (`restore.sh`) dans une base de secours ou en production | Écrit le 26 septembre 2026 ; essai de restauration à faire sur le serveur |
| `base-de-donnees.md` | Migrations (`pnpm db:migrate`), retour arrière (`pnpm db:rollback`), données de départ, sauvegardes Supabase, restauration | À écrire à l'étape 16 |
| `degraded-mode.md` | Ce qui continue quand un fournisseur tombe (Routes, Stripe, Twilio, Expo, Resend, modèles de langage, Vapi, SEV, Redis, base), ce que voit et fait l'exploitation, disjoncteurs et santé | Écrit le 26 septembre 2026 |
| `observabilite.md` | Identifiant de corrélation (du mobile aux files), suivi des erreurs Sentry (projets, variables, lecture), métriques de My Hub et format Prometheus, sondes et alertes Better Stack à créer, réaction à une alerte | Écrit le 26 septembre 2026 ; comptes Sentry et Better Stack à ouvrir |
| `secrets-et-cles.md` | Où vivent les clés, comment les faire tourner (rotation), qui y a accès | À écrire à l'étape 14 |

## Commandes de base

```
pnpm db:migrate      applique les migrations sur DATABASE_URL
pnpm db:rollback     retire la dernière migration
pnpm db:seed         charge les données de départ
pnpm dev:api         API sur http://localhost:4000 (santé : /v1/health, OpenAPI : /v1/docs)
pnpm dev:web         web sur http://localhost:3000
pnpm openapi         régénère packages/api-client/src/openapi.json
pnpm --filter @neomoov/api create-staff --email … --phone … --first … --last … --roles admin   (mot de passe dans STAFF_PASSWORD)
```
