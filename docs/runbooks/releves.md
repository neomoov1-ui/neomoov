# Relevés des chauffeurs : régénérer, ajuster, émettre, régler

Étape 16. Règles de l'étape 9 (décisions du 26 septembre 2026 : relevés, brouillon, émission immuable, versements). Rôles : **administrateur** ou **finances** pour écrire ; tout le personnel lit. Écran : My Hub, Finances, **Relevés**.

## Ce qui se passe tout seul

| Quand (heure de Montréal) | Ce que fait le worker |
|---|---|
| Vendredi à partir de 6 h | Génère les relevés de la semaine précédente (lundi au dimanche), les émet (PDF et courriel au chauffeur), puis règle : versement si le net est positif, prélèvement s'il est négatif |
| Lundi | Nouvel essai des règlements en échec |
| Chaque quart d'heure | Revue des soldes : suspension pour solde (seuil de 150 $ dépassé après le nouvel essai, ou impayé depuis plus de 7 jours), réactivation dès que plus rien n'est dû |
| À l'émission | L'agent comptabilité contrôle le relevé ; une anomalie arrive dans la file d'approbation (Pilotage, **Agents IA**) |

Tant que Stripe est en mode simulé (`PAYMENT_PROVIDER=mock` sur le serveur), les montants sont calculés et les relevés émis, mais aucun argent ne bouge : les versements et prélèvements réels commencent avec les clés Stripe réelles (`docs/paiements.md`).

## Régénérer une semaine (avant émission)

À faire quand une course a été corrigée (remboursement, garantie modèle, paiement direct confirmé en retard) avant l'émission du vendredi, ou pour contrôler une semaine.

1. **Relevés**, bloc « Générer une semaine » : saisir le lundi de la semaine (vide : la dernière semaine entièrement écoulée).
2. **Aperçu** : les relevés sont calculés et affichés, rien n'est enregistré. Comparer avec ce qui est attendu.
3. **Générer les brouillons** : crée ou recalcule les brouillons. Les ajustements manuels déjà saisis sont gardés ; un relevé déjà émis n'est jamais touché (compté dans « déjà émis »).

Une course arrivée après l'émission (événement en retard) n'est pas perdue : elle part sur le relevé de la semaine suivante, jamais sur deux relevés.

Par l'API (même règle) : `POST /v1/admin/statements/generate` avec `{"periodStart": "AAAA-MM-JJ", "preview": true}` ; `driverId` limite à un chauffeur.

## Ajuster un relevé

Un ajustement (crédit ou débit, motif obligatoire, repris comme libellé de la ligne et au journal d'audit) ne s'ajoute qu'à un **brouillon**.

1. **Relevés**, ouvrir le relevé (**Voir**).
2. **Ajuster** : sens (« Crédit au chauffeur » ou « Débit au chauffeur »), montant en dollars, motif précis (par exemple « Péage non compté, course NM-2026-10-02-0014 »).
3. Contrôler le nouveau net, puis **Émettre** si l'émission automatique du vendredi est déjà passée.

### Relevé déjà émis

Un relevé émis ne change plus (il est parti au chauffeur avec son PDF). La correction se fait sur le brouillon de la semaine en cours : sur la fiche du relevé émis, **Préparer une correction** ouvre ce brouillon pour le chauffeur (créé même s'il n'a encore aucune course cette semaine), puis **Ajuster** avec un motif qui cite le relevé corrigé. L'ajustement part avec le relevé de la semaine, émis le vendredi suivant.

## Émettre et régler à la main

- **Émettre** : le relevé devient immuable, les packs portés sont marqués facturés, le PDF est produit et le chauffeur reçoit un courriel.
- **Régler** : versement (net positif, compte Stripe Connect vérifié exigé) ou prélèvement (net négatif, méthode de prélèvement enregistrée exigée). Rejouable sans double paiement (clé d'idempotence).

Motifs d'échec affichés dans le détail :

| Motif | Cause | Geste |
|---|---|---|
| `payout_account_missing` | Le chauffeur n'a pas terminé son compte de versement | Lui demander de finir l'écran « Versements » de l'application chauffeur ; puis **Régler** |
| `debit_method_missing` | Aucune méthode de prélèvement enregistrée | Aucun écran ne permet encore au chauffeur de l'enregistrer : voir « Limite connue : solde négatif » ci-dessous |
| Refus de Stripe | Carte ou compte refusé | Le nouvel essai du lundi est automatique ; sinon contacter le chauffeur |

Chaque règlement en échec prévient le chauffeur (push et courriel) et le personnel (courriel aux administrateurs et opérateurs, alerte `alert.settlement_failed`, envoyée seulement avec Resend réel).

Bloc « Soldes des chauffeurs » : solde, date de l'impayé, date de suspension. La suspension pour solde se lève seule dès que plus rien n'est dû.

### Limite connue : solde négatif (V1)

Un relevé au net négatif (le chauffeur doit de l'argent à Neomoov, par exemple quand il a encaissé lui-même ses courses, comme pendant la bêta) se règle par prélèvement sur une méthode enregistrée. L'API existe (`POST /v1/driver/payment-method`, puis `.../confirm`), mais l'application chauffeur n'a pas l'écran correspondant (décision du 26 septembre 2026) : tout relevé négatif échoue donc en `debit_method_missing`, à chaque essai. Conséquences :

- le relevé reste « en échec » et compte dans le solde du chauffeur ;
- le chauffeur est suspendu pour solde 7 jours après l'émission (`settlement.unpaid_grace_days`), ou dès le nouvel essai du lundi si la dette dépasse 150 $ (`settlement.negative_balance_threshold_cents`) ;
- aucun bouton ni route ne permet de marquer un relevé comme réglé hors plateforme.

Conduite à tenir pendant la bêta, sur décision du fondateur notée au registre d'exploitation :

1. Encaisser la somme due hors plateforme (virement Interac au compte de Neomoov, par exemple), avec la référence du relevé.
2. Pour éviter une suspension injustifiée, relever dans **Paramètres** `settlement.unpaid_grace_days` et, si besoin, `settlement.negative_balance_threshold_cents` (la règle vaut pour tous les chauffeurs), le temps de la bêta.
3. Garder la liste des relevés encaissés hors plateforme : ils resteront « en échec » dans My Hub tant que l'écran de prélèvement (ou une route « réglé hors plateforme ») n'est pas livré.

## PDF absent

« PDF en préparation » plus de 10 minutes après l'émission : Administration, **Files de tâches**, file `settlements`, **Voir les échecs**, puis **Relancer**.

## Contrôle du vendredi (10 minutes)

1. **Relevés** : tous les relevés de la semaine sont `émis` puis `réglés` ; aucun `en échec` sans motif compris.
2. **Agents IA**, file d'approbation : anomalies de l'agent comptabilité. Approuver une anomalie la confirme ; l'ajustement lui-même reste une décision de la comptabilité, à saisir sur le brouillon suivant.
3. Bloc « Soldes des chauffeurs » : suspensions du jour, prévenir les chauffeurs concernés si besoin.
