# Étape 25 : facturation de la plateforme (Stripe Billing)

Revue de fin d'étape, 1er octobre 2026. Branche `etape-25b-facturation-plateforme` (agent E3). Plan : `docs/prompts/25-facturation-plateforme-crm.md`, partie « facturation » ; le CRM (HubSpot) est fait par un autre agent dans `neomoov-wt25`. Documentation : `docs/platform-billing.md`.

## Critère d'acceptation de l'amendement v1.2

« Abonnement, facture, relance et suspension progressive simulés de bout en bout » : **oui**, `apps/api/test/platform-billing.e2e.test.ts` (Stripe Billing simulé, horloge passée en paramètre du cycle, aucune attente réelle).

| Exigence de la mission | Résultat |
|---|---|
| Abonnement (Stripe simulé) | Oui : client Stripe simulé, formule et modules sur l'organisation, statut `active` ou `trialing` |
| Première facture avec frais d'installation et taxes | Oui : Pro mensuel = 1 500 $ + 199 $, TPS 84,95 $, TVQ 169,48 $, total 1 953,43 $ ; mêmes lignes et même total chez le fournisseur |
| Facture de fin de période avec ligne de véhicules | Oui : 12 véhicules actifs, 10 inclus : ligne de 2 × 15 $ ; passe rejouée sans double facture |
| Paiement réussi par webhook simulé | Oui : `invoice.paid` signé, appliqué une fois (doublon reconnu), signature invalide refusée (400) |
| Échec de paiement puis `past_due` | Oui : `invoice.payment_failed`, facture et abonnement en retard, code de refus gardé |
| Rappels à +3, +7 et +14 jours | Oui : un rappel chacun, pas de doublon à la passe suivante, courriels `billing.reminder` |
| `read_only` à +30 | Oui : abonnement et organisation en lecture seule, courriel `billing.read_only` |
| `suspended` à +45 sauf course active (reportée) | Oui : course en cours, suspension reportée (journalisée) ; course terminée, suspension à la passe suivante |
| Règlement hors plateforme et réactivation | Oui : référence gardée, Stripe prévenu (`paid_out_of_band`), organisation réactivée, courriel `billing.reactivated` ; second règlement refusé (409) |
| Journal d'audit | Oui : abonnement, émission, paiement, renouvellement, échec, rappels, changements de statut, report, règlement ; acteur humain ou `platform_billing` |
| Domaine à 100 % | Oui (voir « Tests ») |
| Adaptateur réel testé avec un faux `fetch` | Oui : client, abonnement en métadonnées, facture, règlement hors plateforme, annulation, erreurs, signature |

## Points vérifiés à la relecture

