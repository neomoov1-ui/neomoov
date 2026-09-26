# Plan de migration des serveurs applicatifs vers le Canada

Étape 16 (prompt 16, tâche 7 ; cahier des charges, section 10.3 ; décision D48). **Plan seulement : rien n'est exécuté dans le sprint.** La décision de migrer (ou de rester chez LWS avec une évaluation Loi 25) appartient au fondateur, avec l'avocat, avant le lancement commercial.

## 1. Point de départ

| Composant | Où aujourd'hui | Données personnelles |
|---|---|---|
| Caddy, API (2 instances), worker, web, Redis | VPS KVM LWS, centre de données en France (Paris) | En transit et en mémoire ; Redis contient des tâches en attente (identifiants, textes de notifications) |
| Base PostgreSQL et PostGIS | Supabase, région « Canada (Central) », c'est-à-dire AWS `ca-central-1`, à Montréal | Toutes, au repos |
| Documents des chauffeurs | Supabase Storage, même région (D49) | Pièces d'identité, permis, assurances |
| Sauvegardes logiques | Disque du VPS en France (`/var/backups/neomoov`), 14 jours | Copie chiffrée de toute la base |
| Fournisseurs (Stripe, Twilio, Resend, Expo, Google, Anthropic, Vapi, Meta) | Surtout aux États-Unis | Selon le service ; inchangés par la migration (EFVP, `docs/privacy/efvp.md`) |

Deux constats orientent le plan :

1. **La base est déjà à Montréal**, chez AWS par l'intermédiaire de Supabase. Seuls les serveurs applicatifs et les sauvegardes du serveur sont hors du Canada. La migration n'a pas besoin de déplacer la base : c'est une bascule de serveurs, pas une migration de données.
2. **La latence joue contre la configuration actuelle** : chaque aller-retour entre le serveur en France et la base à Montréal coûte de 80 à 100 ms, et la première offre à un chauffeur demande une quinzaine d'allers-retours (décision du 25 septembre sur la latence de la première offre), soit plus d'une seconde de réseau pour une cible de 3 secondes. Des serveurs à Montréal, dans la même région que la base, ramènent ces allers-retours à quelques millisecondes.

## 2. Options de destination

Toutes gardent `infra/compose.prod.yml`, `infra/Caddyfile`, `infra/deploy.sh` et `infra/server-setup.sh` sans modification : même mode de déploiement (`git push`), mêmes images.

| Option | Description | Pour | Contre |
|---|---|---|---|
| **A. AWS Lightsail, région Canada (Central), Montréal** | Serveur virtuel à prix fixe (8 Go, 2 vCPU, 160 Go de SSD, 5 To de transfert), IP statique, pare-feu, instantanés | Le plus proche de l'actuel (un serveur, Docker Compose) ; prix fixe et prévisible ; même région que la base ; transfert réseau inclus | Moins de souplesse que EC2 (pas de réseau privé avec d'autres services AWS sans configuration) ; 2 vCPU seulement dans le forfait 8 Go |
| **B. AWS EC2, `ca-central-1`** | Instance `t3.large` (x86, 2 vCPU, 8 Go) ou `t4g.large` (ARM, moins chère), disque gp3, IP élastique | Montée en gamme sans changer d'hébergeur (équilibreur, deux serveurs, Redis géré ElastiCache plus tard) ; remises sur engagement | Facturation à l'usage, plus de postes à surveiller ; ARM demande de vérifier que toutes les images (dont ClamAV) existent en `arm64` |
| **C. Google Cloud, `northamerica-northeast1`, Montréal** | Compute Engine `e2-standard-2` (2 vCPU, 8 Go), disque persistant, IP externe | Région montréalaise ; remises sur engagement | Base chez un autre fournisseur (Supabase sur AWS) : latence faible dans la même ville mais à mesurer ; second fournisseur à administrer |
| Pour mémoire : OVHcloud Beauharnois | Citée par la section 10.3 du cahier des charges | Serveurs au Québec, prix bas | Hors du périmètre demandé ici ; à chiffrer si le fondateur le souhaite |

