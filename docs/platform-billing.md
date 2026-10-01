# Facturation de la plateforme (Stripe Billing)

Étape 25 (amendement v1.2, section 8 ; décision D2 du fondateur : grille marque blanche Solo, Pro, Entreprise). Ce document décrit les abonnements que les **organisations clientes** paient à Neomoov, pas les courses (encaissées par Stripe Connect, `docs/paiements.md`).

## 1. Partage des rôles

- **Neomoov tient l'abonnement** : formule, période, essai, véhicules actifs, montants, taxes, numérotation `PF-AAAA-NNNNNN`, relances, lecture seule, suspension, réactivation. Une seule source de vérité, règles du Québec, testée par le domaine (`packages/domain/src/platform-billing`).
- **Stripe Billing encaisse** : un client Stripe par organisation (formule, période et statut en métadonnées), une facture Stripe par facture PF, avec exactement les mêmes lignes et le même total (TPS et TVQ en lignes distinctes). Stripe prélève la carte par défaut du client (`charge_automatically`) ou envoie la facture avec sa page de paiement hébergée (`send_invoice`), puis rapporte l'issue par webhook.
- Aucun objet `Subscription` n'est créé chez Stripe : sinon Stripe émettrait ses propres factures, en double des factures PF. La colonne `subscriptions.stripe_subscription_id` reste vide, réservée au cas où le fondateur préférerait confier le cycle à Stripe (voir section 9).

## 2. Formules (données de départ, montants proposés)

| Formule | Installation | Mensuel | Licence annuelle | Véhicules inclus | Véhicule actif en sus |
|---|---|---|---|---|---|
| Solo | 99 $ | 49 $ | 490 $ | 1 | aucun |
| Pro | 1 500 $ | 199 $ | 1 990 $ | 10 | 15 $ par mois |
| Entreprise | 3 500 $ | 199 $ | 1 990 $ | 0 | 12 $ par mois |

