# Adaptateur SEV : facturation certifiée

Section 5.13 du cahier des charges, prompt 09 (tâches 5 et 6). Ce document décrit ce que Neomoov attend de l'adaptateur réel du système d'enregistrement des ventes (SEV) et la liste des points à confirmer avec le fournisseur certifié et le comptable avant la mise en production. En V1, seul l'adaptateur simulé est livré (`SEV_PROVIDER=mock`, valeur par défaut).

## 1. Ce que fait la plateforme, avant et après l'adaptateur

| Étape | Qui | Détail |
|---|---|---|
| Émission | `InvoicingService` (file `invoicing`) | Sur `ride.completed`, `ride.cancelled_by_client` et `ride.no_show` avec des frais, et `payment.refunded` (note de crédit). Numéro global `NM-0000001` et séquence du fournisseur (le chauffeur) tirés dans la transaction de l'insertion : aucun trou, aucun doublon. Contenu figé dans `invoices.lines` (document de version 1) : la facture est immuable. |
| Transmission | `SevService` (file `invoicing`) | Réservation de la facture (état `sent`), une ligne `sev_transmissions` par tentative (requête, réponse, état, rang), appel de l'adaptateur avec un délai de 15 secondes. |
| Succès | `SevService` | `invoices.sev_transaction_id` rempli, état `acknowledged` (ou `sent` si le fournisseur accuse réception plus tard), nouveau PDF portant le numéro de transaction. |
| Échec | `SevService` | Retour à `pending` ; après `sev.max_attempts` (5) tentatives, `error`, visible dans My Hub. |
| Reprise | Passe périodique (5 min) et My Hub | Factures `pending` après `sev.retry_delay_seconds` (60 s), factures `error` après `sev.error_retry_seconds` (1 h), transmission interrompue libérée après 10 min ; `POST /v1/admin/sev/retry/{invoiceId}` pour une reprise immédiate. |
| Note de crédit | `SevService` | Transmise seulement quand la facture d'origine a une transaction (l'origine est transmise d'abord). |

Une course ne dépend jamais du SEV pour se terminer : la facture est émise tout de suite, la transmission peut être différée en cas de panne (section 5.13).

## 2. Contrat de l'adaptateur (`apps/api/src/adapters/types.ts`)

```ts
interface SevProvider {
  readonly name: string;
  registerSale(document: SevDocument): Promise<SevReceipt>;          // facture d'une course terminée
  registerCancellation(document: SevDocument): Promise<SevReceipt>;  // frais d'annulation ou de non-présentation
  registerCredit(document: SevDocument): Promise<SevReceipt>;        // note de crédit (remboursement)
  healthcheck(): Promise<{ ok: boolean; latencyMs: number | null; detail: string | null }>;
}
```

`SevDocument` : `invoiceId` (clé d'idempotence), `kind` (`ride`, `cancellation`, `no_show`, `credit_note`), `number`, `supplierSequence`, `issuedAt` (UTC), `supplier` (nom, numéro de chauffeur, TPS, TVQ), `platform` (Neomoov : nom, TPS, TVQ), `paymentMethod`, `lines` (code, libellé, montant signé en cents, partie `driver` ou `platform`), `gstCents`, `qstCents`, `tipCents`, `totalCents`, `original` (numéro et transaction de la facture d'origine, pour une note de crédit). Montants en cents entiers ; sur une note de crédit, tous positifs (la nature dit le sens).

`SevReceipt` : `transactionId` (obligatoire), `status` (`acknowledged` ou `sent`), `qrPayload` (si le SEV impose son propre code QR), `raw` (réponse utile au support, sans secret).

Exigences pour l'implémentation réelle :

