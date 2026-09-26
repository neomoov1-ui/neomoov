# Base de données : migrations, retour arrière, données de départ

Étape 16. La base est chez Supabase, région Canada central (Montréal), jamais sur le VPS LWS (décision D48). Un projet par environnement : `neomoov-dev` (développement, existe), staging et production (à créer, `docs/operations/acces-a-fournir.md`). Sauvegardes et restauration : `sauvegardes.md`.

## Où agir

| Geste | Où | Qui |
|---|---|---|
| Voir les tables, lancer une requête de lecture | Supabase, projet concerné, « Table Editor » ou « SQL Editor » | Fondateur (compte Supabase) |
| Appliquer les migrations | Automatique à chaque déploiement (`infra/deploy.sh`, étape « migrations ») | Aucun geste |
| Retirer une migration | Serveur, section 3 | Sur décision du fondateur |
| Charger les données de départ | Serveur, section 4, une seule fois par base | Mise en service |

## 1. Migrations à chaque déploiement

`git push lws main` lance `infra/deploy.sh build`, qui applique les migrations une seule fois, hors des instances, avant de démarrer la nouvelle version. Si une migration échoue, le déploiement s'arrête et l'ancienne version continue de tourner. Lire le message :

```
ssh root@<adresse IP du VPS>
cd /opt/neomoov
docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/migrate.js
```

Cette même commande applique les migrations à la main (sans danger : une migration déjà appliquée est ignorée).

Chaque migration de `packages/db/drizzle/` a son inverse dans `packages/db/drizzle/down/`, testé sur une base vide (décision du 22 septembre). Le cahier des charges (section 2.3) demande de tester chaque migration sur une copie avant la production : restaurer la dernière sauvegarde dans une base de secours (`sauvegardes.md`), y appliquer la migration, vérifier, puis déployer.

## 2. Savoir quelles migrations sont appliquées

Supabase, « SQL Editor », requête en lecture seule :

```
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

Le nombre de lignes doit égaler le nombre de fichiers `NNNN_*.sql` de `packages/db/drizzle/` dans la version déployée.

## 3. Retirer la dernière migration (décision humaine)

Le retour arrière du code (`deploiement-lws.md`, section 6) n'annule pas les migrations. Si la version précédente ne fonctionne pas avec la nouvelle structure :

1. Sauvegarde fraîche d'abord (`sauvegardes.md`) ; une migration inverse peut supprimer des colonnes et leurs données.
2. Arrêter l'API et le worker : `docker compose -f infra/compose.prod.yml stop api worker`.
3. Retirer la dernière migration, une à la fois :

```
docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/rollback.js
```

4. Revenir au code précédent (`deploiement-lws.md`, section 6), qui redémarre l'API et le worker.

L'image de l'API contient `packages/db/dist` (dont `rollback.js`) et tout `packages/db/drizzle` (dont `down/`), d'après `apps/api/Dockerfile` ; la commande n'a pas encore été jouée sur un serveur : la faire une première fois sur staging. À défaut, depuis le poste : `pnpm db:rollback` avec la `DATABASE_URL` de la base visée placée dans l'environnement de la session (jamais dans un fichier du dépôt).

## 4. Données de départ (une fois par base)

Villes, zones, catégories, tarifs, suppléments, forfaits, packs, promotions, réglages, agents :

```
docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/seed/index.js
```

Le chargement est idempotent (une ligne existante n'est pas réécrite). Ensuite, les tarifs et les réglages se changent dans My Hub (**Tarifs**, **Paramètres**), jamais en relançant le chargement.

## 5. Interdits

- `pnpm db:reset` vide toute la base : le script refuse une adresse qui ne ressemble pas à une base de développement ou de test ; ne jamais contourner ce refus.
- Aucune écriture à la main dans `audit_log` ni `ride_events` (tables en ajout seul, protégées par déclencheur).
- Aucune modification des montants d'une facture émise (`invoices`) : une correction passe par une note de crédit (remboursement dans My Hub).
