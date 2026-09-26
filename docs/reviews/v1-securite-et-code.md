# Revue finale V1 : sécurité et revue de code (prompt 17.B, sections 3 et 4)

Revue du 26 septembre 2026, branche `etape-17b-securite` (partie de `main` à `1d82ebe`). Menée par un relecteur dédié qui a corrigé chaque constat important au fil de l'eau, un commit par constat, chacun avec un test qui échouait avant la correction. La revue a été **interrompue** le 26 septembre au soir (arrêt demandé par le fondateur) ; la dernière correction a été terminée ensuite, mais la liste des constats de moindre gravité non corrigés n'avait pas encore été consignée (voir « Limites »).

## Synthèse

- 14 corrections, dont 2 critiques et 12 élevées ; la majorité concernent des **montants faussés** (paiements, crédits, relevés, promotions, tarification, facturation), le reste l'**authentification** et les **webhooks**.
- Aucune ne dépend d'un compte externe : toutes sont testées avec les fournisseurs simulés.
- Points forts confirmés : politique d'accès « refus par défaut » vérifiée route par route, idempotence généralisée, journal d'audit, chiffrement des champs sensibles, garde des simulateurs en production (`ALLOW_MOCK_PROVIDERS`, branche `etape-17c-corrections`).

## Corrections faites

| Gravité | Domaine | Constat | Correction | Commit |
|---|---|---|---|---|
| Critique | Webhooks | Les fournisseurs simulés, actifs en production tant que les clés manquent, acceptaient la signature publique « mock-signature » : n'importe qui pouvait forger un événement Stripe, un texto, un message WhatsApp ou un appel vocal au nom d'un client | En production, les simulateurs refusent toute signature et le jeton de vérification WhatsApp | `102604c` |
| Critique | Paiements | L'annulation par le chauffeur levait l'autorisation ; la course réattribuée était terminée gratuitement | L'autorisation est gardée quand la course repart en répartition | `e08903d` |
| Élevée | Authentification | Codes SMS : tentatives lues puis réécrites, plafond de cinq contournable en parallèle, code consommable deux fois | Compteur incrémenté en base, consommation atomique | `ee22ac2` |
| Élevée | Authentification | Personnel : échecs du second facteur comptés depuis la ligne lue, verrouillage contournable en parallèle | Compteur en base, verrou posé par la requête qui atteint le seuil | `babe850` |
| Élevée | Paiements | Le règlement du solde ne prélevait pas le dépassement d'autorisation, puis remettait le solde à zéro | Les paiements capturés non couverts entrent dans le solde et sont prélevés | `a79b74e` |
| Élevée | Paiements | Course par carte terminée sans autorisation valide, ou frais d'une ligne en attente : montant abandonné | Prélèvement hors session, sinon solde dû, incident et avis | `73d2455` |
| Élevée | Paiements | Crédits de remboursement simultanés au-delà du prix de la course | Plafond vérifié sous verrou transactionnel par course | `746fc14` |
| Élevée | Agents IA | En mode automatique, le plafond des gestes financiers ne portait que sur chaque appel (contournable par un message piégé répété) | Plafond sur le cumul accordé sans humain au client sur 24 heures, au-delà approbation humaine | `6066dab` |
| Élevée | Agents IA | Deux remboursements d'une même exécution partageaient la clé d'idempotence : le second était annoncé sans être fait | Clé par mode et par montant | `e6d01b4` |
| Élevée | Règlement | Une erreur du fournisseur au prélèvement laissait le relevé « émis » : dette jamais prélevée | Relevé en échec, avis, solde recalculé, reprise du lundi | `b1e282f` |
| Élevée | Règlement | Pourboire ou garantie arrivés après l'émission du relevé jamais portés | Écart porté par le relevé suivant, une seule fois | `474359e` |
| Élevée | Tarification | Limites et budget des promotions vérifiés au devis seulement | Revérifiés sous verrou à la réservation, 409 au-delà | `fd584b7` |
| Élevée | Tarification | Plage de pointe qui passe minuit ignorée après minuit : Offre Flex accordée à tort | La plage de la veille couvre le début du jour | `afd7c05` |
| Élevée | Facturation | Remboursement réussi dont la tâche de note de crédit était perdue : aucune note de crédit | La passe périodique émet les notes de crédit manquantes | commit suivant `e32e09c` |

Corrections de la même revue faites dans la branche `etape-17c-corrections` (voir `v1-final-review.md`) : garde `ALLOW_MOCK_PROVIDERS` en production, documentation de l'API fermée en production (`API_DOCS`), interruption d'une course, statut après suspension, relevé réglé hors plateforme, chauffeur restreint attribuable hors VIP.

## Limites

- La revue a porté en priorité sur les parcours d'argent, l'authentification et les webhooks. Les constats de gravité moyenne ou faible notés en cours de route n'ont pas été consignés avant l'interruption : une passe complémentaire est à prévoir avant le lancement commercial (en-têtes et CSP du web, limites de débit par route, journalisation des données personnelles, dépendances).
- Restent hors du périmètre de cette revue, déjà listés dans les revues A et B : politique de sécurité du contenu avec nonces (web), analyse statique et mise à jour automatique des dépendances, test d'intrusion externe, évaluation des facteurs relatifs à la vie privée.
