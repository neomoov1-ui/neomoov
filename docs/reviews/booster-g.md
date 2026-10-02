# Agent G : Neomoov Booster dans la plateforme

Revue de fin de mission, 2 octobre 2026. Branche `booster-g-plateforme` (depuis `main` = `03f45d8`). Prompt : `neomoov-outils/agents/O-booster-g-plateforme.md`. Documentation : `docs/booster.md`.

## Livré

- **Domaine** `packages/domain/src/booster/` : `inspection.ts` (douze éléments de l'article 65, zones de carrosserie, gravité globale, sortie Zod de l'analyse, préremplissage), `performance.ts` (calculs d'une session, récapitulatifs, bornes de période, sortie Zod de la lecture), `alerts.ts` (réglages, fenêtres de gain, alertes dues, marques) ; schémas de l'API `schemas/booster.ts` ; codes d'agents `vehicle_inspection` et `performance_reading` ; matrice des avis (`booster.*`, `alert.inspection_major`).
- **Base** : migration provisoire `0032_booster` (tables `vehicle_inspections`, `performance_logs`, `driver_alert_settings` ; GRANT, sécurité au niveau des lignes, politiques `org_isolation` par chauffeur, déclencheurs `org_fill_from_driver` ; fichier inverse `down/0032_booster.sql`), appliquée sur la base de développement ; réglages `booster.*` et `retention.*` ; agents et prompts versionnés `docs/agents/vehicle-inspection.v1.md`, `performance-reading.v1.md`.
- **API** `apps/api/src/modules/booster/` : 21 routes chauffeur (`/v1/driver/booster/...` : inspections avec photos, analyse, corrections, confirmation et archive, liste, détail, photo, PDF, lien signé ; rapports de performance avec captures, lecture, confirmation, liste, détail, récapitulatif, PDF, lien ; alertes et test) et 10 routes dispatch (`/v1/admin/booster/...`, `documents.read` ; photos et PDF sous `documents.content.read`, consultation journalisée ; chauffeurs en ligne sans rapport du jour ; exports CSV). Analyse par `AgentRunnerService` (coûts, journal, mode manuel respecté). PDF par pdfkit (style des factures). Passe des alertes (file `booster`, worker). Push : `channelId` et son nommé (types, Expo, simulé, livraison). Rétention : photos à 90 jours, rapports à 2 ans. Événement `booster.inspection_archived`.
- **Application chauffeur** : écrans `booster/` (accueil, parcours de photos guidé et confirmation, mes rapports, rapport de performance avec lecture de captures et récapitulatifs, alertes avec test du son), canaux Android et trois sons embarqués, lien du profil, ouverture des écrans depuis une notification ; textes FR et EN ; permissions caméra et photos mises à jour (FR et EN), pas de micro.
- **My Hub** : pages Inspections (liste, filtres, manquants du jour, export) et détail (photos, PDF), Performance des chauffeurs (liste, récapitulatif par chauffeur, export) ; navigation ; liens depuis la fiche du chauffeur ; réglages `booster.*` dans Paramètres (données de départ) ; textes FR et EN.
- **OpenAPI** régénérée et `api-client` étendu (`driver.createInspection` … `admin.boosterPerformanceRecap`).

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Création avec photos simulées (JPEG, PNG), type reconnu, antivirus, plaque et nom repris | Oui (`booster.e2e`, 415 sur un fichier texte, 404 pour un autre chauffeur) |
| Analyse simulée : champs préremplis, voyant, défauts par zone, éléments visibles, confiance, photos inutilisables ; pièces jointes envoyées au modèle ; exécution journalisée | Oui (7 pièces jointes, `agent_runs` `succeeded`) |
| Refus de l'analyse sous le minimum de photos | Oui (400 `NOT_ENOUGH_PHOTOS`) |
| Corrections du chauffeur, gravité recalculée, permis chiffré en base | Oui |
| Archivage : attestation exigée, PDF produit (`%PDF`), lien signé, photo servie, événement émis, audit, plus de modification (409) | Oui |
| Défectuosité majeure signalée au dispatch | Oui (`alert.inspection_major` au personnel, éléments nommés) |
| Dispatch : liste, filtres (gravité, chauffeur, jour), détail sans permis en clair, PDF, photos, manquants du jour, CSV, 403 pour un chauffeur | Oui |
| Isolation entre organisations | Oui (sous le contexte de A, les rapports de B invisibles et inversement ; plateforme : tout ; `organization_id` dérivé) |
| Analyse refusée par le modèle : consignée, rapport archivable à la main | Oui |
| Performance : captures lues, champs vides remplis, heures posées dans le fuseau, confirmation, solde et ratios exacts, PDF | Oui (net 254,00 $, 31,75 $ par heure, 1,27 $ par km) |
| Récapitulatifs hebdomadaire et mensuel exacts sur des données connues, brouillon exclu ; dispatch | Oui (semaine 41 : 2 sessions, 349,00 $ ; mois : 3 sessions, 389,00 $) |
| Alertes : défauts, fusion, fenêtres, test par push avec canal et son | Oui (`booster-peak`, `booster_peak.wav`, écran `booster`) |
| Passe planifiée : alertes dues à l'heure, une fois par jour, vérification seulement sans rapport du jour ; envoi par le push simulé | Oui |
| Domaine couvert à 100 % | Oui (`src/booster` : 100 % lignes, branches, fonctions) |

## Commandes lancées

- `pnpm --filter @neomoov/domain test` : 39 fichiers, 531 tests verts avant ajout ; avec `booster.test.ts` : 21 tests, `src/booster` à 100 % (lignes, branches, fonctions).
- `node db-lock.cjs run booster-g … vitest run --no-file-parallelism test/booster.e2e.test.ts` : 10 tests verts (131 s).
- `pnpm --filter @neomoov/api typecheck`, `pnpm --filter @neomoov/mobile-driver typecheck`, `pnpm --filter @neomoov/web typecheck` : verts.
- `packages/db` : `vitest run test/journal.test.ts` vert ; migration appliquée sous le verrou.
- `npx expo config --type introspect` (application chauffeur) : permissions caméra et photos déclarées avec textes FR et EN, quatre sons déclarés, `RECORD_AUDIO` bloqué (aucun micro).

## Points vérifiés

- Aucune URL publique en base : clés de stockage seulement ; photos et PDF servis par l'API ou par un lien signé de 5 minutes.
- L'analyse ne remplace jamais une défectuosité saisie par le chauffeur ; rien n'est archivé sans `allItemsChecked: true`.
- Le PDF reprend le contenu de l'article 66 (date et heure, plaque, accessoire, nom et permis, odomètre, éléments, défectuosités, attestation).
- Les routes du dispatch sont sous `documents.read` ; le contenu (photos, PDF) sous `documents.content.read` avec audit, comme les documents des chauffeurs.
- Migration : GRANT, RLS, politiques et déclencheurs dans le même fichier ; `isolation-coverage.e2e` attend désormais `performance_logs` et `vehicle_inspections` parmi les tables à défaut d'organisation.

## Reste à faire

- PNG et JPEG du rapport (aucun moteur d'image côté API) : capture de vue dans l'application ou moteur serveur, à décider.
- Analyse synchrone (jusqu'à deux minutes) : passer par la file `agents` si les délais gênent.
- Vidéos et consignes illustrées du parcours de photos ; schéma de carrosserie interactif plus fin (SVG) dans l'application.

## Pièges

- Supertest : `.send()` et `.attach()` ne se mélangent pas (formulaires multipart sans `.send()`).
- `exactOptionalPropertyTypes` : une fusion de réglages partiels doit ignorer les clés explicitement indéfinies (`merge` dans `alerts.service.ts`).
- Le type `PeakWindow` existe déjà dans le domaine (tarification) : les fenêtres de gain s'appellent `GainWindow`.
- `@neomoov/db` n'exporte que l'espace `schema` : les types des colonnes JSON s'importent par `schema.StoredImage`.
- Fichiers partagés en CRLF : les scripts de modification normalisent puis restituent les fins de ligne.
