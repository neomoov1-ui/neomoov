# Sauvegardes et restauration

Deux niveaux : les sauvegardes automatiques de Supabase (base managée, région Canada) et une sauvegarde logique chiffrée quotidienne faite par le serveur (`infra/scripts/backup.sh`), gardée 35 jours sur le serveur et copiée hors site vers un stockage objet (obligatoire en production). Les purges de conservation (Loi 25) ne tournent qu'après une sauvegarde vérifiée depuis moins de 26 heures.

Le cahier des charges (section 8) demande une conservation de 35 jours et une restauration d'essai mensuelle : le script garde 35 jours par défaut (`BACKUP_KEEP_DAYS` pour changer) et l'essai mensuel est planifié (`infra/scripts/restore-test.sh`). Côté Supabase, le plan Pro garde 7 jours de sauvegardes quotidiennes ; l'objectif de 1 heure de perte au plus avant le lancement commercial (section 2.1) exige l'option de restauration à un instant donné (PITR), payante.

## Ce que fait la sauvegarde (revue du 2 octobre 2026)

- Seuls les schémas de Neomoov sont sauvegardés (`public` et `drizzle`, variable `BACKUP_SCHEMAS`) : les schémas propres à Supabase (`auth`, `storage`, `realtime`, `vault`…) ne se restaurent pas dans une base vierge et ne contiennent aucune donnée de Neomoov.
- Le fichier est écrit en `.part`, déchiffré et relu (`pg_restore --list`, au moins 20 tables), puis seulement renommé : aucun fichier partiel ne ressemble à une sauvegarde.
- À côté de chaque sauvegarde : `.sha256` (empreinte), `.mac` (empreinte authentifiée par `BACKUP_PASSPHRASE`, refus de restaurer un fichier modifié) et `.meta` (sans secret : schéma de PostGIS dans la source, version du serveur, nombre de tables).
- Copie hors site (`BACKUP_REMOTE`, rclone) de ces quatre fichiers ; la purge des sauvegardes de plus de 35 jours, sur le serveur et dans le seau, n'a lieu qu'après une copie réussie.
- Alerte : si `BACKUP_HEARTBEAT_URL` existe (moniteur « heartbeat » de Better Stack, période 1 jour, grâce 2 heures), chaque sauvegarde réussie le prévient ; tout échec appelle `/fail`, et l'absence de sauvegarde déclenche l'alerte à la fin du délai de grâce.
- Codes de sortie : `0` tout est fait ; `1` sauvegarde en échec (rien de nouveau) ; `4` sauvegarde vérifiée sur le serveur, mais copie hors site absente (production sans `BACKUP_REMOTE`) ou en échec : rien n'est purgé, l'alerte part.

## Mise en place (une fois, sur le serveur LWS)

