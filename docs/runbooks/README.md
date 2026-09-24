# Manuels d'exploitation

Procédures pas à pas pour exploiter la plateforme Neomoov. Chaque manuel tient sur une page, se lit en situation d'urgence et ne contient aucun secret (les secrets sont dans `.env` sur le serveur et dans le gestionnaire de mots de passe).

| Manuel | Contenu | État |
|---|---|---|
| `deploiement-lws.md` | Préparer le VPS LWS, publier une version, vérifier la santé, revenir à la version précédente | À écrire à l'arrivée du serveur (décision D48) |
| `base-de-donnees.md` | Migrations (`pnpm db:migrate`), retour arrière (`pnpm db:rollback`), données de départ, sauvegardes Supabase, restauration | À écrire à l'étape 16 |
| `incidents.md` | Que faire quand l'API est injoignable, quand Redis tombe, quand Stripe ou Google Maps refusent, quand un règlement hebdomadaire échoue | À écrire à l'étape 15 |
| `secrets-et-cles.md` | Où vivent les clés, comment les faire tourner (rotation), qui y a accès | À écrire à l'étape 14 |

## Commandes de base

```
pnpm db:migrate      applique les migrations sur DATABASE_URL
pnpm db:rollback     retire la dernière migration
pnpm db:seed         charge les données de départ
pnpm dev:api         API sur http://localhost:4000 (santé : /v1/health, OpenAPI : /v1/docs)
pnpm dev:web         web sur http://localhost:3000
pnpm openapi         régénère packages/api-client/src/openapi.json
```