**Recommandation à discuter : option A** pour la bêta et le lancement (même modèle d'exploitation que LWS, même région que la base, coût fixe), puis passage à l'option B le jour où deux serveurs et un équilibreur deviennent nécessaires. Le fondateur tranche.

Variante « tout géré » (conteneurs sur ECS Fargate ou Cloud Run, Redis géré, base RDS ou Cloud SQL à la place de Supabase) : plus robuste mais bien plus coûteuse et longue à mettre en place ; inutile au volume de la V1 (26 000 courses par mois dans le scénario à 12 mois). Quitter Supabase n'apporte rien sur la résidence : la base est déjà à Montréal.

## 3. Architecture cible (option A ou B)

```
Clients, chauffeurs, personnel, webhooks (Stripe, Twilio, Vapi, Meta)
        |
        |  DNS : zone neomoov.net chez LWS (api, hub, reserver -> IP statique à Montréal)
        v
Serveur AWS à Montréal (Ubuntu 24.04, Docker Compose, pare-feu 22, 80, 443)
   caddy (TLS)  ->  api x2 , web
   worker , redis (volume persistant) , clamav (antivirus des documents)
        |
        |  TLS, même région AWS (quelques ms)
        v
Supabase ca-central-1 (Montréal) : PostgreSQL + PostGIS, Storage (documents), sauvegardes Supabase
        +
Seau S3 ca-central-1 : copie chiffrée des sauvegardes logiques (BACKUP_REMOTE, rclone), 35 jours
```

Rien d'autre ne change : domaines, clés des fournisseurs, adresses des webhooks, applications mobiles (elles parlent à `api.neomoov.net`).

## 4. Étapes

### Phase 0 : décision et préparation (J-21 à J-14)

1. Décision écrite du fondateur (option, date) après avis de l'avocat ; entrée dans `docs/decisions.md`.
2. Compte AWS au nom de l'entreprise : validation en deux étapes sur l'utilisateur racine, un utilisateur d'administration distinct, alerte de budget (par exemple 150 $ US par mois).
3. Mettre à jour l'EFVP et la politique de confidentialité (lieu d'hébergement des serveurs) pour la date de bascule.

### Phase 1 : construire la cible (J-14 à J-7)