1. **Idempotence** : un même `invoiceId` transmis deux fois (reprise après une coupure pendant l'appel) ne doit jamais créer deux enregistrements. Utiliser la clé d'idempotence du fournisseur s'il en a une ; sinon, rechercher l'enregistrement existant avant d'en créer un.
2. **Erreurs** : lancer une erreur pour tout échec. Distinguer à terme les erreurs définitives (document refusé : données invalides) des erreurs passagères (réseau, 5xx) ; aujourd'hui, toutes sont reprises jusqu'à `error`.
3. **Délais** : répondre en moins de 15 secondes ; `healthcheck` en moins de 5 secondes, sans enregistrer de vente.
4. **Secrets** : clés et certificats dans `.env` seulement (`SEV_API_KEY` aujourd'hui ; ajouter les autres variables au schéma d'environnement et à `.env.example`, sans valeur). Rien dans les journaux.
5. **Données personnelles** : le document ne contient ni le nom ni le téléphone du client. N'en ajouter que si le SEV l'exige (Loi 25 : minimisation).
6. **Tests** : les tests utilisent toujours l'adaptateur simulé (`MockSevProvider` : `failures` fait échouer les N prochains envois, `healthy` simule une panne). Prévoir un test de l'adaptateur réel contre le bac à sable du fournisseur, exclu de la suite normale (comme `stripe.live.test.ts`).

Sélection : `SEV_PROVIDER=real` et la clé présente ; sinon le démarrage refuse la configuration (`PROVIDER_NOT_CONFIGURED`).

## 3. Champs et règles à confirmer

Avec le fournisseur du SEV certifié :

- [ ] Format et unicité exigés pour la numérotation : numéro global `NM-0000001` et séquence par chauffeur suffisent-ils, ou faut-il une séquence par appareil, par mode de fonctionnement ou par jour ?
- [ ] Identification du fournisseur du transport : nom légal ou commercial, numéro de chauffeur, numéro d'autorisation (SAAQ, registre des chauffeurs), numéros de TPS et de TVQ ; cas du chauffeur petit fournisseur sans numéro de taxes.
- [ ] Identification de Neomoov (intermédiaire) : raison sociale (`company.legal_name`), adresse, numéros de TPS et de TVQ (vides en V1), rôle de mandataire ou de fournisseur des frais de service.
- [ ] Horodatage : heure de fin de course, de début, ou d'émission ; fuseau (UTC transmis aujourd'hui).
- [ ] Trajet : précision attendue pour le départ et l'arrivée (adresse complète ou municipalité), distance et durée obligatoires ou non.
- [ ] Ventilation des montants : tarif et suppléments, frais de service, redevance de 0,90 $, péages, TPS et TVQ par fournisseur ; format des lignes (codes, libellés imposés).
- [ ] Modes de paiement : codes attendus pour la carte (application, Apple Pay, Google Pay), les espèces, Interac et le terminal du chauffeur ; paiement partiel par crédits Neomoov.
- [ ] Frais d'annulation et de non-présentation : opération « vente » ordinaire ou type propre (`registerCancellation`) ; facture exigée quand les frais ne sont pas encaissés (course payée au chauffeur).
- [ ] Note de crédit : référence à la transaction d'origine, remboursements partiels successifs, remboursement en crédit Neomoov (non monétaire) : note de crédit ou non ?
- [ ] Code QR : le SEV impose-t-il son propre code (contenu et format) sur la facture, en plus ou à la place du lien de vérification de Neomoov ?
- [ ] Pourboire : à inclure dans la transaction ou non ; pourboire payé après l'émission de la facture.
- [ ] Mode hors ligne : délai maximal de transmission différée toléré en cas de panne, nombre de tentatives, preuve à conserver.
- [ ] Mention légale exacte et langue (français obligatoire, anglais possible ?).
- [ ] Authentification (clé, certificat client), environnement d'essai, procédure de certification du logiciel, identifiant du logiciel ou de l'appareil à transmettre.
- [ ] Conservation : durée (7 ans prévus), format d'archivage des factures et des accusés.

Avec le comptable :

- [ ] Taxes du chauffeur perçues par la plateforme et reversées au chauffeur, qui les remet lui-même (décision D26), et affichage des taxes par nature sur la facture.
- [ ] Promotion : taxes calculées sur le tarif complet du chauffeur, écart pris en charge par Neomoov (ligne « Taxes du tarif prises en charge par Neomoov »).
- [ ] Péages : rattachés à la part de Neomoov (leurs taxes sont dans la part « frais » de `splitTaxDetail`) ; à confirmer, sinon rattacher au transport.
- [ ] Redevance de 0,90 $ : incluse dans l'assiette des taxes ou non.
- [ ] Frais d'annulation et de non-présentation : facturés par le chauffeur, sans taxe en V1 (indemnité) ; taxables ou non.
- [ ] Remboursement en crédit sur le compte du client : note de crédit fiscale ou geste commercial.
- [ ] Mention légale (`invoices.legal_notice`) et identité de Neomoov sur les factures.

## 4. Routes et réglages

- `GET /v1/rides/{id}/invoice` et `GET /v1/rides/{id}/invoice/pdf?documentId=` : client, chauffeur de la course, personnel.
- `GET /v1/public/invoices/verify/{token}` : vérification publique du code QR (jeton HMAC-SHA256, clé dérivée par HKDF de `ENCRYPTION_KEY`), page web `/verifier-facture?t=`.
- `GET /v1/admin/sev/status`, `POST /v1/admin/sev/retry/{invoiceId}`, `GET /v1/admin/invoices/{id}/pdf` : My Hub.
- Réglages : `sev.max_attempts`, `sev.retry_delay_seconds`, `sev.error_retry_seconds`, `invoices.catchup_days`, `invoices.legal_notice`, `invoices.verification_base_url`, `company.*`.

## 5. Exemples

`docs/examples/facture-exemple.pdf` et `docs/examples/note-de-credit-exemple.pdf` : documents fictifs produits par le gabarit de production sur l'exemple de contrôle du cahier des charges (31,56 $). Régénérer : `pnpm --filter @neomoov/api build`, puis `node apps/api/dist/scripts/invoice-example.js` depuis la racine.
