# Prompt 09. Étape 9 : règlement hebdomadaire, facturation certifiée, redevance, taxes, exports (J6 et J7)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.8, 5.13, 5.6 (versements et prélèvements), 4.6, 4.7, 7.2 (Chauffeur : revenus et relevés ; Admin : statements, invoices, sev, ledgers) et 11.1 (étape 9). Consulte `docs/decisions.md`.

## Objectif
Le moteur de règlement hebdomadaire couvert à 100 %, les relevés PDF, les versements et prélèvements, la facturation de chaque course avec l'adaptateur `SevProvider` simulé, les registres de redevance et de taxes, les exports comptables et l'export de géolocalisation.

## Tâches
1. `packages/domain/settlement` : `buildStatement(driver, period, lines)` implémentant exactement la formule de la section 5.8 (crédits : tarifs via plateforme, pourboires via plateforme, compensations de promotions, primes, crédits de parrainage, ajustements positifs ; débits : packs à facturer, frais de service collectés en direct, redevances collectées en direct, taxes sur frais de service collectées en direct, frais d'annulation dus, ajustements négatifs), taxes du chauffeur sur les tarifs reversées dans les crédits ; arrondi au cent ; `classifyRideForStatement(ride, payment)` ; couverture 100 % avec un jeu de 200 courses mixtes (carte, espèces, Interac, terminal, annulations, non-présentations, promotions, pourboires) dont le total attendu est calculé indépendamment dans le test.
2. Tâche planifiée du worker : vendredi 06 h 00 `America/Toronto`, génération des relevés de la période du lundi au dimanche précédents pour tous les chauffeurs ayant une ligne ; statut `draft` puis `issued` ; PDF (gabarit propre, détail ligne par ligne, lien vers chaque course) stocké dans le stockage objet ; courriel avec le PDF ; événement `statement.issued`.
3. Versements et prélèvements : net positif transféré via Connect (clé d'idempotence par relevé) ; net négatif prélevé sur la méthode enregistrée ; échec : nouvelle tentative le lundi, puis suspension automatique si le solde négatif dépasse `settings.negative_balance_threshold` (15 000 cents) ou reste impayé plus de 7 jours ; `driver_balances` tenu à jour ; réactivation automatique après régularisation.
4. Endpoints chauffeur : `GET /v1/driver/earnings` (jour, semaine, courses, pourboires), `GET /v1/driver/statements`, `GET /v1/driver/statements/{id}`, `GET /v1/driver/statements/{id}/pdf` ; admin : `POST /v1/admin/statements/generate` (période, aperçu), `POST /v1/admin/statements/{id}/issue`, `POST /v1/admin/statements/{id}/pay`, `POST /v1/admin/statements/{id}/adjust` (ajustement motivé, audité), `GET /v1/admin/balances`.
5. Facturation : sur `RideCompleted`, génération immédiate d'une facture avec tous les champs de la section 5.13, numérotation séquentielle par fournisseur sans trou (séquence en base, transaction), PDF, code QR de vérification (lien public signé), envoi par courriel, `GET /v1/rides/{id}/invoice` ; factures d'annulation et de non-présentation ; notes de crédit en cas de remboursement.
6. `SevProvider` : interface (`registerSale`, `registerCancellation`, `registerCredit`, `healthcheck`), implémentation simulée qui journalise et renvoie un identifiant fictif, file de transmission asynchrone avec nouvelles tentatives et état visible (`sev_transmissions`), endpoints admin `GET /v1/admin/sev/status`, `POST /v1/admin/sev/retry/{invoiceId}`. Documente dans `docs/sev-adapter.md` le contrat attendu de l'adaptateur réel et la liste des champs à confirmer avec le fournisseur du SEV certifié et le comptable.
7. Registres : `redevance_ledger` (0,90 $ par course, période de remise mensuelle, remis le), `tax_ledger` (TPS et TVQ sur le tarif pour le chauffeur, sur les frais de service pour Neomoov) ; exports mensuels et trimestriels CSV et PDF de synthèse (`GET /v1/admin/ledgers/exports?type=redevance|taxes&period=`), rapport trimestriel par chauffeur pour ses déclarations.
8. Export de géolocalisation : tâche mensuelle produisant un fichier CSV daté (courses : identifiants anonymisés, origine, destination, horodatages, distance) archivé dans le stockage objet, avec un format paramétrable (`docs/geolocation-export.md` décrit le format provisoire à confirmer avec la CTQ).
9. Tests : moteur de règlement (100 %), génération d'un relevé complet en intégration, versement et prélèvement avec l'adaptateur simulé, échec et suspension avec horloge simulée, numérotation des factures sous concurrence (100 courses terminées en parallèle, aucun trou ni doublon), transmission simulée et reprise, exports.

## Contraintes
- Aucun montant n'est calculé dans les contrôleurs : tout passe par `packages/domain/settlement` et `pricing`.
- Les factures et relevés sont immuables une fois émis ; toute correction passe par un ajustement ou une note de crédit.
- Les PDF sont générés par le worker, jamais dans une requête HTTP.

## Critères d'acceptation
- Relevés exacts au cent sur le jeu de 200 courses ; numérotation sans trou sous concurrence ; PDF lisibles (relevé et facture) joints en exemple dans `docs/examples/`.
- La suspension pour solde et la réactivation fonctionnent avec horloge simulée.

## Vérifications à exécuter et à montrer
Rapport de couverture du moteur de règlement, un relevé d'exemple (JSON et PDF), une facture d'exemple, sortie du test de concurrence.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 9 : règlement hebdomadaire, facturation, redevance, taxes et exports ».
