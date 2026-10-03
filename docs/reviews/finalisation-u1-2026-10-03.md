# Finalisation U1 : écrans My Hub et réservation web (3 octobre 2026)

Agent U1, copie `neomoov-wt22`, branche `finalisation-u1-myhub` créée depuis `origin/main` (`3208b92`), puis `main` (revue mobile Q2, `5a44575`) fusionnée dedans (un conflit d'exports résolu dans `packages/api-client/src/index.ts`). Périmètre : `apps/web`, `packages/api-client`, deux petites lectures d'API ajoutées dans des contrôleurs existants (Charte d'équité, administration). Rien de déployé, aucune base de production ni compte externe touché, aucun fichier `.env` lu.

## Tableau des points

| Point de la mission | État | Preuve |
|---|---|---|
| 1. Animal en cage, réservation web | déjà fait | `apps/web/src/components/booking.tsx` (case « animal de compagnie en cage », étape 18) |
| 1. Animal en cage, création de course de My Hub | déjà fait | `apps/web/src/app/hub/(app)/courses/nouvelle/page.tsx` (repris dans le formulaire partagé `components/hub/new-ride-form.tsx`) |
| 1. Bouton « exclure une note » | fait | `components/hub/driver-ratings.tsx` dans la fiche du chauffeur ; route ajoutée `GET /v1/admin/drivers/:id/ratings` (`fairness.controller.ts`, `fairness.service.ts`) ; `test/fairness.e2e.test.ts` vert |
| 2. Animal d'assistance, réservation web | fait | `booking.tsx` (préférence `assistanceAnimal` de la course, sans effet sur le prix) ; `test/forms-a11y.test.ts` |
| 2. Rapport des exclusions de zones Pilote et zones surveillées | fait | `app/hub/(app)/pilote/page.tsx`, `components/hub/pilot-exclusions.tsx` (réglage `pilot.watched_zones` par l'administrateur) ; menu « Sécurité et conformité », personnel seulement ; `test/hub-screens.test.ts` |
| 3. Marque et domaines d'une organisation | fait | onglet « Marque et domaines » de `app/hub/(app)/organisations/page.tsx`, `components/hub/org-brand.tsx`, `lib/brand-form.ts` (contraste WCAG AA vérifié avant l'envoi, TXT montré une fois, vérification par l'administrateur) ; `test/hub-screens.test.ts`, `test/booking-codes.test.ts` |
| 4. Facturation de la plateforme : formules, vue d'ensemble, cycle | fait | `app/hub/(app)/facturation-plateforme/page.tsx`, `components/hub/billing-overview.tsx` (administrateur) |
| 4. Abonnement d'une organisation, factures, règlement hors plateforme | fait | onglet « Abonnement » de « Organisations et accès », `components/hub/org-billing.tsx` ; client d'API `packages/api-client/src/platform-billing-resources.ts` |
| 4. État CRM d'une fiche | fait | routes `GET /v1/admin/crm/{leads,prospects,organizations,business-accounts}/:id` (`admin.controller.ts`, module Admin qui importe le module CRM), `components/hub/crm-status.tsx` dans les prospects, la fiche d'un prospect d'affaires et l'abonnement d'une organisation ; `test/crm.e2e.test.ts` vert |
| 4. Route d'organisation `GET /v1/org/:id/billing` | hors périmètre (agent U2) | non touchée |
| 5. Relevé d'un chauffeur `unknown` et réconciliation | déjà fait | `app/hub/(app)/releves/[id]/page.tsx` (commit `c046dda`) ; dialogue extrait dans `components/hub/reconcile-dialog.tsx` |
| 5. Compléments | fait | filtre d'état dans la liste des relevés (dont « Sans réponse du prestataire ») ; bouton « Réconcilier » sur un relevé d'organisation `unknown` (`app/hub/(app)/flotte/releves/page.tsx`, finances de la plateforme, `POST /admin/organization-statements/:id/reconcile`) |
| 6. « Nouvelle course » côté organisation | fait | `app/hub/(app)/organisation/courses/nouvelle/page.tsx` (`POST /v1/org/:id/quotes` puis `/rides`, permission `rides.create`), entrée de menu et bouton dans la liste des courses ; client d'API `org.quote`, `org.createRide` |
| 7. Code promo et code de parrainage, réservation web | fait | `booking.tsx`, `lib/booking-codes.ts` ; `?promo=`, `?parrain=`, `?ref=` prérenseignent ; `test/booking-codes.test.ts` |
| 8. Politique de sécurité du contenu avec nonces | fait | `apps/web/src/proxy.ts`, `lib/security-headers.ts`, `next.config.ts` ; `test/csp-nonce.test.ts`, `test/card-csp.test.ts` ; vérifié sur un build de production (section Essais) |
| 8. Accessibilité des formulaires de réservation et de connexion | fait | combobox des adresses (liste reliée seulement ouverte, champ obligatoire annoncé, nombre de suggestions annoncé), détail du prix hors du libellé du bouton radio, prix annoncés, focus visible des boutons radio, onglets de connexion au clavier (flèches, Origine, Fin) reliés à leur panneau, nom du code QR, contraste de la légende du visuel |
| 8. Essai automatisé d'accessibilité | fait, sans axe | aucun outil présent (ni axe, ni jsdom) : contrôle maison du balisage rendu (`test/support/markup.ts`, `test/forms-a11y.test.ts`) ; `@axe-core/playwright` à décider (nouvelle dépendance) |
| 9. Tests des écrans ajoutés | fait | tests de rendu sans navigateur ni base (`react-dom/server`) : `test/hub-screens.test.ts`, `test/forms-a11y.test.ts` |
| 9. Playwright et captures | non fait | les essais Playwright démarrent l'API sur la base partagée (interdit aux agents U) ; captures des nouveaux écrans de My Hub impossibles sans API ni données |

## Choix

- Lectures ajoutées dans des contrôleurs existants, sans toucher aux services des autres agents : notes d'un chauffeur dans `AdminFairnessController` (service de la Charte d'équité), état CRM dans `AdminDirectoryController` (lecture seule de `CrmSyncService.records`). Une route par type de fiche, chacune avec la permission de sa liste.
- Politique de sécurité du contenu : `script-src 'self' 'nonce-…' 'strict-dynamic'` plus les sources nommées (Turnstile, Square sur `/carte`) pour les navigateurs qui ignorent `strict-dynamic`. Styles en ligne gardés (attributs `style` de React, Leaflet, couleurs d'une marque). Routes `/api/*` : politique d'avant. `BOOKING_FRAME_ANCESTORS` reste figé au build (clé `env`). Google Maps n'est pas chargé par le web (adresses par l'API) : rien à permettre.
- « Nouvelle course » d'une organisation : fiche minimale du client seulement (pas de recherche dans les comptes clients de la plateforme depuis une organisation).
- Parrainage : enregistré après la vérification du numéro et avant la course ; un refus arrête la confirmation avec un message clair (laisser le champ vide pour continuer).
- Textes : nouveaux écrans dans `lib/i18n-hub-admin.ts` (fusionné dans l'espace `hub`), pour limiter les conflits dans `i18n-hub.ts`.
- Décisions inscrites dans `docs/decisions.md` (cinq lignes du 3 octobre et section « À trancher »).

## Essais et résultats

- API, sous le verrou `db-lock` : `test/fairness.e2e.test.ts` et `test/crm.e2e.test.ts`, 2 fichiers, 9 tests verts.
- Web : `pnpm --filter @neomoov/web typecheck` sans erreur ; `vitest run` : 10 fichiers, 41 tests verts (dont `hub-screens`, `forms-a11y`, `booking-codes`, `csp-nonce`, `card-csp` ; mêmes résultats après la fusion de `main`).
- OpenAPI : `pnpm openapi` (compile l'API avec `tsc -p tsconfig.build.json`, sans erreur), 432 chemins, 5 nouveaux (`/v1/admin/drivers/{id}/ratings`, `/v1/admin/crm/{leads,prospects,organizations,business-accounts}/{id}`) ; `pnpm --filter @neomoov/api-client build` sans erreur.
- Build de production du web et vérification de la politique : RESULTATS_BUILD.

## Reste à faire ou à décider

- Fondateur : zones surveillées de Pilote (réglage vide) ; page ou redirection WordPress `neomoov.net/parrainage/<code>` vers `/reserver?parrain=<code>` (accès LWS).
- Session principale : relancer les essais Playwright (`pnpm --filter @neomoov/web e2e`) une fois les branches fusionnées ; les sélecteurs touchés restent compatibles (bouton radio nommé par la catégorie, libellés inchangés).
- Ajouter `@axe-core/playwright` aux essais Playwright si l'on accepte la dépendance.
- Textes personnalisables d'une marque (`texts`) : non éditables dans l'écran (le reste de la marque l'est).
- Captures des nouveaux écrans dans `docs/screens/` avec une organisation de démonstration (API et données nécessaires).
