# Manuels d'exploitation

Procédures pas à pas pour exploiter la plateforme Neomoov. Chaque manuel se lit en situation d'urgence et ne contient aucun secret (les secrets sont dans `/opt/neomoov/.env` sur le serveur et dans le gestionnaire de mots de passe). Journée type du fondateur : `docs/operations/daily.md`.

## Par situation

| Situation | Manuel |
|---|---|
| Un service ne répond plus, redémarrer l'API, le worker, le web, Redis ou Caddy | `redemarrer-un-service.md` |
| Un fournisseur est en panne (Stripe, Twilio, Google, Expo, Resend, modèle de langage, Vapi, SEV, Redis, base) | `degraded-mode.md` |
| Restaurer une sauvegarde | `sauvegardes.md` |
| Appliquer ou retirer une migration, charger les données de départ | `base-de-donnees.md` |
| Régénérer ou ajuster un relevé de chauffeur | `releves.md` |
| Forcer une réattribution ou attribuer une course à la main | `reattribution.md` |
| Interrompre une course en cours (accident, malaise, chauffeur injoignable) | `reattribution.md`, « Course en cours » |
| L'API refuse de démarrer après un changement de `.env` (« Configuration invalide ») | `redemarrer-un-service.md`, section 7 ; `../operations/acces-a-fournir.md`, « Démarrage de l'API en production » |
| Désactiver un drapeau `FEATURE_*`, changer un réglage, couper un agent ou un canal | `drapeaux-et-reglages.md` |
| Faire tourner un secret (dont `ENCRYPTION_KEY`) | `secrets-et-cles.md` |
| Incident de confidentialité (Loi 25) | `incident-confidentialite.md` |
| Publier une version des applications mobiles | `publication-mobile.md` |
| Inviter les testeurs, collecter et trier les retours de la bêta | `../beta/procedure.md` |
| Déployer une nouvelle version du serveur, retour arrière | `deploiement-lws.md` |
| Comptes du personnel, second facteur perdu, clés de service | `personnel-my-hub.md` |
| Une alerte Sentry ou Better Stack, lire les métriques, suivre une requête (identifiant de corrélation) | `observabilite.md` |

## Index

| Manuel | Contenu | État |
|---|---|---|
| `deploiement-lws.md` | DNS, préparation du VPS LWS (`infra/server-setup.sh`, tâches planifiées, `ALLOW_MOCK_PROVIDERS`), déploiement par `git push lws main` (`infra/deploy.sh`) ou par GitHub Actions (`deploy.yml`, approbation), images GHCR, vérification, journaux, retour arrière | Écrit le 24 septembre 2026 ; mis à jour à la revue finale (26 septembre) |
| `personnel-my-hub.md` | Premier administrateur (`create-staff`), connexion avec second facteur, codes de secours, autres membres du personnel, téléphone perdu, clés de service, journal d'audit | Écrit le 25 septembre 2026 |
| `sauvegardes.md` | Sauvegarde logique chiffrée quotidienne (`infra/scripts/backup.sh`), vérification, confirmation qui autorise les purges de conservation, restauration (`restore.sh`) dans une base de secours ou en production, restauration par Supabase | Écrit le 26 septembre 2026 ; essai de restauration à faire sur le serveur |
| `base-de-donnees.md` | Migrations à chaque déploiement et à la main, liste des migrations appliquées, retour arrière, données de départ, interdits | Écrit le 26 septembre 2026 (étape 16) |
| `degraded-mode.md` | Ce qui continue quand un fournisseur tombe, ce que voit et fait l'exploitation, disjoncteurs et santé, redémarrage du worker | Écrit le 26 septembre 2026 |
| `redemarrer-un-service.md` | Lecture de l'état (`ps`, `/v1/health`, journaux), redémarrage de l'API sans coupure, du worker, du web, de Redis, de Caddy, prise en compte d'une modification de `.env`, redémarrage du serveur, commandes interdites | Écrit le 26 septembre 2026 (étape 16) |
| `releves.md` | Passes automatiques du vendredi et du lundi, régénération d'une semaine, ajustement d'un brouillon, correction d'un relevé émis, émission et règlement à la main, motifs d'échec, limite connue du solde négatif (aucun écran de prélèvement), contrôle du vendredi | Écrit le 26 septembre 2026 (étape 16) ; mis à jour à la revue finale |
| `reattribution.md` | Réactions automatiques, boutons de la fiche de course, remplacer un chauffeur, donner une course à un chauffeur précis, planifiée non confirmée, `no_driver`, interruption d'une course en cours, courses figées et alertes par courriel | Écrit le 26 septembre 2026 (étape 16) ; mis à jour à la revue finale |
| `drapeaux-et-reglages.md` | Réglages de My Hub, modes des agents, drapeaux `FEATURE_*` et interrupteurs d'urgence (`DISPATCH_MODE`, `AGENT_TRIGGERS`), couper un canal chez le fournisseur, table `feature_flags` sans effet | Écrit le 26 septembre 2026 (étape 16) |
| `secrets-et-cles.md` | Où vivent les secrets, qui y accède, procédure générale, particularités par secret, rotation de `ENCRYPTION_KEY` (champs chiffrés, second facteur du personnel, codes QR des factures) | Écrit le 26 septembre 2026 (étape 16) |
| `incident-confidentialite.md` | Définition, délais, confinement, registre, évaluation du préjudice sérieux, avis à la CAI et aux personnes, modèle d'entrée de registre | Écrit le 26 septembre 2026 (étape 16) ; à faire relire par l'avocat |
| `publication-mobile.md` | État de la configuration EAS, build ou mise à jour à la volée, numéros de version et de build, construire et soumettre, distribution, retour arrière, liste de chaque version | Écrit le 26 septembre 2026 (étape 16) |
| `observabilite.md` | Identifiant de corrélation (du mobile aux files), suivi des erreurs Sentry (projets, variables, lecture), métriques de My Hub et format Prometheus, sondes et alertes Better Stack à créer, réaction à une alerte | Écrit le 26 septembre 2026 ; comptes Sentry et Better Stack à ouvrir |

Documents liés : `docs/operations/daily.md` (journée type), `docs/operations/acces-a-fournir.md` (accès à ouvrir pour la mise en ligne), `docs/operations/migration-canada.md` (plan de migration), `docs/beta/` (bêta fermée), `docs/store/` (fiches des magasins).

Validation par le fondateur (critère d'acceptation de l'étape 16) : **à faire**. Noter ici la date de relecture de chaque manuel.

## Commandes de base (poste de développement)

```
pnpm db:migrate      applique les migrations sur DATABASE_URL
pnpm db:rollback     retire la dernière migration
pnpm db:seed         charge les données de départ
pnpm dev:api         API sur http://localhost:4000 (santé : /v1/health, OpenAPI : /v1/docs)
pnpm dev:web         web sur http://localhost:3000
pnpm openapi         régénère packages/api-client/src/openapi.json
pnpm env:check       bilan du .env du poste, sans afficher une valeur
pnpm --filter @neomoov/api create-staff --email … --phone … --first … --last … --roles admin   (mot de passe dans STAFF_PASSWORD)
```

## Commandes de base (serveur, dans `/opt/neomoov`)

```
docker compose -f infra/compose.prod.yml ps                     état des conteneurs
docker compose -f infra/compose.prod.yml logs --tail=200 api    journaux (api, worker, web, caddy, redis)
curl -s https://api.neomoov.net/v1/health                       santé de l'API, de la base, de Redis, des fournisseurs
```
