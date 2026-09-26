# Registres de la redevance et des taxes, exports comptables

Section 5.13 du cahier des charges et prompt 09 (tâche 7). Code : `packages/domain/src/settlement/ledgers.ts` (fonctions pures), `apps/api/src/modules/ledgers/`. Traitement fiscal à faire confirmer par le comptable (question D2 du document de référence).

## Registres

À la fin de chaque course (événement `ride.completed`, file `exports`), une ligne par registre, unique par course :

- **`redevance_ledger`** : redevance due pour la course et période de remise. Montant : la redevance facturée au client, ou le montant par course en vigueur (`pricing.regulatory_fee_cents`, 0,90 $) quand la course n'en portait pas (course offerte : Neomoov l'absorbe, elle reste due).
- **`tax_ledger`** : TPS et TVQ sur le tarif complet (taxes du chauffeur, fournisseur du transport, qu'il remet lui-même : décision D26) et TPS et TVQ perçues sur les frais de service et la redevance (taxes de Neomoov), par `splitTaxDetail`.

**Période** : le mois (AAAA-MM) de la fin de course, heure de Montréal (`service.time_zone`). Une course terminée le 30 septembre à 23 h 30 appartient à septembre même s'il est déjà le 1er octobre en UTC.

**Reprise** : une passe horaire inscrit les courses terminées qui n'ont pas de ligne (panne, événement perdu), 500 au plus par passe. L'écriture est idempotente : rejouer un événement ou une passe ne crée aucun doublon.

## Périodes des exports

- **Mois** : `AAAA-MM`, par exemple `2026-09`.
- **Trimestre civil** : `AAAA-Tn`, par exemple `2026-T3` (T1 : janvier à mars, T2 : avril à juin, T3 : juillet à septembre, T4 : octobre à décembre), la notation des déclarations trimestrielles de TPS et de TVQ.

## Exports CSV

`GET /v1/admin/ledgers/exports?type=redevance|taxes&period=…` (finances et administrateurs, téléchargement journalisé). Séparateur point-virgule, montants **en cents** (entiers), dates à l'heure de Montréal, une ligne par course triée par mois puis par fin de course, puis une ligne `TOTAL AAAA-MM` par mois (même vide) et, pour un trimestre, une ligne `TOTAL AAAA-Tn`. Dans une ligne de total, la colonne `course` porte le nombre de courses.

| Registre | Colonnes |
|---|---|
| `redevance` | `periode`, `course` (numéro public), `terminee_le`, `chauffeur` (numéro public), `redevance_cents` (due), `facturee_client_cents`, `remise_le` |
| `taxes` | `periode`, `course`, `terminee_le`, `chauffeur`, `tps_chauffeur` et `tvq_chauffeur` (numéros d'inscription), `tarif_cents`, `tps_tarif_cents`, `tvq_tarif_cents` (chauffeur), `tps_frais_cents`, `tvq_frais_cents` (Neomoov) |

## Rapport de synthèse PDF

`POST /v1/admin/ledgers/summaries` `{ type, period }` met la production en file ; le worker produit le PDF (totaux par mois, total de la période et, pour les taxes, le détail par chauffeur), jamais une requête HTTP. `GET /v1/admin/ledgers/summaries/{type}/{period}` donne l'état (`pending`, `ready`, `failed`) et le chemin de téléchargement, `…/pdf` le fichier. L'état est un petit manifeste JSON rangé à côté du PDF dans le stockage objet (`ledgers/summaries/<type>/<période>.json`) : aucune table de plus. Une nouvelle demande remplace le rapport de la même période.

## Remise de la redevance

`POST /v1/admin/ledgers/redevance/remit` `{ period: "AAAA-MM", remittedOn?, reference? }`, pour un mois terminé : les lignes non encore remises reçoivent la date de remise (midi, heure de Montréal, du jour indiqué, sinon maintenant). Une ligne inscrite après coup par la reprise reste à remettre et une nouvelle remise la marque. Chaque remise est au journal d'audit (`ledger.redevance_remitted`) avec sa référence. `GET /v1/admin/ledgers/months` donne, par mois, la redevance due, facturée et remise, et les taxes par nature.

## Rapport trimestriel du chauffeur

Pour ses déclarations (section 5.8) : par mois du trimestre, nombre de courses, tarifs, TPS et TVQ sur ses tarifs. `GET /v1/driver/tax-report?quarter=AAAA-Tn` (le chauffeur connecté, le sien seulement ; trimestre en cours par défaut) et `GET /v1/admin/ledgers/drivers/{id}/tax-report` (finances et administrateurs).
