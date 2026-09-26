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

Un relevé émis ne change plus (il est parti au chauffeur avec son PDF). La correction se fait sur le brouillon de la semaine suivante : générer la semaine en cours (lundi de cette semaine) pour ce chauffeur, puis ajuster ce brouillon avec un motif qui cite le relevé corrigé.

Limite connue : un brouillon n'existe que si le chauffeur a au moins une ligne (course ou pack) sur la semaine. Un chauffeur sans activité la semaine suivante n'a pas de brouillon à ajuster ; la correction attend sa prochaine activité. Signalé comme manque au code.

## Émettre et régler à la main

- **Émettre** : le relevé devient immuable, les packs portés sont marqués facturés, le PDF est produit et le chauffeur reçoit un courriel.
- **Régler** : versement (net positif, compte Stripe Connect vérifié exigé) ou prélèvement (net négatif, méthode de prélèvement enregistrée exigée). Rejouable sans double paiement (clé d'idempotence).

Motifs d'échec affichés dans le détail :

| Motif | Cause | Geste |
|---|---|---|
| `payout_account_missing` | Le chauffeur n'a pas terminé son compte de versement | Lui demander de finir l'écran « Versements » de l'application chauffeur ; puis **Régler** |
| `debit_method_missing` | Aucune méthode de prélèvement enregistrée | Même écran ; puis **Régler** |
| Refus de Stripe | Carte ou compte refusé | Le nouvel essai du lundi est automatique ; sinon contacter le chauffeur |

Bloc « Soldes des chauffeurs » : solde, date de l'impayé, date de suspension. La suspension pour solde se lève seule dès que plus rien n'est dû.

## PDF absent

« PDF en préparation » plus de 10 minutes après l'émission : Administration, **Files de tâches**, file `settlements`, **Voir les échecs**, puis **Relancer**.

## Contrôle du vendredi (10 minutes)

1. **Relevés** : tous les relevés de la semaine sont `émis` puis `réglés` ; aucun `en échec` sans motif compris.
2. **Agents IA**, file d'approbation : anomalies de l'agent comptabilité. Approuver une anomalie la confirme ; l'ajustement lui-même reste une décision de la comptabilité, à saisir sur le brouillon suivant.
3. Bloc « Soldes des chauffeurs » : suspensions du jour, prévenir les chauffeurs concernés si besoin.