Montants en dollars canadiens, taxes en sus. **Proposition à valider par le fondateur** (l'étude 03 donne des fourchettes : Solo 0 à 149 $ et 39 à 59 $, Entreprise 3 000 à 5 000 $ et 12 à 15 $ par véhicule). Licence annuelle = 10 mois payés pour 12. Les prix sont en base (`plans`), jamais dans le code : les changer ne demande qu'une mise à jour de la table (les données de départ n'écrasent jamais une formule existante).

Chaque formule porte ses **modules** (modules de permissions : `organization`, `rides`, `clients`, `payments`, `finance`, `reports`, `vehicles`, puis `dispatch`, `drivers`, `incidents`, `privacy`, `operations` pour Pro, et `pricing`, `offers`, `agents` pour Entreprise). À l'abonnement et à chaque changement de formule, ils sont recopiés dans `organization_features` (source `plan` ; une dérogation reste). Les droits d'un membre seront limités à ces modules quand la garde des organisations les appliquera.

## 3. Cycle

1. **Abonnement** (`POST /v1/admin/organizations/:id/subscription`) : client créé chez Stripe, statut `active` (ou `trialing` avec un essai de 1 à 90 jours), formule et modules posés sur l'organisation. Sans essai, la **première facture** part tout de suite : frais d'installation, abonnement de la première période, véhicules en sus s'il y en a.
2. **Facturation d'avance** : chaque facture couvre la période qui commence (un mois ou un an). Les **véhicules actifs** (statut `active`, rattachés à l'organisation ou à son sous-arbre, ou à défaut par leur chauffeur) sont comptés à l'émission ; une licence annuelle facture 12 mois de véhicules en sus, sans remise.
3. **Renouvellement** : la passe quotidienne émet la facture de la période suivante dès que la période en cours est échue, au jour d'ancrage de l'abonnement (pris le 31 janvier : renouvelé le 28 février, puis le 31 mars). Une passe manquée est rattrapée (24 périodes au plus). Une seule facture par période (index unique) : la passe est rejouable.
4. **Fin d'essai** : la facturation commence à la date de fin d'essai, avec les frais d'installation.
5. **Changement de formule ou de période** : effet à la prochaine facture, sans prorata ni frais d'installation supplémentaires (à trancher, section 9).
6. **Résiliation** (`POST .../subscription/cancel`, motif obligatoire) : plus aucune facture ; les factures impayées restent dues (rappels) ; l'organisation passe en **lecture seule** (ses données restent consultables et exportables, Loi 25).

Chaque facture : numéro `PF-AAAA-NNNNNN` (année de Montréal, séquence attribuée sous verrou consultatif), échéance `billing.payment_terms_days` jours après l'émission (0 : payable à réception), PDF au même moteur que les factures de course (`platform-invoices/<organisation>/<numéro>.pdf`), courriel `billing.invoice_issued` au propriétaire du compte (PDF joint, lien de paiement Stripe).

## 4. Taxes

- TPS 5 % et TVQ 9,975 %, chacune calculée sur le sous-total (la TVQ ne s'applique plus sur la TPS depuis 2013), arrondie au cent. Taux lus dans `pricing.gst_rate_ppm` et `pricing.qst_rate_ppm`.
- Neomoov doit être inscrit aux fichiers de la TPS et de la TVQ : ses numéros (`company.gst_number`, `company.qst_number`) figurent sur le PDF et sur la facture Stripe (champs personnalisés). **Vides tant qu'ils ne sont pas fournis** : le PDF indique « non fourni ».
- Les numéros de l'organisation cliente (`organizations.gst_number`, `qst_number`) figurent sur le PDF quand ils sont connus.
- Stripe Tax n'est pas utilisé (`automatic_tax` désactivé sur chaque facture) : les taxes sont celles de Neomoov, au cent près.

## 5. Relances et suspension progressive

| Jours après l'échéance | Action | Organisation |
|---|---|---|
| dès l'échéance dépassée, ou prélèvement refusé | facture `past_due`, abonnement `past_due` | active |
| +3, +7, +14 | rappels 1, 2 et 3 (`billing.reminder`), un seul chacun | active |
| +30 | abonnement `read_only` (`billing.read_only`) | lecture seule |
| +45 | abonnement `suspended` (`billing.suspended`), **jamais pendant une course** | suspendue |
| paiement (Stripe ou hors plateforme) | retour au statut visé par les factures restantes, réactivation (`billing.reactivated`) | active |

- Réglages : `billing.reminder_days` ([3, 7, 14]), `billing.read_only_days` (30), `billing.suspended_days` (45), validés (rappels croissants avant la lecture seule, suspension après elle) ; des réglages incohérents arrêtent les relances et les suspensions de la passe, avec une erreur visible.
- **Jamais pendant une course** : si une course est en cours dans l'organisation (sa course, ou celle d'un de ses chauffeurs : états `assigned`, `en_route`, `arrived`, `in_progress`), la suspension est reportée à la passe du lendemain (événement `platform_billing.suspension_postponed` au journal). La lecture seule n'interrompt aucune course et s'applique quand même. La passe tourne à 5 h, heure de Montréal (`billing.run_hour`), quand peu de courses sont en cours.
- **Aucune facture pendant la suspension** ; à la réactivation, la période repart du règlement.
- La plus en retard des factures impayées décide du statut ; un paiement ramène au statut visé par celles qui restent.
- `organizationWriteAllowed(statut)` (domaine) : `trial` et `active` écrivent, `read_only`, `suspended` et `closed` non. La garde des routes d'organisation (agent A) l'appliquera à la fusion ; `organizationAccess` dit en plus qu'une organisation suspendue ou fermée ne lit plus rien.

Statut de l'abonnement et de l'organisation : `trialing` → `trial` ; `active` et `past_due` → `active` ; `read_only` → `read_only` ; `suspended` → `suspended` ; `cancelled` → `read_only`. Une organisation fermée (`closed`) n'est jamais rouverte par la facturation.

## 6. API

| Route | Permission | Rôle |
|---|---|---|
| `GET /v1/admin/billing/plans` | `billing.view` ou `billing.manage` | formules et prix |
| `GET /v1/admin/billing/overview?horizonDays=14` | `billing.view` ou `billing.manage` | revenu mensuel récurrent, abonnements par statut, impayés, lectures seules et suspensions à venir |
| `POST /v1/admin/billing/run` | `billing.manage` | lance le cycle tout de suite (exploitation) |
| `GET /v1/admin/organizations/:id/subscription` | `billing.view` ou `billing.manage` | abonnement en cours |
| `POST /v1/admin/organizations/:id/subscription` | `billing.manage` | création, changement de formule, de période, essai |
| `POST /v1/admin/organizations/:id/subscription/cancel` | `billing.manage` | résiliation |
| `GET /v1/admin/organizations/:id/platform-invoices` | `billing.view` ou `billing.manage` | factures PF |
| `GET /v1/admin/platform-invoices/:id/pdf` | `billing.view` ou `billing.manage` | PDF |
| `POST /v1/admin/platform-invoices/:id/mark-paid` | `billing.manage` | règlement hors plateforme (référence obligatoire) |
| `POST /v1/webhooks/stripe-billing` | public, signature Stripe | issue des prélèvements |

- `billing.view` et `billing.manage` (module `organization`, la seconde sensible) sont dans le catalogue ; l'administrateur de la plateforme les a, ainsi que le propriétaire et l'administrateur d'une organisation (pour la future route d'organisation). Le rôle finance de la plateforme ne les a pas encore (voir section 9).
- `PlatformBillingService.billingForOrganization(organizationId)` rend l'abonnement et les factures **sans aucun identifiant Stripe**, pour la route `GET /v1/org/:organizationId/billing` qui sera branchée à la fusion avec `@OrgScoped`. Dans le contexte restreint d'une organisation, les politiques de la base ne lui laissent que la **lecture** de ses lignes (`subscriptions`, `platform_invoices` : politique `org_isolation` `FOR SELECT`).
- Journal d'audit : `platform_billing.subscribed`, `subscription_changed`, `subscription_cancelled`, `trial_ended`, `renewed`, `invoice_issued`, `invoice_paid`, `payment_failed`, `invoice_voided`, `invoice_past_due`, `reminder_sent`, `status_changed`, `suspension_postponed`, `invoice_marked_paid`. Les actions des tâches et du webhook sont signées `platform_billing`.