- **Montants** : jamais dans le code ; formules en base (`plans`), réglages `billing.*` et taux de taxes en base, repli sur les valeurs par défaut. Grille dans les données de départ **à valider par le fondateur** (section « Décisions »).
- **Un seul calcul** : le domaine calcule ; Stripe reçoit les lignes et les taxes déjà calculées (pas de Stripe Tax, pas d'arrondi par ligne) : le total chez Stripe est exactement celui de la facture PF.
- **Idempotence** : un client par organisation (clé `platform-customer:<organisation>`), une facture Stripe par facture PF (clés `platform-invoice:<id>:...`), une facture par période (index unique partiel), une séquence de numéros sous verrou consultatif, un événement de webhook appliqué une fois, rappels et changements de statut posés par mise à jour conditionnelle (deux processus ne doublent rien).
- **Panne du fournisseur** : abonnement et facture émis quand même ; la passe suivante crée le client et transmet la facture (testé).
- **Webhook des paiements intact** : route dédiée, secret propre ; l'événement de facturation est enregistré après traitement pour que la reprise des webhooks de paiement (qui prend toute ligne `received` ou `failed`) ne le touche jamais.
- **Jamais pendant une course** : vérifié sur les courses de l'organisation et de ses chauffeurs (`assigned`, `en_route`, `arrived`, `in_progress`).
- **Isolation** : `subscriptions` et `platform_invoices` ont les droits du rôle restreint, la sécurité au niveau des lignes et une politique `org_isolation` **en lecture seule**. La vue de l'organisation ne contient aucun identifiant Stripe.
- **Production** : `BILLING_PROVIDER=mock` en production exige `billing` dans `ALLOW_MOCK_PROVIDERS` ; le simulateur y refuse tout webhook (test `mock-webhooks-production`).
- **Secrets** : clé Stripe et secret de webhook en champs privés, jamais journalisés ni sérialisés (`toJSON`).

## Tests (1er octobre 2026)

| Commande | Résultat |
|---|---|
| `pnpm --filter @neomoov/domain test` | 33 fichiers, 439 tests verts ; couverture 100 % (instructions 1843/1843, branches 1256/1256, fonctions 335/335, lignes 1459/1459) |
| `packages/db` : `vitest run test/plans-data.test.ts test/seed-data.test.ts` | 2 fichiers, 17 tests verts (grille, modules, réglages des relances, migrations et leurs inverses) |
| `apps/api` : `vitest run test/stripe-billing-adapter.test.ts test/platform-billing-units.test.ts` | 2 fichiers, 16 tests verts (adaptateur réel par faux `fetch`, simulateur, gabarits, PDF, passe quotidienne) |
| `apps/api` : `vitest run test/env.test.ts test/mock-webhooks-production.test.ts` | verts (simulateur de la facturation refusé en production, `billing` dans `ALLOW_MOCK_PROVIDERS`) |
| Sous le verrou `agent-e3` : `vitest run --no-file-parallelism test/platform-billing.e2e.test.ts` | 1 fichier, 9 tests verts (environ 100 s) |
| Sous le verrou `agent-e3` : `vitest run --no-file-parallelism test/authorization.e2e.test.ts` | 1 fichier, 7 tests verts (78 s) : les 9 nouvelles routes ont leur politique, 401 sans jeton, 403 pour un client et un compte de service |
| Types | `domain`, `db`, `api`, `worker`, `api-client` verts |

Migration `0023_platform-billing` appliquée sur la base de développement (entrée 38 du journal de Drizzle) ; formules et réglages `billing.*` insérés. Après les tests, aucun abonnement, facture, organisation, formule ni événement de test ne reste en base.

## Revue de code

`/code-review` (effort bas) sur le module, les adaptateurs et le domaine : trois constats. Corrigés : la clé d'idempotence de la création d'une facture Stripe accompagnait des paramètres variables (délai recalculé à chaque essai, mode d'encaissement) : délai tiré des dates de la facture PF, mode d'encaissement dans la clé ; les lignes négatives (crédit) étaient omises : seules les lignes nulles le sont. Gardé et documenté : au rejeu, le simulateur rend la réponse d'origine d'une facture (comme une requête idempotente chez Stripe).

## Reste à faire

- Route d'organisation `GET /v1/org/:organizationId/billing` (agent A, `@OrgScoped`) : brancher `PlatformBillingService.billingForOrganization`, et appliquer `organizationWriteAllowed` dans la garde des organisations (aujourd'hui, le statut `read_only` ou `suspended` n'empêche encore aucune écriture : la garde n'existe pas dans cette branche).
- Écrans My Hub (agent F) : formules, abonnement, factures, vue d'ensemble, règlement hors plateforme.
- Portail client Stripe (carte par défaut pour le prélèvement automatique) : lien à ajouter dans la route d'organisation.
- Fusion avec la branche CRM : les deux branches partent de `26b5abd` ; `organization.subscribed` (déjà déclaré dans `domain-events.ts`) est émis à l'abonnement et au changement de formule, la file `crm` le prend. Conflits attendus, simples, dans `app.module.ts`, `worker.module.ts`, `queue.module.ts` (noms de files), `adapters.module.ts`, `config/env.ts`, `.env.example`, `docs/decisions.md`.
- Migration `0023_platform-billing` : appliquée sur la base de développement (entrée 38, `when` 1790853294607, après la `0022_crm` déjà appliquée par l'agent du CRM) ; à renuméroter à la fusion si besoin, sans changer son `when`.
- Décisions du fondateur (section 9 de `docs/platform-billing.md`).

## Pièges

- Six agents sur un poste de 6 Go : le typage de l'API prend plusieurs minutes ; lancer en arrière-plan.
- Ne jamais lancer `pnpm db:seed` complet sur la base partagée depuis une branche : `seedAccess` retire du catalogue les permissions qui n'existent pas dans la branche (celles des autres agents). Pour cette étape, seules les formules et les réglages `billing.*` ont été insérés, par un script ciblé.
- Les tests d'intégration créent leurs propres formules (`e2e-pro-<run>`, `e2e-solo-<run>`) et nettoient factures, abonnements, modules, avis, événements de webhook, organisations et formules ; le journal d'audit reste (ajout seul).
- Le cycle traite toutes les organisations de la base : les tests n'affirment que sur leurs propres organisations.
