# Revue de l'étape 25, partie CRM HubSpot (1er octobre 2026)

Périmètre : adaptateur CRM (interface, simulé, HubSpot réel), table `crm_records` et sa migration, script `crm:setup`, file `crm` et synchronisation avec consentement, tests, guide `docs/crm.md`. La facturation de la plateforme (domaine `platform-billing`, Stripe Billing, abonnements) a été confiée à un autre agent le 1er octobre, à partir du commit `26b5abd` : elle n'est pas couverte ici.

Branche `etape-25-facturation-crm` (copie `neomoov-wt25`). Commits : `5d62081` et `26b5abd` (agent précédent, « En cours »), puis le commit « Étape 25 : HubSpot prêt (adaptateur, script de mise en place, guide) ».

## Critères et résultat

| Critère (prompt 25, points 4, 6 et 7) | Résultat |
|---|---|
| Interface `CrmProvider` : `upsertContact`, `upsertCompany`, `upsertDeal`, `addNote`, tous avec l'indicateur de consentement | Fait (`apps/api/src/adapters/types.ts`) ; sans consentement : 422 `CRM_CONSENT_REQUIRED`, simulé comme réel |
| `crm.mock.ts` en mémoire, panne simulable | Fait (`unavailable` : 502 `CRM_PROVIDER_ERROR`) |
| `hubspot.real.ts` : API v3, jeton d'application privée, propriétés et pipelines de l'étude 06 | Fait ; modèle dans `hubspot-model.ts` (groupe « Neomoov », 10 propriétés de contact, 9 d'entreprise, 6 de transaction, pipelines « Ventes B2B » et « Formation chauffeurs ») |
| Variable `CRM_PROVIDER`, `ALLOW_MOCK_PROVIDERS` | Fait (alias `crm`), `.env.example` à jour (`CRM_PROVIDER`, `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PORTAL_ID`) |
| Script idempotent `crm:setup` | Fait ; `--dry-run` ne fait que lire ; portée manquante signalée section par section (code de sortie 3) |
| File BullMQ `crm` avec relance | Fait : 5 tentatives exponentielles, passe de reprise toutes les 10 minutes (worker avec Redis, API sinon) |
| Prospect avec consentement : contact et transaction dans le pipeline correspondant | Fait (candidat chauffeur et préinscription : « Formation chauffeurs » ; entreprise et partenaire : « Ventes B2B ») ; message libre en note, une seule fois |
| Compte d'affaires : entreprise et contact | Fait (plus une transaction « Client actif ») ; rattrapage par la passe, car aucune route ne crée encore de compte d'affaires |
| Organisation créée ou abonnée : entreprise et transaction « Ventes B2B » | Fait ; l'événement `organization.subscribed` sera émis par la facturation à la fusion |
| Préinscription Formation chauffeurs | Fait : nouveau type de prospect `training` (contrainte `leads_kind`, schéma public, OpenAPI) |
| Jamais de trajet, d'adresse personnelle ni de paiement ; sans consentement rien | Fait (entrées sans ces champs, garde `assertCrmPropertiesMinimal`, prospect sans `consent_at` ou écarté : `skipped`) |
| `crm_records` garde les identifiants externes ; réservée à la plateforme | Fait (migration 0022 : sécurité au niveau des lignes activée sans politique, donc fermée à `neomoov_scoped`) |
| `crm.e2e.test.ts` : consentement, sans consentement, compte d'affaires, relance après panne | Fait, 5 tests verts |
| `docs/crm.md`, `docs/decisions.md`, `.env.example` | Faits (guide pas à pas, état réel du compte au 1er octobre, portées à ajouter) |
| OpenAPI régénérée | Faite (seul changement : type de prospect `training`) ; `api-client` compile |

## Tests lancés (1er octobre 2026)

- `pnpm --filter @neomoov/domain build`, `@neomoov/db build`, `@neomoov/api-client build` : verts.
- Types : `pnpm --filter @neomoov/api typecheck`, `@neomoov/web typecheck`, `@neomoov/worker typecheck`, `@neomoov/domain typecheck` : verts (l'échec du web signalé par l'agent précédent venait du paquet `api-client` non construit).
- `apps/api` : `vitest run test/crm-adapters.test.ts` : 8 sur 8 (faux serveur HubSpot, sans réseau) ; avec `test/env.test.ts` et `test/mock-webhooks-production.test.ts` : 16 sur 16 au premier passage.
- `packages/domain` : `vitest run test/admin.test.ts` : 6 sur 6.
- Migration 0022 appliquée sur la base de développement sous le verrou `agent-e` (`drizzle.__drizzle_migrations` : identifiant 34, `created_at` 1790815798588) ; vérifié : table `crm_records`, sécurité au niveau des lignes active, droits de `neomoov_scoped`, contrainte `leads_kind` avec `training`.
- `crm.e2e.test.ts` sous le verrou `agent-e` : 5 sur 5.

## `crm:setup` contre le vrai compte HubSpot (1er octobre 2026)

Lancé une fois en simulation puis pour de vrai (`with-env.cjs`), sans afficher le jeton ; aucun contact créé.

- Compte 343738989, formule gratuite, emplacement des données `na3` (`app-na3.hubspot.com`, centre de Montréal selon les pages publiques de HubSpot), fuseau Heure de l'Est, **devise USD** (à passer en CAD).
- Résultat : **rien créé**. La création du groupe de propriétés « Neomoov » est refusée faute de portée d'écriture des schémas ; les propriétés des entreprises, des transactions et les pipelines ne sont même pas lisibles.
- Permissions constatées par lectures et par une modification vide d'une fiche inexistante (sans effet) : lecture et écriture des contacts, lecture des propriétés des contacts ; rien sur les entreprises ni les transactions.
- Portées à ajouter : `crm.schemas.contacts.write` ; `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.schemas.companies.read`, `crm.schemas.companies.write` ; `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.deals.read`, `crm.schemas.deals.write`. Ensuite relancer `crm:setup` (attendu au premier passage complet : 3 groupes, 25 propriétés, pipeline unique renommé « Neomoov » avec 12 étapes ajoutées, ou deux pipelines si le compte les permet).
- Le jeton n'est pas reconnu par l'API d'information des applications privées (404) : il vient probablement d'une clé de service ; sans effet pour la plateforme.

## Corrections apportées par cette reprise

- Adaptateur : un échec d'appel groupé rendu en 207 (cause dans `errors`) est lu comme une erreur (courriel déjà pris : mise à jour de la fiche existante) au lieu d'une « réponse sans identifiant ».
- Adaptateur : portées exigées extraites des refus 403 (contexte `MISSING_SCOPES` et texte « requires one of [companies-read] », traduit en portée à cocher) ; un 403 de portée n'est plus pris pour la limite de pipelines de la formule gratuite (il aurait déclenché le renommage du pipeline).
- `crm:setup` : une portée manquante n'arrête plus tout ; rapport par section, limité aux portées de l'objet concerné, code de sortie 3.
- Passe de reprise : rattrapage des comptes d'affaires jamais présentés (en plus des prospects), borne `since` (test robuste dans une base partagée).

## Reste à faire

1. Fondateur : ajouter les 9 portées, passer la devise en CAD, confirmer l'emplacement des données (capture pour l'EFVP), puis relancer `crm:setup` (ou le demander). Garder `CRM_PROVIDER=mock` jusque-là.
2. Après le premier passage complet : essai de bout en bout avec un vrai formulaire (guide, étape 6), puis `CRM_PROVIDER=real` en production (API et worker).
3. Fusion : l'événement `organization.subscribed` doit être émis par le module de facturation (autre agent) ; une route de création des comptes d'affaires, quand elle existera, émettra `business_account.created` (en attendant, la passe rattrape).
4. My Hub : affichage de l'état CRM d'une fiche (`CrmSyncService.records`) non fait (hors prompt).
5. Webhooks HubSpot vers la plateforme (changement d'étape fait à la main) : hors périmètre.

## Pièges

- Le typecheck du web échoue tant que `@neomoov/api-client` n'est pas construit (pas une erreur de code).
- HubSpot formule ses refus de portée de deux façons (catégorie `MISSING_SCOPES` avec la liste des portées acceptables, ou message « requires one of [deals-read] » avec l'ancien nom) ; la liste « une de » est longue et contient des portées sans rapport : ne retenir que celles de l'objet.
- Une modification vide (`PATCH` sans propriété) d'une fiche inexistante est un bon test d'autorisation sans effet : 400 ou 404 si la portée est accordée, 403 sinon.
- `db:migrate` : la migration 0022 est passée car son `when` dépassait la dernière migration appliquée (33) ; la renumérotation est faite par la session principale à la fusion.
- `env.test.ts` et `mock-webhooks-production.test.ts` citent déjà `billing` et `BILLING_PROVIDER` (agent précédent, en prévision de la facturation) : sans effet tant que la variable n'existe pas (alias inconnu ignoré, clé retirée par Zod), à garder pour la fusion avec la facturation.