## 7. Webhook

- Point de terminaison **dédié** `POST /v1/webhooks/stripe-billing`, distinct de celui des paiements (`/v1/webhooks/stripe`), avec **son propre secret** `STRIPE_BILLING_WEBHOOK_SECRET`.
- Signature `Stripe-Signature` vérifiée sur le corps brut, en temps constant, tolérance de 5 minutes.
- Événements traités : `invoice.paid` (facture payée, réactivation), `invoice.payment_failed` (facture et abonnement en retard, code de refus gardé), `invoice.voided` (facture annulée chez Stripe). Tout autre type (dont `customer.subscription.updated`, sans objet ici) est enregistré et ignoré.
- Idempotence : l'événement est enregistré dans `webhook_events` (identifiant `billing_<evt>`, fournisseur `stripe_billing`) **après** son traitement ; un doublon est reconnu et rien n'est rejoué. Un traitement en échec ne laisse aucune trace et rend une erreur : Stripe renvoie l'événement plus tard (jusqu'à trois jours), et tous les traitements sont rejouables. Ce choix évite que la reprise des webhooks de paiement (qui reprend toute ligne `received` ou `failed` de la table) ne marque un événement de facturation « ignoré ».

## 8. Mise en place de Stripe Billing (quand le compte Stripe de Neomoov sera validé)

