# Sauvegardes et restauration

Deux niveaux : les sauvegardes automatiques de Supabase (base managée, région Canada) et une sauvegarde logique chiffrée quotidienne faite par le serveur (`infra/scripts/backup.sh`), gardée 35 jours sur le serveur et, si configuré, copiée vers un stockage objet. Les purges de conservation (Loi 25) ne tournent qu'après une sauvegarde vérifiée depuis moins de 26 heures.

Le cahier des charges (section 8) demande une conservation de 35 jours et une restauration d'essai mensuelle : le script garde 35 jours par défaut (`BACKUP_KEEP_DAYS` pour changer). Côté Supabase, le plan Pro garde 7 jours de sauvegardes quotidiennes ; l'objectif de 1 heure de perte au plus avant le lancement commercial (section 2.1) exige l'option de restauration à un instant donné (PITR), payante.

## Mise en place (une fois, sur le serveur LWS)

1. Ajouter dans `/opt/neomoov/.env` : `BACKUP_PASSPHRASE` (`openssl rand -base64 30`, 40 caractères aléatoires, copiée aussi dans le gestionnaire de mots de passe : sans elle, aucune sauvegarde ne se relit ; `infra/server-setup.sh` ne la génère pas), facultatif `BACKUP_REMOTE` (destination rclone, par exemple un seau du stockage objet).
2. Tâche planifiée : posée par `infra/server-setup.sh` (`/etc/cron.d/neomoov-backup`, 3 h 30, active dès que `BACKUP_PASSPHRASE` est dans `.env`). Sur un serveur préparé avant le 27 septembre 2026, l'ajouter à la main (`crontab -e` de `root`). Si `BACKUP_REMOTE` est utilisé, installer d'abord rclone (`apt-get install -y rclone`, puis `rclone config`), que le script de préparation n'installe pas :

```
30 3 * * * cd /opt/neomoov && set -a && . ./.env && set +a && infra/scripts/backup.sh >> /var/log/neomoov-backup.log 2>&1
```

3. Chaque matin, l'exploitation vérifie la fin du journal (`tail -n 5 /var/log/neomoov-backup.log` sur le serveur : « Sauvegarde vérifiée : N tables »), puis confirme dans My Hub, Sécurité et conformité, **Conformité et conservation**, « Confirmer la sauvegarde vérifiée » (administrateur ; ou `POST /v1/admin/retention/backup-verified`). Sans cette confirmation, la passe de conservation de la nuit suivante se bloque et le journalise (`blocked_no_backup`).

## Restaurer

Toujours d'abord dans une base de secours (sur le serveur, dans `/opt/neomoov`, après `set -a; . ./.env; set +a` pour charger `BACKUP_PASSPHRASE`) :

```
export TARGET_DATABASE_URL='postgresql://…/neomoov_restauration'
infra/scripts/restore.sh /var/backups/neomoov/neomoov-AAAAMMJJTHHMMSSZ.dump.enc
```

Le script contrôle l'empreinte, crée les extensions (PostGIS), restaure, puis affiche le nombre d'utilisateurs, de courses, de factures et de migrations. Comparer avec la production.

Restaurer la production (décision humaine, service arrêté) :

1. `docker compose -f infra/compose.prod.yml stop api worker` ;
2. `RESTORE_INTO_PRODUCTION=oui TARGET_DATABASE_URL="$DATABASE_URL" infra/scripts/restore.sh <fichier>` ;
3. si la sauvegarde précède une migration : `docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/migrate.js` ; redémarrer (`docker compose -f infra/compose.prod.yml up -d`) ; vérifier `/v1/health`.

Autre voie, par Supabase (restaure tout le projet, avec une coupure annoncée par Supabase) : tableau de bord du projet de production, « Database », « Backups », choisir la sauvegarde quotidienne (ou l'instant, avec l'option PITR), « Restore ». Arrêter l'API et le worker avant, les redémarrer après.

## Essai de restauration

À faire sur le serveur à la mise en service, puis chaque mois (cahier des charges, sections 8 et 10.4) : restaurer la dernière sauvegarde dans une base vierge, par exemple `docker run -d --name neomoov-essai -e POSTGRES_PASSWORD=essai -p 127.0.0.1:5433:5432 postgis/postgis:16-3.4`, puis `TARGET_DATABASE_URL=postgresql://postgres:essai@127.0.0.1:5433/postgres infra/scripts/restore.sh <fichier>` (les conteneurs clients du script utilisent le réseau de l'hôte, `RESTORE_DOCKER_NETWORK` pour changer) et `docker rm -f neomoov-essai` à la fin ; comparer les comptes, noter ici la date, la durée et le résultat. Premier essai : **à faire** (le poste de développement n'avait pas Docker actif au moment de l'écriture des scripts).

Risque non vérifié : `backup.sh` sauvegarde toute la base du projet Supabase, y compris les schémas propres à Supabase (`auth`, `storage`, extensions du fournisseur). Une base PostGIS vierge peut refuser certains de ces objets, et `restore.sh` s'arrête à la première erreur (`--exit-on-error`). Si l'essai échoue sur un objet de Supabase, noter le message et restaurer plutôt dans le projet Supabase de staging (`TARGET_DATABASE_URL` = son adresse « Session pooler »), puis signaler le cas pour adapter les scripts.

| Date | Sauvegarde restaurée | Cible | Durée | Comptes (utilisateurs, courses, factures, migrations) | Résultat |
|---|---|---|---|---|---|
| | | | | | |
