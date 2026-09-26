# Redémarrer un service sur le serveur LWS

Étape 16 (prompt 16, tâche 6). Serveur VPS KVM chez LWS (décision D48), code dans `/opt/neomoov`, six conteneurs décrits par `infra/compose.prod.yml`. La base de données n'est pas sur ce serveur (Supabase, Canada central) : elle ne se redémarre pas d'ici. Aucun secret dans ce manuel.

Règle d'or : un redémarrage répare un processus bloqué, jamais la panne d'un fournisseur externe (Stripe, Twilio, Google, Supabase). Lire l'état d'abord (section 1), redémarrer ensuite.

## 0. Se connecter au serveur

Depuis le poste, dans Git Bash ou PowerShell :

```
ssh root@<adresse IP du VPS>
cd /opt/neomoov
```

L'adresse IP est notée dans `C:\Users\PC\cles-neomoov\lws-vps.txt`. Toutes les commandes suivantes se tapent sur le serveur, dans `/opt/neomoov`.

## 1. Regarder avant d'agir (2 minutes)

```
docker compose -f infra/compose.prod.yml ps
curl -s https://api.neomoov.net/v1/health
```

| Conteneur | Rôle | État normal dans `ps` |
|---|---|---|
| `neomoov-caddy-1` | Certificats TLS, aiguillage de `api`, `hub` et `reserver` | `Up` |
| `neomoov-api-1` et `neomoov-api-2` | API (deux instances derrière Caddy) | `Up (healthy)` |
| `neomoov-worker-1` | Files de tâches et passes planifiées : répartition automatique, notifications, paiements, factures, relevés, conservation, agents | `Up` (aucune sonde de santé) |
| `neomoov-web-1` | My Hub, réservation web, suivi partagé | `Up (healthy)` |
| `neomoov-redis-1` | Files, verrous, temps réel partagé entre les deux instances | `Up (healthy)` |

Lecture de `/v1/health` :

| Champ | Valeur normale | Sinon |
|---|---|---|
| `status` | `ok` | `degraded` : lire les champs suivants |
| `checks.database.status` | `ok` | `error` : base Supabase injoignable. Ne pas redémarrer : consulter https://status.supabase.com et le tableau de bord Supabase, puis `sauvegardes.md` si les données sont en cause |
| `checks.redis.status` | `ok` | `error` : section 5 |
| `circuits` | tous `closed` | un circuit `open` : fournisseur en panne, voir `degraded-mode.md` ; aucun redémarrage |

Journaux (les 200 dernières lignes d'un service) :

```
docker compose -f infra/compose.prod.yml logs --tail=200 api
docker compose -f infra/compose.prod.yml logs --tail=200 worker
docker compose -f infra/compose.prod.yml logs --tail=200 web
docker compose -f infra/compose.prod.yml logs --tail=100 caddy
docker compose -f infra/compose.prod.yml logs --tail=100 redis
```

Ajouter `-f` pour suivre en direct, `Ctrl+C` pour sortir.

## 2. API

Sans coupure, une instance après l'autre :

```
docker restart neomoov-api-1
docker inspect --format '{{.State.Health.Status}}' neomoov-api-1
```

Répéter la seconde commande jusqu'à lire `healthy` (30 à 60 secondes), puis la même chose pour `neomoov-api-2`.

Les deux d'un coup (coupure de 30 à 60 secondes, à réserver aux heures creuses) :

```
docker compose -f infra/compose.prod.yml restart api
```

Effet : les applications reconnectent leur socket seules ; une requête en cours peut échouer et être refaite par l'application (la création d'une course porte une clé d'idempotence : aucun doublon).

## 3. Worker

```
docker compose -f infra/compose.prod.yml restart worker
docker compose -f infra/compose.prod.yml logs --tail=30 worker
```

Le journal doit afficher « Worker Neomoov démarré ». Le redémarrage est sans risque : les tâches ont des identifiants stables et chaque traitement est rejouable (détail dans `degraded-mode.md`, « Redémarrage du worker »). Vérifier ensuite dans My Hub, Administration, **Files de tâches** : les colonnes « En attente » se vident.

Attention : avec Redis, c'est le worker qui porte la répartition automatique (décision du 25 septembre sur l'étape 6). Worker arrêté = aucune offre envoyée aux chauffeurs. Pendant l'arrêt, attribuer à la main (`reattribution.md`).