1. **Mode test d'abord** : clés de test (`sk_test_...`) dans `STRIPE_SECRET_KEY` (la même clé que les paiements), `BILLING_PROVIDER=real`.
2. **Webhook** : Stripe, Développeurs, Webhooks, « Ajouter un point de terminaison » : `https://<api>/v1/webhooks/stripe-billing`, événements `invoice.paid`, `invoice.payment_failed`, `invoice.voided`. Copier le secret de signature (`whsec_...`) dans `STRIPE_BILLING_WEBHOOK_SECRET`. En local : `stripe listen --forward-to localhost:4000/v1/webhooks/stripe-billing` donne un secret temporaire.
3. **Réglages de facturation** (Stripe, Paramètres, Billing) :
   - Courriels aux clients : Neomoov envoie déjà la facture (PDF joint), les rappels et les avis ; désactiver « Envoyer les factures finalisées par courriel » pour éviter les doublons, garder l'avis d'échec de paiement par carte si souhaité.
   - Nouvelles tentatives de paiement (Smart Retries) : activées pour les cartes ; ne pas activer l'annulation automatique d'abonnement (il n'y en a pas chez Stripe).
   - Portail client : activé, mise à jour du moyen de paiement permise (une carte par défaut active le prélèvement automatique des factures suivantes).
   - Stripe Tax : désactivé pour ces factures (déjà fait facture par facture par l'adaptateur).
   - Marque : logo, couleurs, adresse et préfixe des factures Stripe (le numéro PF est dans les champs personnalisés et la description).
4. **Aucun produit ni prix Stripe n'est nécessaire** en V1 (lignes à montant libre) ; des produits peuvent être créés plus tard pour les rapports de revenus de Stripe.
5. **Production** : clé `sk_live_...`, nouveau point de terminaison et nouveau secret de production. Tant que `BILLING_PROVIDER=mock` en production, ajouter `billing` à `ALLOW_MOCK_PROVIDERS` (sinon l'API refuse de démarrer) ; le simulateur refuse alors tout webhook.
6. Vérifier : abonner une organisation de test, payer la facture par la page hébergée (carte de test `4242 4242 4242 4242`), constater `invoice.paid` dans My Hub ; refuser un paiement (carte `4000 0000 0000 0341`), constater `past_due`.

## 9. Décisions à valider par le fondateur

- Montants de la grille (section 2), dont les frais d'installation de Solo et d'Entreprise et le prix par véhicule.
- Licence annuelle : véhicules en sus facturés 12 mois d'avance au compte de l'émission, sans remise ; une flotte qui grandit en cours d'année ne paie ses nouveaux véhicules qu'au renouvellement.
- Changement de formule sans prorata ni complément de frais d'installation (Solo vers Pro par exemple).
- Échéance : payable à réception (`billing.payment_terms_days = 0`) ; 15 ou 30 jours possibles par réglage.
- Pas de facture pendant la suspension ; à la réactivation, la période repart du règlement.
- Une organisation très active peut toujours avoir une course en cours : la suspension serait reportée indéfiniment. Proposition : après 7 jours de report, bloquer les nouvelles courses et laisser finir celles en cours (à coder avec la garde des organisations).
- Rôle finance de la plateforme : lui donner `billing.view` et `billing.manage` (aujourd'hui, l'administrateur seulement).
- Stripe tient-il le cycle (abonnements Stripe, Stripe Tax, relances de Stripe) ? Non par défaut (section 1) : le choix inverse retirerait la numérotation PF et la règle « jamais pendant une course » de la main de Neomoov.

## 10. Exploitation

- La passe horaire de la file `billing` ne lance le cycle qu'à `billing.run_hour` ; `POST /v1/admin/billing/run` le lance tout de suite et rend le rapport (essais terminés, renouvellements, factures émises, transmises, retards, rappels, lectures seules, suspensions, reports, réactivations, erreurs).
- Une panne de Stripe n'empêche ni l'abonnement ni l'émission : la facture reste sans identifiant Stripe et la passe suivante la transmet (clés d'idempotence dérivées de l'identifiant de la facture).
- Une erreur sur une organisation n'arrête pas la passe : elle est comptée, journalisée et reprise à la passe suivante.