1. Ajouter dans `/opt/neomoov/.env` :
   - `BACKUP_PASSPHRASE` (`openssl rand -base64 30`, 40 caractères aléatoires, copiée aussi dans le gestionnaire de mots de passe : sans elle, aucune sauvegarde ne se relit ni ne se vérifie ; `infra/server-setup.sh` ne la génère pas) ;
   - `BACKUP_REMOTE` : destination rclone, par exemple `neomoov-sauvegardes:neomoov-backups` (seau d'un stockage objet **au Canada**, compte à ouvrir par le fondateur) ; rclone est installé par `infra/server-setup.sh` (serveur préparé avant le 3 octobre 2026 : `apt-get install -y rclone`) ; créer la destination une fois par `rclone config` (en `root`), clés du seau saisies là et jamais dans Git ;
   - facultatif : `BACKUP_HEARTBEAT_URL` et `RESTORE_TEST_HEARTBEAT_URL` (adresses des deux moniteurs « heartbeat » de Better Stack ; l'essai de restauration, mensuel, avec une période de 31 jours).
2. Tâches planifiées, posées par `infra/server-setup.sh` : `/etc/cron.d/neomoov-backup` (chaque jour, 3 h 30) et `/etc/cron.d/neomoov-restore-test` (le 2 de chaque mois, 4 h 30), actives dès que `BACKUP_PASSPHRASE` est dans `.env`, journaux tournés chaque semaine (`/etc/logrotate.d/neomoov`). Sur un serveur préparé avant le 3 octobre 2026, relancer `infra/server-setup.sh` (rejouable) ou ajouter les lignes à la main :

```
30 3 * * * root cd /opt/neomoov && grep -q "^BACKUP_PASSPHRASE=." .env && set -a && . ./.env && set +a && infra/scripts/backup.sh >> /var/log/neomoov-backup.log 2>&1
30 4 2 * * root cd /opt/neomoov && grep -q "^BACKUP_PASSPHRASE=." .env && set -a && . ./.env && set +a && infra/scripts/restore-test.sh >> /var/log/neomoov-restore-test.log 2>&1
```

3. Chaque matin, l'exploitation vérifie la fin du journal (`tail -n 5 /var/log/neomoov-backup.log` sur le serveur : « Sauvegarde vérifiée : N tables » puis « Copie hors site réussie »), puis confirme dans My Hub, Sécurité et conformité, **Conformité et conservation**, « Confirmer la sauvegarde vérifiée » (administrateur ; ou `POST /v1/admin/retention/backup-verified`). Sans cette confirmation, la passe de conservation de la nuit suivante se bloque et le journalise (`blocked_no_backup`).

## Restaurer

Toujours d'abord dans une base de secours (sur le serveur, dans `/opt/neomoov`, après `set -a; . ./.env; set +a` pour charger `BACKUP_PASSPHRASE`) :

```
export TARGET_DATABASE_URL='postgresql://…/neomoov_restauration'
infra/scripts/restore.sh /var/backups/neomoov/neomoov-AAAAMMJJTHHMMSSZ.dump.enc
```

Le script contrôle l'empreinte authentifiée (`.mac` ; à défaut, pour une sauvegarde antérieure au 3 octobre 2026, l'empreinte simple), prépare la cible (PostGIS dans le même schéma que la source d'après `.meta`, `pgcrypto`, rôle `neomoov_scoped` des politiques d'isolation), restaure, puis affiche le nombre d'utilisateurs, de courses, de factures et de migrations. Comparer avec la production. Une sauvegarde rapatriée du seau (`rclone copy <BACKUP_REMOTE>/neomoov-… /var/backups/neomoov/`) se restaure de la même façon, avec ses fichiers `.mac` et `.meta`.

Restaurer la production (décision humaine, service arrêté) :

1. `docker compose -f infra/compose.prod.yml stop api worker` ;
2. `RESTORE_INTO_PRODUCTION=oui TARGET_DATABASE_URL="$DATABASE_URL" infra/scripts/restore.sh <fichier>` ;
3. si la sauvegarde précède une migration : `docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/migrate.js` ; redémarrer (`docker compose -f infra/compose.prod.yml up -d`) ; vérifier `/v1/health`.

Autre voie, par Supabase (restaure tout le projet, avec une coupure annoncée par Supabase) : tableau de bord du projet de production, « Database », « Backups », choisir la sauvegarde quotidienne (ou l'instant, avec l'option PITR), « Restore ». Arrêter l'API et le worker avant, les redémarrer après.

## Essai de restauration

Planifié chaque mois (2 du mois, 4 h 30) et à lancer à la main à la mise en service, sur le serveur, dans `/opt/neomoov` :

```
set -a; . ./.env; set +a
infra/scripts/restore-test.sh                    # dernière sauvegarde
infra/scripts/restore-test.sh <fichier.dump.enc> # une sauvegarde précise
```

Le script démarre un conteneur PostGIS jetable (`postgis/postgis:17-3.5`, publié sur `127.0.0.1:5433` seulement, mot de passe jetable), y restaure la sauvegarde par `restore.sh`, compte les lignes, lit les mêmes comptes dans la production en transaction en lecture seule, supprime le conteneur (même en cas d'erreur) et finit par une ligne `ESSAI | date | fichier | cible | durée | comptes | résultat` à reporter dans le tableau ci-dessous. Les comptes de la production peuvent dépasser ceux de la sauvegarde (activité depuis 3 h 30). Variables : `RESTORE_TEST_IMAGE`, `RESTORE_TEST_PORT`, `RESTORE_TEST_HEARTBEAT_URL`.

Premier essai : **à faire** sur le serveur (le poste de développement n'a pas de base de production ; aucune commande n'est lancée sur le serveur par les agents). En cas d'échec sur un objet inattendu, noter le message, restaurer plutôt dans le projet Supabase de staging (`TARGET_DATABASE_URL` = son adresse « Session pooler ») et signaler le cas pour adapter les scripts.

| Date | Sauvegarde restaurée | Cible | Durée | Comptes (utilisateurs, courses, factures, migrations) | Résultat |
|---|---|---|---|---|---|
| | | | | | |