## 4. Web (My Hub et réservation web)

```
docker compose -f infra/compose.prod.yml restart web
```

Coupure de My Hub et de la réservation web pendant environ 30 secondes ; les applications mobiles ne sont pas touchées ; les sessions du personnel sont conservées.

## 5. Redis

```
docker compose -f infra/compose.prod.yml restart redis
curl -s https://api.neomoov.net/v1/health
```

Les données sont conservées (persistance AOF sur le volume `redis_data`). Pendant quelques secondes : santé `degraded`, files en pause, temps réel interrompu entre les deux instances ; l'API et le worker se reconnectent seuls. Vérifier ensuite `checks.redis.status` à `ok` et les **Files de tâches** dans My Hub.

Si Redis ne redémarre pas : `docker compose -f infra/compose.prod.yml logs --tail=100 redis` et `df -h` (disque plein). Ne jamais supprimer le volume `redis_data` : il contient les tâches en attente.

## 6. Caddy (TLS et aiguillage)

Recharger la configuration sans coupure (après une modification de `infra/Caddyfile` livrée par un déploiement) :

```
docker compose -f infra/compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Redémarrer (coupure de quelques secondes ; les certificats restent dans le volume `caddy_data`) :

```
docker compose -f infra/compose.prod.yml restart caddy
```

Erreur de certificat : vérifier que les trois noms pointent vers le serveur (`nslookup api.neomoov.net`), que le pare-feu laisse passer 80 et 443 (`ufw status`), puis lire le journal de Caddy.

## 7. Appliquer une modification de `/opt/neomoov/.env`

`restart` ne relit pas le fichier `.env`. Après une modification (`nano /opt/neomoov/.env`, `Ctrl+O` pour enregistrer, `Ctrl+X` pour sortir) :

```
docker compose -f infra/compose.prod.yml up -d --force-recreate api worker
```

Ajouter `web` à la fin si la variable concerne le web (`NEOMOOV_PUBLIC_API_KEY`, `API_INTERNAL_URL`, `BOOKING_FRAME_ANCESTORS`). Les deux instances de l'API sont recréées ensemble : coupure de 30 à 60 secondes. Les variables `NEXT_PUBLIC_*` sont figées dans l'image du web à la construction : les changer demande un nouveau déploiement (`infra/deploy.sh build`), pas un simple redémarrage.

## 8. Tout le serveur

Redémarrage de la machine (mises à jour du noyau) :

```
reboot
```

Docker démarre avec le système et relance les conteneurs (`restart: unless-stopped`). Deux minutes plus tard, reprendre la section 1.

Tout relancer sans redémarrer la machine :

```
docker compose -f infra/compose.prod.yml up -d
```

## Ce qu'il ne faut jamais taper sans accord explicite du fondateur

- `docker compose ... down -v` : supprime les volumes (tâches en attente dans Redis, certificats de Caddy).
- `docker system prune -a --volumes` : même effet, sur tout le serveur.
- Toute commande qui vise la base de production (`db:reset`, `restore.sh` sur la production) : voir `base-de-donnees.md` et `sauvegardes.md`.

## Limites connues

- Docker marque une instance `unhealthy` sans la redémarrer : la tâche planifiée `/etc/cron.d/neomoov-restart-unhealthy` (posée par `infra/server-setup.sh` ; sur un serveur déjà préparé, copier la ligne indiquée en tête de `infra/scripts/restart-unhealthy.sh`) relance toutes les 5 minutes les conteneurs dont la sonde échoue, et le note dans `/var/log/neomoov-restart.log`. Le worker a sa sonde : le battement de la minute écrit `/tmp/neomoov-worker-heartbeat` ; sans battement depuis 3 minutes, il est déclaré malade.
- Aucune alerte automatique n'avertit encore d'un conteneur arrêté : la surveillance externe (Better Stack) n'est pas branchée (`docs/operations/acces-a-fournir.md`).
