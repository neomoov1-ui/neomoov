# Sauvegardes et restauration

Deux niveaux : les sauvegardes automatiques de Supabase (base managée, région Canada) et une sauvegarde logique chiffrée quotidienne faite par le serveur (`infra/scripts/backup.sh`), gardée 14 jours sur le serveur et, si configuré, copiée vers un stockage objet. Les purges de conservation (Loi 25) ne tournent qu'après une sauvegarde vérifiée depuis moins de 26 heures.

## Mise en place (une fois, sur le serveur LWS)

1. Ajouter dans `/opt/neomoov/.env` : `BACKUP_PASSPHRASE` (40 caractères aléatoires, copiée aussi dans le gestionnaire de mots de passe : sans elle, aucune sauvegarde ne se relit), facultatif `BACKUP_REMOTE` (destination rclone, par exemple un seau du stockage objet).
2. Tâche planifiée (utilisateur `deploy`) :

```
30 3 * * * cd /opt/neomoov && set -a && . ./.env && set +a && infra/scripts/backup.sh >> /var/log/neomoov-backup.log 2>&1
```

3. Chaque matin, l'exploitation vérifie la dernière ligne du journal (« Sauvegarde vérifiée : N tables »), puis confirme dans My Hub, Conservation, « Sauvegarde vérifiée » (ou `POST /v1/admin/retention/backup-verified`). Sans cette confirmation, la passe de conservation de la nuit suivante se bloque et le journalise (`blocked_no_backup`).

## Restaurer

Toujours d'abord dans une base de secours :

```
export TARGET_DATABASE_URL='postgresql://…/neomoov_restauration'
infra/scripts/restore.sh /var/backups/neomoov/neomoov-AAAAMMJJTHHMMSSZ.dump.enc
```

Le script contrôle l'empreinte, crée les extensions (PostGIS), restaure, puis affiche le nombre d'utilisateurs, de courses, de factures et de migrations. Comparer avec la production.

Restaurer la production (décision humaine, service arrêté) :

1. `docker compose -f infra/compose.prod.yml stop api worker` ;
2. `RESTORE_INTO_PRODUCTION=oui TARGET_DATABASE_URL="$DATABASE_URL" infra/scripts/restore.sh <fichier>` ;
3. `pnpm db:migrate` si la sauvegarde précède une migration ; redémarrer ; vérifier `/v1/health`.

## Essai de restauration

À faire sur le serveur à la mise en service, puis chaque trimestre : restaurer la dernière sauvegarde dans une base vierge (conteneur `postgis/postgis:16-3.4`), comparer les comptes, noter ici la date, la durée et le résultat. Premier essai : **à faire** (le poste de développement n'avait pas Docker actif au moment de l'écriture des scripts).