1. Créer l'instance à Montréal (Ubuntu 24.04), lui attacher une IP statique, ouvrir 22, 80 et 443 dans le pare-feu du fournisseur.
2. Déposer la clé SSH, puis préparer le serveur avec le même script : `ssh root@<nouvelle IP> 'bash -s' < infra/server-setup.sh` (sur Ubuntu d'AWS, l'utilisateur initial est `ubuntu` : passer par `sudo` ou autoriser la clé pour `root` d'abord).
3. Copier le fichier `.env` de production de serveur à serveur, sans l'afficher, depuis le poste (Git Bash) : `scp -3 root@<ancienne IP>:/opt/neomoov/.env root@<nouvelle IP>:/opt/neomoov/.env`. Les secrets doivent rester **identiques** (`ENCRYPTION_KEY`, `JWT_*`) : sinon les champs chiffrés deviennent illisibles et toutes les sessions tombent.
4. Pour la répétition, remplacer sur le nouveau serveur `DATABASE_URL` par celle de la base de **staging** (jamais deux workers sur la base de production en même temps : ils se partageraient les passes planifiées sans verrou commun).
5. Autoriser la nouvelle IP en plus de l'ancienne sur la clé serveur Google Maps (restriction par adresse IP).
6. Copier les certificats TLS de Caddy (ils ne dépendent pas de l'adresse IP), pour que le nouveau serveur réponde en HTTPS avant la bascule du DNS :

```
ssh root@<ancienne IP> "tar -C /var/lib/docker/volumes/neomoov_caddy_data/_data -czf - ." | ssh root@<nouvelle IP> "mkdir -p /var/lib/docker/volumes/neomoov_caddy_data/_data && tar -C /var/lib/docker/volumes/neomoov_caddy_data/_data -xzf -"
```

7. Déployer sur le nouveau serveur : `git remote add canada ssh://root@<nouvelle IP>/opt/neomoov.git`, puis `git push canada main`.
8. Ajouter le service ClamAV s'il a été ajouté à la composition entre-temps (il manque aujourd'hui, voir le rapport de l'étape 16), la tâche planifiée de sauvegarde (`docs/runbooks/sauvegardes.md`) et `BACKUP_REMOTE` vers un seau S3 de `ca-central-1`.

### Phase 2 : répétition (J-7 à J-3), contre la base de staging

Depuis le poste, en visant la nouvelle IP sans toucher au DNS :

```
curl --resolve api.neomoov.net:443:<nouvelle IP> https://api.neomoov.net/v1/health
curl -sI --resolve hub.neomoov.net:443:<nouvelle IP> https://hub.neomoov.net/hub/connexion
```

Pour un essai complet dans le navigateur, ajouter temporairement les trois noms avec la nouvelle IP dans le fichier `hosts` du poste (`C:\Windows\System32\drivers\etc\hosts`, droits d'administrateur), puis les retirer. Mesurer la latence de la base (`checks.database.latencyMs` de `/v1/health`, attendu : quelques millisecondes) et le temps de la première offre avec le jeu de données de l'étape 15. Arrêter ensuite le worker de la cible (`docker compose -f infra/compose.prod.yml stop worker`).

### Phase 3 : bascule (fenêtre de maintenance de 60 minutes)

Choisir une nuit de semaine sans réservation dans la fenêtre (vérifier **Courses**, vue « Planifiées »), en dehors de 3 h à 4 h (conservation et sauvegarde). Annoncer la fenêtre aux chauffeurs et aux clients de la bêta 48 heures avant (courriel ou texto préparé à la main).

J-2 : baisser la durée de vie (TTL) des trois enregistrements `api`, `hub`, `reserver` de 3 600 à 300 secondes dans la zone DNS de LWS.

Pendant la fenêtre :

| # | Geste | Où | Durée |
|---|---|---|---|
| 1 | Arrêter l'API, le worker et le web de l'ancien serveur : `docker compose -f infra/compose.prod.yml stop worker api web` | Ancien serveur | 1 min |
| 2 | Figer Redis : `docker compose -f infra/compose.prod.yml exec redis redis-cli SAVE`, puis `docker compose -f infra/compose.prod.yml stop redis` | Ancien serveur | 1 min |
| 3 | Arrêter Redis sur la cible (`docker compose -f infra/compose.prod.yml stop redis`) et copier les données de Redis (tâches en attente, reprises), depuis le poste : `ssh root@<ancienne IP> "tar -C /var/lib/docker/volumes/neomoov_redis_data/_data -czf - ." \| ssh root@<nouvelle IP> "rm -rf /var/lib/docker/volumes/neomoov_redis_data/_data/* && tar -C /var/lib/docker/volumes/neomoov_redis_data/_data -xzf -"` | Poste | 2 min |
| 4 | Remettre la `DATABASE_URL` de **production** dans le `.env` de la cible (copie exacte de l'ancien fichier) | Cible | 2 min |
| 5 | Démarrer la cible : `docker compose -f infra/compose.prod.yml up -d` | Cible | 2 min |
| 6 | Contrôles par `--resolve` (section Phase 2) : santé `ok`, base `ok`, Redis `ok` | Poste | 3 min |
| 7 | Changer les trois enregistrements A vers la nouvelle IP | Panel LWS, zone DNS | 5 min |
| 8 | Attendre la propagation (`nslookup api.neomoov.net` renvoie la nouvelle IP) | Poste | 5 à 10 min |
| 9 | Tests de réception (section 5) | Poste, téléphone | 20 min |
| 10 | Décision : bascule confirmée, ou retour arrière (section 6) | Fondateur | |

Après la fenêtre :

- Garder l'ancien serveur **arrêté mais intact** pendant 14 jours (retour arrière), puis copier ses sauvegardes restantes (`/var/backups/neomoov`) vers le seau S3 et résilier le VPS.
- Retirer l'ancienne IP de la restriction de la clé Google Maps.
- Remonter la TTL du DNS à 3 600 secondes après 48 heures.
- Mettre à jour `docs/runbooks/deploiement-lws.md` (adresse, nom du dépôt distant) et le registre d'exploitation.

## 5. Tests de réception

| Test | Attendu |
|---|---|
| `GET https://api.neomoov.net/v1/health` | `ok`, base en quelques millisecondes |
| Connexion à My Hub avec second facteur | Tableau de bord, pastille « Temps réel actif » |
| Devis depuis l'application client | Prix non estimé (Google Routes joignable depuis la nouvelle IP) |
| Course d'essai du fondateur : réservation, offre, acceptation, suivi, fin | Offre reçue en moins de 3 secondes après la demande |
| Code de connexion par texto | Reçu |
| Notification push | Reçue |
| Webhooks : renvoyer un événement de test depuis Stripe, texto entrant Twilio, appel à l'agent vocal, message WhatsApp | Acceptés (200) |
| Téléversement d'un document de test | Analysé par l'antivirus, stocké |
| Files de tâches | Tâches copiées depuis l'ancien Redis traitées, aucune en échec |
| Sauvegarde de la nuit suivante | « Sauvegarde vérifiée », copie présente dans le seau S3 |

## 6. Retour arrière

- **Pendant la fenêtre** (avant confirmation) : arrêter la cible (`docker compose -f infra/compose.prod.yml stop worker api web`), remettre les trois enregistrements DNS sur l'ancienne IP, redémarrer l'ancien serveur (`docker compose -f infra/compose.prod.yml up -d`). Son Redis est intact (état du début de fenêtre). Durée : 10 minutes plus la propagation (TTL de 300 s).
- **Après confirmation** (dans les 14 jours) : même geste en sens inverse, y compris la copie de Redis de la cible vers l'ancien serveur (étapes 1 à 3 de la phase 3). La base n'a pas bougé : aucune donnée métier à reprendre.

## 7. Estimation du coût mensuel

**Ordres de grandeur à vérifier sur les calculateurs officiels avant toute décision.** Hypothèses : prix publics sans remise d'engagement, hors taxes ; taux de change supposé de 1 $ US = 1,37 $ CA et 1 € = 1,55 $ CA (à remplacer par le taux du jour de la Banque du Canada) ; volume de la bêta et des premiers mois (moins de 100 Go de transfert sortant par mois, base de quelques Go).

| Poste | Option A : Lightsail | Option B : EC2 `t3.large` | Option C : Google `e2-standard-2` | Source |
|---|---|---|---|---|
| Serveur (2 vCPU, 8 Go) | 44 $ US (disque de 160 Go et 5 To de transfert inclus) | environ 68 $ US (environ 0,093 $ US de l'heure, à vérifier) ; environ 54 $ US en `t4g.large` ARM | environ 54 $ US (0,0738 $ US de l'heure, prix affiché) | Lightsail : aws.amazon.com/lightsail/pricing (consulté le 26 septembre 2026) ; EC2 : aws.amazon.com/ec2/pricing/on-demand ; Google : cloud.google.com/compute/vm-instance-pricing, relevé par gcloud-compute.com |
| Disque | Inclus | environ 7 $ US (gp3, 80 Go) | environ 9 $ US (disque équilibré, 80 Go) | Pages de prix des fournisseurs |
| Adresse IP publique | Incluse (IP statique attachée) | environ 3,65 $ US | environ 3 $ US | Idem |
| Transfert sortant | Inclus | 100 Go gratuits par mois au niveau du compte, puis environ 0,09 $ US par Go | environ 0,12 $ US par Go au-delà du palier gratuit | Idem |
| Instantanés du serveur | environ 1 à 2 $ US (0,05 $ US par Go et par mois) | environ 1 à 2 $ US | environ 1 à 2 $ US | Idem |
| Seau S3 pour les sauvegardes (35 jours) | Moins de 1 $ US | Moins de 1 $ US | Moins de 1 $ US (ou Cloud Storage) | aws.amazon.com/s3/pricing |
| **Sous-total serveurs** | **environ 46 $ US, soit environ 63 $ CA** | **environ 80 $ US, soit environ 110 $ CA** (environ 90 $ CA en ARM) | **environ 70 $ US, soit environ 96 $ CA** | |
| Supabase (inchangé, toutes options) : plan Pro 25 $ US, calcul Small 15 $ US moins 10 $ US de crédit, projet de staging Micro 10 $ US | environ 40 $ US, soit environ 55 $ CA | idem | idem | supabase.com/pricing (consulté le 26 septembre 2026) |
| Supabase, restauration à un instant donné sur 7 jours (exigée avant le lancement commercial pour une perte d'au plus 1 heure, section 2.1), **avec ou sans migration** | 100 $ US, soit environ 137 $ CA | idem | idem | supabase.com/pricing |

Comparaison : le VPS KVM M de LWS coûte 19,99 € HT par mois (`docs/comptes-externes.md`), soit environ 31 $ CA. L'option A ajoute donc de l'ordre de **30 à 35 $ CA par mois** pour les serveurs ; l'option B de l'ordre de 60 à 80 $ CA ; l'option C de l'ordre de 65 $ CA. Le poste qui pèse le plus au lancement n'est pas la migration mais la restauration à un instant donné de Supabase (environ 137 $ CA par mois), due dans tous les cas.

Pour aller plus loin : AWS Pricing Calculator (calculator.aws), Google Cloud Pricing Calculator (cloud.google.com/products/calculator). Les remises d'engagement d'un an (Savings Plans chez AWS, engagements d'utilisation chez Google) réduisent le prix des serveurs de l'ordre de 30 à 40 % ; elles n'ont de sens qu'après quelques mois de mesure.

## 8. Décisions à prendre par le fondateur

1. Migrer ou rester chez LWS avec l'évaluation Loi 25 (avec l'avocat, section 10.3).
2. Si migration : option A, B ou C.
3. Date de la fenêtre de maintenance (avant le lancement commercial ; idéalement avant la vague 2 de la bêta, pour mesurer la bêta dans les conditions du lancement).
4. Activation de la restauration à un instant donné de Supabase (indépendante de la migration).
