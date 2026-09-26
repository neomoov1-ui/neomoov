> Annexe de `v1-final-review.md`. État relevé **avant** les corrections faites pendant la revue (liste dans le rapport final, section 3) : certains écarts ci-dessous sont depuis corrigés.

# Revue finale V1, partie A : modèle de données (section 4) et règles métier (sections 5.1 à 5.16)

Revue du prompt 17.B, en lecture seule, sur `C:\Users\PC\code\neomoov-wt14` (branche `etape-17-revue`, dernier commit `1d82ebe`, identique à main). Aucun test n'a été exécuté (consigne : base de développement partagée) ; la colonne « Preuve » cite le code et le test qui vérifie la règle quand il existe. Les tests d'intégration de `apps/api/test/*.e2e.test.ts` s'exécutent sur une base réelle et se sautent eux-mêmes sans base (`async ({ skip })`) : leur existence est constatée, leur réussite n'est pas vérifiée ici.

Sources lues : `docs/prompts/17-reprise-et-revue-finale.md` (17.B), `docs/prompts/18-amendements-v1-1.md` (l'emporte sur le cahier), `docs/decisions.md` (ses dates sont citées sous la forme « décision du JJ/MM, ligne N »), `docs/cahier-des-charges-v1.md` sections 4 et 5.

Rappel utile : `docs/decisions.md:3` dit que « le cahier des charges fait foi ; ce journal couvre ce sur quoi il est muet ». Une décision du journal qui contredit le cahier n'est donc pas une dérogation validée : elle est signalée comme écart à faire valider par le fondateur.

Légende des statuts : **conforme** (code et test ou preuve directe), **partiel** (une partie manque ou diffère), **absent**, **reporté** (report explicite par une décision datée ou par les amendements v1.1).

## Synthèse

| Périmètre | Conforme | Partiel | Absent | Reporté | Total |
|---|---|---|---|---|---|
| Section 4 et tables des amendements v1.1 | 71 | 10 | 6 | 0 | 87 |
| Sections 5.1 à 5.16 | 135 | 39 | 9 | 4 | 187 |
| **Total** | **206** | **49** | **15** | **4** | **274** |

Constat d'ensemble : le socle est solide et largement testé (moteurs de tarification, de règlement, de packs et de négociation écrits en fonctions pures et testés, couverture non mesurée ici ; parcours d'intégration nombreux). Les écarts se concentrent sur quatre points : (1) le cycle de vie ne permet pas de clore une course en cours autrement qu'en la terminant ; (2) les jalons des réservations (90 minutes, 60 minutes, rappel au chauffeur) sont incomplets alors que toutes les courses de la V1 sont des réservations ; (3) les frais d'annulation des courses payées au chauffeur sont facturés sans être perçus ; (4) des données de départ ou des décisions du journal contredisent le cahier sans validation (Priorité × 1,15, pack non exigé, autorisation à l'attribution, promotions non revalidées). Cinq écarts sont jugés bloquants pour la bêta (section 3.1).

---

## 1. Section 4 : modèle de données

Schéma Drizzle dans `packages/db/src/schema/`, migrations SQL dans `packages/db/drizzle/` (0000 à 0014, chacune avec son inverse dans `drizzle/down/`, vérifié par `packages/db/test/seed-data.test.ts:72`). Pour une table, la « preuve directe » est la déclaration Drizzle et sa migration ; les tests cités sont ceux qui l'exercent.

### 1.1 Exigences générales (préambule de la section 4)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| `id` en UUID v7 sur toutes les tables | partiel | `packages/db/src/schema/_helpers.ts:9` | `gen_random_uuid()` produit des UUID v4 (aléatoires, non ordonnés dans le temps). Les index B-tree sur `id` se fragmentent sur les grosses tables (`ride_events`, `notifications`, `audit_log`). Plusieurs tables n'ont pas d'`id` (clé composite ou code) : `user_roles`, `favorite_drivers`, `client_driver_links`, `settings`, `feature_flags`, `packs`, `agents`, `driver_presence`, `ride_tracks`, `ride_dispatches`, `driver_balances`, `driver_locations` |
| `tenant_id` sur toutes les tables | absent | aucune occurrence de `tenant_id` dans `packages/db` | Remplacé de fait par `organization_id` (D42) sur 5 tables seulement (voir 1.11). Aucune décision datée ne supprime `tenant_id` |
| `created_at` et `updated_at` sur toutes les tables | partiel | `_helpers.ts:11-12` | `updated_at` absent de : `user_roles`, `sessions`, `devices`, `otp_codes`, `consents`, `audit_log` (normal, ajout seul), `saved_places`, `favorite_drivers`, `referrals`, `client_payment_methods`, `quotes`, `ride_events`, `ride_offers`, `ride_ratings`, `ride_tracks`, `ride_messages`, `scheduled_assignments`, `refunds`, `pack_consumptions`, `statement_lines`, `promotion_uses`, `credits`, `invoices`, `sev_transmissions`, `redevance_ledger`, `tax_ledger`, `geolocation_exports`, `sanctions`, `data_requests`, `retention_jobs`, `business_members`, `vehicle_financings`, `agent_runs`, `approvals`, `notifications`, `driver_shifts`, `driver_locations` |
| `city_id` sur les tables métier | partiel | `pricing.ts:19,31,57,74,124`, `rides.ts:15` | Une table `cities` (clé `code`) et une colonne `city_code` existent sur `zones`, `pricing_rules`, `surcharges`, `quotes`, `rides`, `competitor_benchmarks`. Absente de `drivers`, `vehicles`, `payments`, `invoices`, `weekly_statements`, `promotions`, `packs`, `settings` (portée texte `scope` à la place). Suffisant pour une seule ville en V1, à compléter avant une deuxième ville |
| Montants en cents (entiers), CAD | conforme | `_helpers.ts:15-16` ; contraintes CHECK, par exemple `rides.ts:96-99`, `payments.ts:42` | Taux en ppm ou en points de base, jamais en flottant |
| Dates en UTC (`timestamptz`), affichées en heure de Montréal | conforme | `_helpers.ts:11-13` | Dates civiles (`date`) seulement pour les périodes et les échéances, voulu |
| Positions `geography(Point, 4326)` | conforme | `_helpers.ts:20-45` ; `packages/db/test/geo-point.test.ts:5-27` ; `seed-data.test.ts:81` | Polygones et traces aussi en `geography`, index GiST (`drivers.ts:143`, `pricing.ts:27`, `rides.ts:95`) |
| Suppressions logiques (`deleted_at`) sauf effacement Loi 25 | partiel | `identity.ts:25`, `clients.ts:41` | `deleted_at` seulement sur `users` et `client_payment_methods`. Les chauffeurs ont `offboarded_at` (`drivers.ts:47`), les clients un statut `deleted` (`clients.ts:26`). Les autres tables sont effacées physiquement (lieux, favoris, promotions…). Aucune décision datée sur ce point |
| Intégrité référentielle (clés étrangères) | partiel | liste des contraintes `*_fk` des migrations 0000 à 0014 | Colonnes de référence sans clé étrangère : `favorite_drivers.driver_id` (`clients.ts:55`), `client_driver_links.driver_id` (`clients.ts:62`), `quotes.client_id` (`pricing.ts:71`), `rides.promotion_id` (`rides.ts:60`), `rides.organization_id` et les 4 autres `organization_id`, `statement_lines.ride_id` et `pack_purchase_id` (`payments.ts:169-170`), `pack_purchases.statement_id` (`payments.ts:123`), `invoices.credit_note_of_id` (`billing.ts:38`), `refunds.credit_id` (`payments.ts:53`), `drivers.current_vehicle_id` (`drivers.ts:44`), `sessions.device_id` (`identity.ts:49`), `clients.business_account_id` (`clients.ts:14`). Des lignes orphelines sont possibles sur des relations métier (favoris, relevés, notes de crédit) |

### 1.2 Section 4.1 : comptes et identité

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `users` | conforme | `identity.ts:8-36` ; `apps/api/test/auth.e2e.test.ts:21,43` ; `me.e2e.test.ts:23,127` | Téléphone unique et E.164 (CHECK `identity.ts:35`), courriel, nom, prénom, langue, rôle principal, statut, Apple et Google (uniques partiels), conditions acceptées, version de la politique. En plus : client Stripe, code de parrainage |
| `user_roles` | conforme | `identity.ts:38-44` ; `authorization.e2e.test.ts:33-94` | Rôles `finance` et `readonly` ajoutés (décision du 25/09, ligne 45, migration 0002). Périmètre = colonne `scope` |
| `sessions` | conforme | `identity.ts:46-60` ; `auth.e2e.test.ts:89,115` | Jeton haché, expiration, révocation, famille de rotation, `amr`. `device_id` sans clé étrangère |
| `devices` | conforme | `identity.ts:62-70` ; `me.e2e.test.ts:51` | Plateforme (CHECK ios, android, web), jeton push unique, version, dernière activité |
| `otp_codes` | conforme | `identity.ts:72-80` ; `auth.e2e.test.ts:63` | Code haché (HMAC, décision du 25/09, ligne 47), expiration, tentatives bornées |
| `consents` | conforme | `identity.ts:82-90` ; énumération `packages/domain/src/enums.ts:106` ; `me.e2e.test.ts:68` | Les 5 finalités, version, accordé le, retiré le, source |
| `audit_log` | conforme | `identity.ts:93-106` ; déclencheur `drizzle/0001_postgis-triggers-partitions.sql:7` ; `seed-data.test.ts:89` ; `audit-export.e2e.test.ts:19` | Acteur utilisateur ou agent, action, entité, avant, après, IP, horodatage, corrélation. Ajout seul par déclencheur `forbid_change()` |

### 1.3 Section 4.2 : clients

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `clients` | conforme | `clients.ts:8-29` ; `client-profile.e2e.test.ts:34` | Préférences en JSON (validées par Zod, voir 5.10), notes, statut, compte entreprise et abonnement (V2). En plus : `ride_count`, `balance_due_cents`, groupe de test de la négociation |
| `client_payment_methods` | conforme | `clients.ts:31-42` ; `payments.e2e.test.ts:80` | Identifiant Stripe unique, marque, 4 derniers chiffres, par défaut, suppression logique |
| `saved_places` | conforme | `clients.ts:44-51` ; `client-profile.e2e.test.ts:48` | |
| `favorite_drivers` | partiel | `clients.ts:53-57` ; `growth-favorites-guarantee.e2e.test.ts:95` | `driver_id` sans clé étrangère vers `drivers` |
| `referrals` | conforme | `clients.ts:70-92` ; `growth-credits-referral.e2e.test.ts:152,229` | Parrain, filleul, code, statut, crédits accordés ; type client ou chauffeur |

### 1.4 Section 4.3 : chauffeurs et véhicules

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `drivers` | conforme | `drivers.ts:9-56` ; `driver-account.e2e.test.ts:48` ; `field-encryption.e2e.test.ts:44` | Statut (5 valeurs), qualification, TPS et TVQ (chiffrées, 255 caractères, migration 0014), nom commercial, Connect, moyens acceptés (`accepts_cash`, `accepts_interac`, `accepts_terminal` ; la carte est toujours acceptée), zones préférées, note, nombre de courses, méthode de prélèvement. `organization_id` sans clé étrangère |
| `driver_documents` | conforme | `drivers.ts:58-76` ; `admin-hub.e2e.test.ts:32` ; `agents.e2e.test.ts:469` | 8 types, fichier, numéro chiffré, émission, expiration, 4 statuts, vérifié par humain (`verified_by_user_id`) ou agent (`verified_by_agent_code`) |
| `vehicles` | conforme | `drivers.ts:90-117` | Électrique obligatoire (CHECK `drivers.ts:114`), plaque et VIN uniques, équipements JSON, dernière inspection et prochaine échéance. Il manque le kilométrage relevé à la dernière vérification mécanique, nécessaire à la règle des 60 000 km (voir 5.12) |
| `vehicle_categories` | conforme | `drivers.ts:78-88` ; `seed-data.test.ts:49` | Code (4 valeurs), rang unique, places, modèles admis, année minimale, actif |
| `driver_presence` | conforme | `drivers.ts:134-143` ; `realtime.e2e.test.ts:80` | Le cahier la place dans Redis ; le code la tient dans PostGIS avec Redis GEO en appoint (décisions du 22/09 ligne 26 et du 25/09 ligne 70). Statut porté par `is_available` et `current_ride_id` plutôt qu'une énumération `online`, `busy`, `paused` |
| `driver_locations` | conforme | `drivers.ts:123-131` ; partitions `0001_postgis-triggers-partitions.sql:25-31` ; `seed-data.test.ts:89` ; `retention.e2e.test.ts:37` | Partitionnée par jour, purge à 90 jours |
| `driver_shifts` | conforme | `drivers.ts:145-154` ; `driver-account.e2e.test.ts:304` | Vérification faciale (V1.1) derrière drapeau |
| `driver_scores` | conforme | `drivers.ts:156-173` ; `driver-account.e2e.test.ts:205` | Une ligne par jour (décision du 26/09, ligne 101) |

### 1.5 Section 4.4 : tarification et zones

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `zones` | conforme | `pricing.ts:17-27` ; `admin-hub.e2e.test.ts:141` ; `seed-data.test.ts:60` | Type (4 valeurs), polygone `geography`, index GiST |
| `pricing_rules` | conforme | `pricing.ts:29-40` ; `seed-data.test.ts:17` | Ville, catégorie, prise en charge, km, minute, minimum, validité |
| `flat_rates` | conforme | `pricing.ts:42-53` ; `seed-data.test.ts:26` ; `quotes.e2e.test.ts:80` | Prix total affiché, sens unique ou deux sens |
| `surcharges` | conforme | `pricing.ts:55-67` ; `seed-data.test.ts:42` | Codes (6 valeurs), montant fixe ou par unité, conditions JSON |
| `quotes` | conforme | `pricing.ts:69-115` ; `quotes.e2e.test.ts:31` | Tous les champs du cahier, plus péages, remise d'alignement, promotion, reste à payer, mode dégradé, version des règles, empreinte. `client_id` sans clé étrangère |

### 1.6 Section 4.5 : courses

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `rides` | conforme | `rides.ts:11-103` ; `rides.e2e.test.ts:41` | Tous les champs listés (y compris vol, passager tiers, préférences, mode de paiement, prix maximal consenti, garantie modèle, favori demandé, horodatages `state_timestamps`). Invariants CHECK : prix final et prix convenu au plus le prix maximal consenti (`rides.ts:97-99`), client ou invité (`:101`). `promotion_id` et `organization_id` sans clé étrangère |
| `ride_events` | conforme | `rides.ts:106-116` ; déclencheur `0001_postgis-triggers-partitions.sql:8` ; `rides.e2e.test.ts:41` | Ajout seul ; acteur `client`, `driver`, `operator`, `system`, `agent` |
| `ride_offers` | conforme | `rides.ts:122-149` ; `dispatch.e2e.test.ts:201,502` | Prix proposé, 3 types, 5 états, expiration, une offre en attente par chauffeur, course et type |
| `ride_ratings` | conforme | `rides.ts:185-194` ; `rides.e2e.test.ts:41` ; `driver-account.e2e.test.ts:205` | Deux côtés, note 1 à 5, étiquettes |
| `ride_tracks` | conforme | `rides.ts:196-203` ; `apps/api/test/pricing-units.test.ts:25` | Trace simplifiée, distance et durée mesurées |
| `ride_messages` | conforme | `rides.ts:205-214` ; `messaging.e2e.test.ts:37` | Canal (`in_app`, `sms`) ajouté |
| `scheduled_assignments` | conforme | `rides.ts:216-225` ; `scheduled.e2e.test.ts:25` | |

### 1.7 Section 4.6 : paiements, packs et règlements

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `payments` | conforme | `payments.ts:12-44` ; `payments.e2e.test.ts:116-286` | 6 méthodes, identifiant Stripe unique, autorisé, capturé, pourboire, statut (dont `paid_direct`), encaissé par. Nature (`kind`) et idempotence en plus |
| `refunds` | conforme | `payments.ts:46-66` ; `payments.e2e.test.ts:318` | Décidé par humain ou agent, remboursement ou crédit |
| `packs` | conforme | `payments.ts:96-106` ; `seed-data.test.ts:54` | |
| `pack_purchases` | conforme | `payments.ts:108-126` ; `growth-packs-promotions.e2e.test.ts:79-212` | Reportées, renouvellement, facturation (`billing`, `statement_id`) |
| `pack_consumptions` | conforme | `payments.ts:128-134` ; `growth-packs-promotions.e2e.test.ts:79` | Unicité par course |
| `weekly_statements` | conforme | `payments.ts:136-162` ; `settlement.e2e.test.ts:104` | Période du lundi au dimanche (CHECK `:162`), 5 statuts, transfert et prélèvement Stripe, PDF |
| `statement_lines` | conforme | `payments.ts:164-173` ; `settlement.e2e.test.ts:104` | `ride_id` et `pack_purchase_id` sans clé étrangère |
| `driver_balances` | conforme | `payments.ts:175-182` ; `settlement.e2e.test.ts:203` | |
| `promotions` | conforme | `payments.ts:184-203` ; `growth-packs-promotions.e2e.test.ts:278` | 4 types, conditions JSON, limites, budget, validité |
| `promotion_uses` | conforme | `payments.ts:205-213` ; `growth-packs-promotions.e2e.test.ts:235` | Compensation du chauffeur en plus |
| `credits` | conforme | `payments.ts:215-225` ; `growth-credits-referral.e2e.test.ts:92` | Origine (6 valeurs), solde (`remaining_cents`), expiration. Aucune origine pour l'arrondi solidaire (V2, voir 5.9) |

### 1.8 Section 4.7 : facturation, taxes et conformité

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `invoices` | conforme | `billing.ts:15-50` ; `invoicing.e2e.test.ts:110,204` | Numéro global et séquence par fournisseur (uniques), fournisseur et ses numéros, lignes (document figé), taxes, pourboire, total, paiement, transaction SEV, statut, PDF, QR ; nature (course, annulation, non-présentation, note de crédit, migration 0012). `credit_note_of_id` sans clé étrangère ; commentaire de `billing.ts:12-13` périmé (parle d'une séquence PostgreSQL par chauffeur, le code utilise la table `counters`) |
| `sev_transmissions` | conforme | `billing.ts:52-61` ; `invoicing.e2e.test.ts:308` | |
| `redevance_ledger` | conforme | `billing.ts:63-71` ; `ledgers-exports.e2e.test.ts:120` | |
| `tax_ledger` | conforme | `billing.ts:73-83` ; `ledgers-exports.e2e.test.ts:120` | |
| `geolocation_exports` | conforme | `billing.ts:85-95` ; `ledgers-exports.e2e.test.ts:319` | |
| `compliance_checks` | conforme | `billing.ts:97-109` ; `compliance.e2e.test.ts:31,72` | |
| `incidents` | conforme | `billing.ts:111-128` ; `privacy-incidents.e2e.test.ts:36` ; `safety-hold.e2e.test.ts:38` | Pièces jointes, statut, décision ; la sanction est liée par `sanctions.incident_id` ; registre Loi 25 dans `privacy_breach` |
| `sanctions` | conforme | `billing.ts:130-140` ; `quality.e2e.test.ts:67` | |
| `data_requests` | conforme | `billing.ts:142-152` ; `me.e2e.test.ts:90` | 5 types, reçu, échéance, traité, résultat |
| `retention_jobs` | conforme | `billing.ts:154-160` ; `retention.e2e.test.ts:28,37` | |

### 1.9 Section 4.8 : partenaires, entreprises, investisseurs (structures seulement en V1)

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `partners` | conforme | `packages/db/src/schema/partners.ts:10-20` | Structure seule (écrans V2), aucun test (aucun code ne l'utilise) |
| `business_accounts` | conforme | `partners.ts:22-35` | Idem |
| `business_members` | conforme | `partners.ts:37-45` | Idem |
| `investors` | conforme | `partners.ts:47-56` | Idem (V3) |
| `vehicle_financings` | conforme | `partners.ts:58-69` | Idem (V3) |

### 1.10 Section 4.9 : agents IA et exploitation

| Table | Statut | Preuve | Remarque |
|---|---|---|---|
| `agents` | conforme | `agents.ts:10-24` ; `agents.e2e.test.ts:356` | Mode, modèle (défaut `claude-opus-5-5`, décision du 26/09, ligne 167), effort, outils, seuils, actif |
| `agent_runs` | conforme | `agents.ts:39-66` ; `agents.e2e.test.ts:356` | Jetons (dont cache), coût, durée, statut, idempotence par déclencheur |
| `approvals` | conforme | `agents.ts:68-84` ; `agents.e2e.test.ts:223` | |
| `notifications` | conforme | `agents.ts:129-143` ; `notifications.e2e.test.ts:42` | 5 canaux, envoyé, livré, lu, erreur |
| `settings` | conforme | `identity.ts:116-124` ; `admin-hub.e2e.test.ts:141` | Portée texte (`global` ou autre), modifié par ; `organization_id` ajouté (D42) mais hors de la clé primaire (`key`, `scope`) |
| `feature_flags` | partiel | `identity.ts:108-114` ; semée `packages/db/src/seed/index.ts:77` | Table présente et semée, mais **aucun code ne la lit** : les drapeaux viennent des variables d'environnement (`apps/api/src/config/env.ts:136-144`). Constat déjà écrit dans `docs/runbooks/drapeaux-et-reglages.md:86`. Pourcentage et ciblage inopérants |

### 1.11 Tables et colonnes exigées par les amendements v1.1 (prompt 02, `18-amendements-v1-1.md:10,14`)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| `organizations` (D42) | partiel | `partners.ts:72-81` ; ligne `neomoov` semée (migration 0003) | Type `platform` au lieu de `neomoov` (5.19) : simple différence de nom. Aucune clé étrangère vers `organizations` |
| `organization_id` sur `drivers`, `vehicles`, `rides`, `statements`, `settings` | partiel | `drivers.ts:45`, `drivers.ts:94`, `rides.ts:46`, `payments.ts:139`, `identity.ts:121` ; `drizzle/0003_pricing-benchmarks-organizations.sql:41-57` | Colonnes nullables, sans clé étrangère ni index. `rides.organization_id` est posé à la création (décision du 25/09, ligne 67) ; rien ne garantit qu'il le soit ailleurs |
| `client_driver_links` (D38, D40) | partiel | `clients.ts:60-68` ; alimentée à la fin de course `apps/api/src/modules/rides/rides.service.ts:807-812` ; `driver-account.e2e.test.ts:205` | `driver_id` sans clé étrangère |
| `ride_series` (D43, V1.1) | absent | aucune table ; seul le drapeau `ride_series` est semé (`seed/data.ts:260`) | Décision du 25/09 (ligne 63) : « reportée au prompt 05 », jamais faite. L'amendement exige la table dès le schéma, la fonction restant V1.1 |
| `competitor_benchmarks` (D33) | conforme | `pricing.ts:122-139` ; `quotes.e2e.test.ts:130` | |
| `interview_results` (D39) | absent | aucune table | Décision du 25/09 (ligne 63) : reportée au prompt 13, jamais faite |
| `recruitment_criteria` (D39) | absent | aucune table | Idem. L'amendement du prompt 12 veut « critères et score » dans le module Recrutement dès la V1 (seul le résultat d'entretien est V1.1) |
| `recording_consents` et `recordings` (D41, V2, structure seule) | absent | aucune table | Décision du 25/09 (ligne 63) : reportées au prompt 14, jamais faites. La finalité `audio_recording` existe dans `consents` |
| `installment_plans` (V1.1) | absent | aucune table | Décision du 25/09 (ligne 63) : reportée au prompt 07, jamais faite |
| Préférences étendues sur `clients` (D36, D37) | conforme | `clients.ts:11` (JSON) ; schéma `packages/domain/src/schemas/quotes.ts` (`ridePreferencesSchema`) ; `client-profile.e2e.test.ts:34` | |
| `rides.payment_choice` et `installment_provider_ref` (D35, D36) | conforme | `rides.ts:42-44`, CHECK `rides.ts:102` | |
| `tolls_cents` dans les lignes de devis (D33) | conforme | `pricing.ts:98`, `rides.ts:45` ; `packages/domain/src/pricing/quote.ts:159-161` ; `packages/domain/test/benchmark.test.ts:27-44` | |
| Réglages de départ (préavis 7200, bornes de négociation, marge 50 000 ppm, échelonné 15 000) | conforme | `packages/db/src/seed/data.ts:76-85` | |
| Drapeaux `FEATURE_IMMEDIATE_RIDES`, `FEATURE_NEGOTIATION_ABOVE_MAX`, `FEATURE_INSTALLMENTS`, `FEATURE_RIDE_SERIES` désactivés | conforme | défaut `off` : `apps/api/src/config/env.ts:13-16,136-144` ; table `seed/data.ts:257-260` | La table n'est pas lue (voir `feature_flags`) : seul l'environnement compte. La valeur réelle en « production de test » n'est pas vérifiable depuis le dépôt |

Tables présentes hors cahier (information) : `cities`, `ride_dispatches`, `credit_uses`, `webhook_events`, `staff_credentials`, `api_keys`, `driver_training_results`, `agent_prompts`, `conversations`, `conversation_messages`, `staff_notes`, `leads`, `counters` (SQL seul, migration 0001), `driver_locations_default`.

---

## 2. Sections 5.1 à 5.16 : règles métier

Chemins abrégés : `domain/` = `packages/domain/src/`, `dtest/` = `packages/domain/test/`, `api/` = `apps/api/src/modules/`, `atest/` = `apps/api/test/`, `seed` = `packages/db/src/seed/data.ts`.

### 2.1 Section 5.1 : tarification

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Entrées : catégorie, distance et durée de l'API Routes avec le trafic à l'heure de prise en charge (`departureTime`) | conforme | `api/pricing/quotes.service.ts:286-296` ; `apps/api/src/adapters/real/google-maps.ts:146-158` ; `atest/google-maps.test.ts:25` | `TRAFFIC_AWARE` et `departureTime` vérifiés dans le test. Mode dégradé (estimation interne) testé `atest/quotes.e2e.test.ts:113` |
| Péages réels (`tollInfo`) en ligne « Péages » du prix affiché, jamais au tarif chauffeur, ignorés sous forfait | conforme | `domain/pricing/quote.ts:159-162` ; `google-maps.ts` (`extraComputations: TOLLS`) ; `dtest/benchmark.test.ts:27-44` | |
| Heure de prise en charge au moins 2 h après la demande (D32) | conforme | `api/pricing/quotes.service.ts:268-283` ; `atest/quotes.e2e.test.ts:64` | Voir 5.3 |
| Zones d'origine et de destination, options, code promo, crédits en entrée | conforme | `api/pricing/quotes.service.ts:108-159` ; `domain/pricing/types.ts:93-109` | |
| Tarif = max(prise en charge + km + minutes, minimum) | conforme | `domain/pricing/quote.ts:131-140` ; `dtest/pricing.test.ts:36,55-66` | Exemple de contrôle 24,55 $ et 31,56 $ testé aussi sur les données de départ (`packages/db/test/seed-data.test.ts:17`) |
| Suppléments : nuit 23 h à 5 h 2 $, aéroport 3 $, siège enfant 3 $, bagages 2 $, arrêt 2 $ | conforme | `domain/pricing/quote.ts:51-62` ; `seed:34-40` ; `dtest/pricing.test.ts:76-86` ; `seed-data.test.ts:42` | |
| Offre Flex : × 0,90 hors pointe, prise en charge jusqu'à 15 minutes | partiel | `domain/pricing/quote.ts:127-147` ; `dtest/pricing.test.ts:96-101` | Prix et refus en pointe conformes. La tolérance de prise en charge de 15 minutes n'existe nulle part dans la répartition (`api/rides/` ne lit jamais l'option). Flex et Priorité exclusives : décision du 22/09 (ligne 13), « à confirmer par le fondateur ». Heures de pointe provisoires (ligne 14) |
| Offre Priorité : × 1,25 | partiel | moteur : `domain/pricing/quote.ts:142-146`, `dtest/pricing.test.ts:104` (avec 12 500 points de base) ; **données : `seed:71` vaut 11 500 (× 1,15)** | Les données de départ contredisent le cahier (1,15 au lieu de 1,25) sans décision datée ; les maquettes (`docs/design/canevas/outils/lot3-hub.js:149`) affichent « +15 % ». Aucun test ne vérifie la valeur semée. À trancher par le fondateur, puis aligner cahier ou données |
| Chauffeur favori demandé : + 3,00 $ | conforme | `domain/pricing/quote.ts:148-151` ; `seed:72` ; `dtest/pricing.test.ts:116` ; `atest/growth-favorites-guarantee.e2e.test.ts:156` | « 0 avec Privilège » : V2, hors périmètre |
| Forfait zones : remplace tout le calcul et donne le prix total affiché | conforme | `domain/pricing/quote.ts:115-125` ; `dtest/pricing.test.ts:132-159` ; `atest/quotes.e2e.test.ts:80` | Forfait indécomposable refusé (décision du 22/09, ligne 15) |
| Grille V1 (Premium, Prestige, XL) et forfaits 55 $, 69 $, 75 $ | conforme | `seed:28-32,44-48` ; `seed-data.test.ts:17,26` | Forfaits semés seulement entre le centre-ville et l'aéroport (YUL) |
| Sous-total = tarif + frais de service 2 $ + redevance 0,90 $ ; TPS 5 % ; TVQ 9,975 % | conforme | `domain/pricing/quote.ts:157-164` ; `seed:66-69` ; `dtest/pricing.test.ts:36-47` | |
| Arrondi au cent ligne par ligne, total = somme des lignes, CAD | conforme | `domain/pricing/quote.ts:12-15,163-164` ; `dtest/pricing.test.ts:66-70` | |
| Devis valable 5 minutes ; figé à la demande (prix maximal consenti) | conforme | `api/pricing/quotes.service.ts:121,124` ; `api/rides/rides.service.ts:351` (`QUOTE_EXPIRED`) ; `atest/quotes.e2e.test.ts:49` | Un devis ne sert qu'à une course (index `rides_quote_unique`, `rides.ts:90`) |
| Attente au-delà de 5 minutes : 0,50 $ par minute, à la fin, dans la limite du prix maximal consenti | conforme | `domain/pricing/quote.ts:176-197` ; `dtest/pricing.test.ts:213-234` ; `api/rides/rides.service.ts:783` | Prix maximal consenti = affiché + 20 $ (décision du 22/09, ligne 17) |
| Affichage du détail (tarif, frais, péages, redevance, taxes, suppléments) avant confirmation | conforme | lignes renvoyées par l'API `api/pricing/quotes.service.ts:181-185` ; `atest/quotes.e2e.test.ts:31` | Contrôle des écrans hors de cette partie (sections 6.x) |
| Aucune majoration dynamique ni multiplicateur de pointe ; le trafic n'agit que par la durée | conforme | `domain/pricing/quote.ts:33-38` (la pointe sert seulement à refuser Flex) ; `dtest/pricing.test.ts:109` | |
| Vérification concurrentielle (D33) : aucune API Uber ou Lyft, table `competitor_benchmarks` saisie dans My Hub | conforme | `packages/db/src/schema/pricing.ts:122` ; `api/pricing/pricing.controller.ts` (saisie) ; `atest/quotes.e2e.test.ts:130` | |
| `benchmarkCheck` pure : référence la plus proche (mêmes zones, plage, moins de 14 jours) | conforme | `domain/pricing/benchmark.ts:55-72` ; `dtest/benchmark.test.ts:77-99` | Signature étendue (`rules`, `context`) par rapport à l'amendement, sans effet sur la règle |
| Au-delà de référence × (1 − 5 %) : « Remise d'alignement » sur les frais de service jusqu'à 0, jamais le tarif chauffeur | conforme | `domain/pricing/benchmark.ts:80-110` ; `dtest/benchmark.test.ts:104-150` ; `atest/quotes.e2e.test.ts:130` | |
| Événement `benchmark_exceeded` journalisé pour la direction, alerte quotidienne | partiel | `api/pricing/quotes.service.ts:171-176` (audit `pricing.benchmark_exceeded` et journal) | Aucune alerte quotidienne : aucun code hors du module de tarification ne lit cet événement (l'agent d'analyse ne l'utilise pas). La décision du 25/09 (ligne 58) la renvoyait à l'étape 13, non faite |
| Sans référence, aucun ajustement ; règle interne, aucun message public comparatif | conforme | `domain/pricing/benchmark.ts:83` ; `api/pricing/quotes.service.ts:90` (référence retirée de la réponse publique) ; `dtest/benchmark.test.ts:105` | |
| Promotions sur le tarif chauffeur, compensées à 100 % au chauffeur | conforme | `domain/pricing/quote.ts:154-169` ; `domain/settlement/settlement.ts:143` ; `dtest/pricing.test.ts:170` ; `dtest/settlement.test.ts:37` | |
| Crédits du client appliqués au total affiché | conforme | `domain/pricing/quote.ts:165` ; `dtest/pricing.test.ts:192` | |

### 2.2 Section 5.2 : cycle de vie d'une course

Machine à états : `domain/rides/state-machine.ts:31-55`, testée par `dtest/state-machine.test.ts` ; appliquée sous verrou par `api/rides/rides.service.ts:447-475`.

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| `quoted` : vers `requested`, ou expiration | partiel | transitions `state-machine.ts:32-33` | Aucune course n'est jamais créée à l'état `quoted` : le devis vit dans `quotes` et expire par `valid_until` (`rides.service.ts:351`). Les états `quoted` et `expired` (décision du 22/09, ligne 28) sont inatteignables. Fonctionnellement couvert, modèle divergent |
| `requested` : vers `offering`, `cancelled_by_client` (gratuit), `no_driver` | conforme | `state-machine.ts:34-36` ; `dtest/state-machine.test.ts:36` ; `atest/rides.e2e.test.ts:123` | « Paiement autorisé si carte » : voir 5.3 et 5.6 (autorisé à l'attribution pour une réservation) |
| `offering` : vers `assigned`, `requested` (nouvelle vague), `no_driver`, `cancelled_by_client` | conforme | `state-machine.ts:37-40` ; `atest/dispatch.e2e.test.ts:201` | |
| `assigned` : vers `en_route`, `cancelled_by_client`, `cancelled_by_driver` | conforme | `state-machine.ts:41-43` ; `atest/rides.e2e.test.ts:41,123,175` | |
| `en_route` : vers `arrived`, `cancelled_by_client` (frais), `cancelled_by_driver` (sanction) | conforme | `state-machine.ts:44-46` ; `atest/journeys.e2e.test.ts:106` | La « sanction » est une entrée d'audit (`rides.service.ts:691`) comptée par l'agent qualité (annulations tardives) |
| `arrived` : vers `in_progress`, `no_show` (5 minutes et deux contacts), `cancelled_by_client` (frais) | conforme | `state-machine.ts:47-49` ; `domain/rides/cancellation.ts:56-61` ; `atest/rides.e2e.test.ts:152` | |
| `in_progress` : vers `completed`, `interrupted` (incident) | partiel | `state-machine.ts:50-51` | L'événement `incident` n'est déclenché par aucun code de l'API : une course ne peut pas passer à `interrupted`. Le SOS ouvre un incident sans changer l'état |
| `completed` : prix final, paiement capturé ou encaissé en direct, facture, pack consommé ; vers `rated`, `disputed` | partiel | `rides.service.ts:773-825` ; capture `api/payments/payments.service.ts:290` ; facture `api/invoicing/invoice-jobs.service.ts` ; pack `api/rides/pack-lifecycle.service.ts` ; `atest/rides.e2e.test.ts:41` ; `atest/invoicing.e2e.test.ts:110` | `rated` conforme (`rides.service.ts:916`). L'événement `client_disputes` n'est déclenché nulle part : l'état `disputed` est inatteignable (la contestation passe par un incident) |
| `no_driver` : fin, client informé, alternative par l'opérateur | conforme | `rides.service.ts:499-509` ; `atest/journeys.e2e.test.ts:127` | |
| `cancelled_by_client`, `no_show` : fin (frais de non-présentation) | conforme | `atest/rides.e2e.test.ts:123,152` ; `atest/journeys.e2e.test.ts:83` | |
| `cancelled_by_driver` : retour à `requested` pour réattribution automatique | conforme | `state-machine.ts:54` ; `rides.service.ts:672-693` ; `atest/rides.e2e.test.ts:175` ; `atest/dispatch.e2e.test.ts:269` | |
| `interrupted` : fin, traitement par incident | absent | aucune transition déclenchée (voir `in_progress`) | |
| Annulation client gratuite 2 minutes après l'attribution, puis 5,00 $ | conforme | `domain/rides/cancellation.ts:27-44` ; `seed:101-102` ; `dtest/cancellation.test.ts:9-19` ; `atest/rides.e2e.test.ts:123` | |
| Non-présentation après 5 minutes sur place : 7,00 $ | conforme | `cancellation.ts:56-61` ; `seed:103,106-107` ; `dtest/cancellation.test.ts:27` ; `atest/journeys.e2e.test.ts:83` | |
| Frais 100 % au chauffeur, Neomoov ne prend rien | partiel | relevé `domain/settlement/settlement.ts:128-130` ; facture au chauffeur (décision du 26/09, ligne 152) ; `dtest/settlement.test.ts:51` ; `atest/invoicing.e2e.test.ts:227` | Course payée au chauffeur : les frais ne sont jamais encaissés (décision du 26/09, ligne 122 ; ligne 162 : `cancellation_fee_due` sans source). Le chauffeur n'en reçoit donc rien |
| Annulation du chauffeur après `en_route` : compte dans son score, réattribution immédiate avec priorité | conforme | effets `state-machine.ts:46` ; `api/agents/quality.agent.ts` (annulations tardives) ; `atest/journeys.e2e.test.ts:106` ; `atest/dispatch.e2e.test.ts:269` | |
| Garantie modèle à l'attribution : catégorie réservée ou supérieure, sinon non candidat | conforme | `rides.service.ts:527-530` ; `api/rides/eligibility.ts:68-71` ; `dtest/state-machine.test.ts:63` ; `atest/rides.e2e.test.ts:246` | |
| Signalement du client sous 24 h, validation par l'opérateur ou l'agent qualité, remboursement intégral ; tarif maintenu au chauffeur hors faute, sinon sanction | partiel | `rides.service.ts:1035-1058` ; `api/guarantee/guarantee.service.ts` ; `atest/growth-favorites-guarantee.e2e.test.ts:194,228,257` | Validation par l'opérateur seulement (l'agent qualité n'intervient pas). Chauffeur en faute : tarif retiré au relevé (décision du 26/09, ligne 161) mais la sanction n'est qu'une note proposée, jamais appliquée (ligne 142), alors que le cahier dit « la sanction s'applique » |
| Chaque transition dans `ride_events` avec l'acteur, publiée en temps réel | conforme | `rides.service.ts:471,477-482` ; `api/rides/realtime.service.ts` ; `atest/realtime.e2e.test.ts:80` ; `atest/rides.e2e.test.ts:41` | |

### 2.3 Section 5.3 : réservation avec préavis et réservation planifiée

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Préavis minimal de 2 heures (`rides.min_lead_seconds` 7200), au plus 30 jours, aucun « maintenant » | conforme | `api/pricing/quotes.service.ts:268-283` ; `api/rides/rides.service.ts:227-228,294,355` ; `seed:83-84` ; `atest/quotes.e2e.test.ts:64` | |
| Drapeau `FEATURE_IMMEDIATE_RIDES` désactivé | conforme | `apps/api/src/config/env.ts:13-16,140` ; `atest/client-profile.e2e.test.ts:21` | |
| Drapeau activé : préavis ramené à `rides.immediate_min_lead_seconds` | partiel | `quotes.service.ts:272-278` | Le réglage n'existe pas (`seed:108` porte `rides.scheduled_min_lead_seconds`, lu par aucun code) : drapeau activé, une course sans heure passe, mais une heure précise reste soumise aux 2 heures. Sans effet en V1 |
| Refus `LEAD_TIME_TOO_SHORT` avec « Réservez au moins 2 heures à l'avance » | conforme | `quotes.service.ts:270-271` (message construit depuis le réglage, `earliestPickupAt` fourni) ; `atest/quotes.e2e.test.ts:69-72` | |
| Numéro de vol optionnel ; en V1 rappel manuel de l'opérateur (suivi de vol V2) | partiel | `rides.service.ts:263,308` ; fiche du chauffeur `api/drivers/driver-activity.service.ts:474` ; `atest/journeys.e2e.test.ts:64` | Le numéro est gardé et montré au chauffeur ; aucun rappel ni liste des courses avec vol pour l'opérateur. Suivi automatique : V2 (drapeau `FEATURE_SCHEDULED_FLIGHT_TRACKING`) |
| Prépaiement : autorisation créée à la réservation pour le prix maximal consenti | partiel | `api/payments/payments.service.ts:193,249-288` ; `atest/payments.e2e.test.ts:116,201` | Pour une réservation, la carte est vérifiée à la réservation mais autorisée à l'attribution, ou plus tard au-delà de 6 jours (décision du 26/09, ligne 121) : contraire au texte du cahier, sans validation du fondateur. De plus, la carte est fermée en production tant que Stripe réel n'est pas branché (ligne 211) : en bêta, aucun prépaiement |
| Paiement au chauffeur : aucune autorisation, moyen de secours possible pour les frais d'annulation | partiel | aucune autorisation (`payments.service.ts:211-222`) | Moyen de secours pour les frais : absent ; les frais d'une course payée au chauffeur ne sont pas encaissés (décision du 26/09, ligne 122) |
| Offres dès la réservation aux chauffeurs disponibles sur le créneau, fenêtre de 10 minutes | conforme | `api/rides/dispatch.service.ts` (fenêtre `dispatch.scheduled_window_seconds`, `seed:145`) ; `atest/dispatch.e2e.test.ts:380` | |
| Priorité au favori disponible, puis à un autre favori du client, puis au score | conforme | `domain/dispatch/scoring.ts:93-94` ; exclusivité 120 s (`seed:147`) ; `dtest/dispatch.test.ts:54` ; `atest/dispatch.e2e.test.ts:380` | |
| Confirmation obligatoire du chauffeur | conforme | `api/rides/scheduled.service.ts:147-175` ; `atest/scheduled.e2e.test.ts:25` | |
| Attribution confirmée au plus tard 90 minutes avant l'heure | absent | `scheduled.service.ts:52-56` ; `seed:110-111` | Aucun jalon à 90 minutes : le déclenchement de l'attribution est à 60 minutes (`rides.scheduled_assign_before_seconds` 3600) |
| Sans confirmation à 60 minutes : réattribution et alerte à l'opérateur, attribution manuelle possible | partiel | `scheduled.service.ts:82-99` ; `atest/scheduled.e2e.test.ts:25` ; attribution manuelle `rides.service.ts:514` | À 60 minutes la fenêtre d'offres est rouverte, sans alerte ; l'alerte part à 30 minutes (`seed:111`), comme dans la matrice 5.14 mais pas comme dans le texte de 5.3 (le cahier se contredit ; à trancher) |
| Client : confirmation immédiate, rappel la veille (plus de 24 h), confirmation du chauffeur, départ du chauffeur | conforme | `rides.service.ts:433` (`ride.scheduled_confirmed`), `scheduled.service.ts:75-80`, `rides.service.ts:549-552`, `rides.service.ts:718` ; `atest/scheduled.e2e.test.ts:25` ; `atest/notifications.e2e.test.ts:42` | |
| Négociation : réservations standard (V1.1), exclue pour forfaits, entreprises, lots, Neo Limo | conforme | `domain/dispatch/negotiation.ts:78-84` ; `dtest/negotiation.test.ts:58` | Derrière `FEATURE_NEGOTIATION`, désactivé en V1 |

### 2.4 Section 5.4 : répartition

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Candidats : en ligne non occupés (ou fin de course à moins de 5 minutes de l'origine), véhicule conforme de catégorie égale ou supérieure, documents valides, solde non bloquant, dans le rayon | conforme | `api/rides/dispatch.service.ts:718-750` ; `api/rides/eligibility.ts:33-71` ; `atest/dispatch.e2e.test.ts:201` | Documents exigés par défaut : permis, assurance, immatriculation seulement (`seed:114`) |
| Candidat : pack avec courses restantes ou renouvellement automatique actif | partiel | `eligibility.ts:40-43` ; `domain/packs/packs.ts` (`canReceiveOffers`) ; `atest/growth-packs-promotions.e2e.test.ts:130` (réglage forcé à vrai dans le test) | Règle codée mais **désactivée par défaut** : `drivers.require_active_pack` = `false` (`seed:115`). Sans décision datée, un chauffeur sans pack reçoit des offres |
| Rayon : 2, 5, 10 km puis toute la zone, vagues de 20 secondes | conforme | `domain/dispatch/scoring.ts:112-126` ; `seed:133-134` ; `dtest/dispatch.test.ts:87-99` ; `atest/dispatch.e2e.test.ts:201,361` | |
| Score = 0,55 × ETA + 0,20 × (5 − note) × 4 + 0,15 × équité + 0,10 × zone, − 100 favori demandé, − 5 Illimité en contexte VIP, aéroport ou entreprise | conforme | `scoring.ts:88-97` ; poids `seed:140` ; `dtest/dispatch.test.ts:43-63` | Bonus de − 50 pour un autre favori du client ajouté (D37) |
| Pénalité d'équité nulle après 20 minutes sans course | conforme | `scoring.ts:76-79` ; `dtest/dispatch.test.ts:24` | |
| Déséquilibre de zone favorisant les zones sous-servies | partiel | `scoring.ts:92` | Toujours 0 en V1 (décision du 25/09, ligne 77) : le terme existe mais n'agit pas |
| Temps d'arrivée par la matrice pour les dix meilleurs candidats à vol d'oiseau (index GEO Redis) | conforme | `seed:141` (`dispatch.eta_candidates` 10) ; décision du 25/09 (ligne 77) ; `atest/dispatch.e2e.test.ts:201,650` | Tri à vol d'oiseau par PostGIS (`driver_presence`) et non Redis GEO (décision du 22/09, ligne 26) |
| Mode fixe : offre séquentielle de 15 s au meilleur, puis au suivant, cinq par vague | conforme | `seed:135-136` ; `atest/dispatch.e2e.test.ts:201` ; `atest/dispatch-concurrency.e2e.test.ts:48` | Offre exclusive sous verrou du chauffeur (décision du 26/09, ligne 221). Affichage « recherche d'un chauffeur » : hors de cette partie |
| Réattribution : annulation chauffeur ou immobilité 3 minutes après `assigned`, chauffeur exclu | conforme | `seed:138-139` ; `atest/dispatch.e2e.test.ts:269,295` | Réservation attribuée : pas de surveillance d'immobilité (décision du 25/09, ligne 78) |
| Enchaînement : offre pour la course suivante à un chauffeur en fin de course | partiel | `dispatch.service.ts:718-750` (`dispatch.chain_max_seconds`, `seed:137`) | Code présent, aucun test (aucune occurrence dans `atest/`). « Visible après avoir terminé la précédente » non vérifiable côté API |
| Panneau opérateur : forcer l'attribution, retirer un chauffeur, mettre en attente, créer une course sans compte | conforme | `api/rides/admin-rides.controller.ts` ; `atest/dispatch.e2e.test.ts:249,324` ; `atest/rides.e2e.test.ts:246` ; `atest/journeys.e2e.test.ts:147` | |

### 2.5 Section 5.5 : négociation encadrée (drapeau `FEATURE_NEGOTIATION`, désactivé en V1, activation V1.1 après avis juridique)

Le code existe en V1 derrière le drapeau (désactivé par défaut, `apps/api/src/config/env.ts:136`) ; le statut juge ce code, l'activation relevant de la V1.1.

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Drapeau inactif : aucune négociation exposée | conforme | `api/rides/dispatch.service.ts:1061,1093` ; `api/rides/realtime.service.ts:105` ; `atest/dispatch.e2e.test.ts:627` | 404 `FEATURE_DISABLED` |
| Proposition P' bornée entre 0,70 × P et P, arrondie au dollar (`pricing.negotiation_floor_ppm`) | conforme | `domain/dispatch/negotiation.ts:23-38` ; `seed:78` ; `dtest/negotiation.test.ts:10-29` ; `atest/dispatch.e2e.test.ts:502` | |
| Diffusion de P' et P aux cinq meilleurs candidats, fenêtre de 10 minutes pour une réservation | conforme | `dispatch.service.ts:260` (`negotiation.candidates` 5, `negotiation.window_seconds` 600) ; `atest/dispatch.e2e.test.ts:502` | |
| Chauffeur : accepte P', contre-propose une seule fois entre P' et P, ou décline | conforme | `negotiation.ts:57-66` ; `dispatch.service.ts:1029-1037` (`COUNTER_ALREADY_MADE`) ; `dtest/negotiation.test.ts:31-38` ; `atest/dispatch.e2e.test.ts:502` | |
| Offre P'' au-dessus de P avec motif (`exceptional_reason`), plafonnée à 130 % (`pricing.negotiation_ceiling_ppm`), derrière `FEATURE_NEGOTIATION_ABOVE_MAX` | conforme | `negotiation.ts:8,40-66` ; `seed:79` ; `dtest/negotiation.test.ts:40-54` | Second drapeau désactivé par défaut (`env.ts:137`) |
| Offres au client en temps réel ; il en choisit une ou annule | conforme | `realtime.service.ts:103-105` (`offers.updated`) ; `dispatch.service.ts:1117` ; `atest/dispatch.e2e.test.ts:502,575` | |
| Fin de fenêtre sans accord : attribution au prix P (mode fixe) | conforme | `dispatch.service.ts:577-579` ; `atest/dispatch.e2e.test.ts:601` | Repli automatique avec avis, au lieu d'une proposition faite au client (décision du 25/09, ligne 79) : écart mineur de parcours |
| Prix final P, P' ou contre-offre consentie ; au-dessus de P, acceptation explicite, prix maximal relevé, texte exact et horodatage dans `ride_events` | conforme | `negotiation.ts:101-112` ; `dispatch.service.ts:1129-1138` (`negotiation_above_max_accepted` avec `consentText`, `acceptedAt`) ; CHECK `rides.ts:99` ; propriété sur 1 000 tirages `dtest/negotiation.test.ts:87-88` | |
| Repli si avis juridique défavorable : surcoût exceptionnel signalé par le chauffeur, validé par l'opérateur dans la limite du prix maximal consenti | absent | aucune occurrence dans `api/` | Nécessaire seulement si l'avis est défavorable |
| Désactivée pour comptes entreprises, forfaits aéroport, lots, Neo Limo | conforme | `negotiation.ts:78-84` ; `dtest/negotiation.test.ts:58` | Toute organisation autre que Neomoov est traitée comme un compte entreprise |
| Test comparatif bêta : 50/50 des clients éligibles | conforme | `negotiation.ts:87-89` ; `dispatch.service.ts:1075-1082` ; `clients.experiment_group` (`clients.ts:20`) ; `dtest/negotiation.test.ts:66` | |
| Mesure du taux de prise en charge et du prix moyen par groupe | absent | aucune métrique par groupe (`api/admin/admin-metrics.service.ts` ne lit ni `experiment_group` ni `negotiation_mode`) | Sans cette mesure, le test comparatif ne peut pas conclure |

### 2.6 Section 5.6 : paiements

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Deux choix à la commande (D35) : prépayer ou payer le chauffeur après | conforme | `rides.ts:42,102` (`payment_choice`) ; `atest/card-payments-off.e2e.test.ts:30` ; `atest/payments.e2e.test.ts:116,286` | |
| Prépaiement par carte (par défaut), Apple Pay, Google Pay via Stripe, domaine et certificat Apple Pay | partiel | `api/payments/payments.service.ts:81-133` (SetupIntent, `payments.apple_pay_merchant_id`) ; `apps/api/src/adapters/real/stripe.ts` ; `atest/stripe-adapter.test.ts` | API prête ; Stripe réel non branché (clés absentes, décision du 26/09, ligne 120), carte fermée en production avec le simulateur (ligne 211), aucun écran d'ajout de carte dans l'application client (ligne 234). Domaine et certificat Apple Pay : rien dans le dépôt |
| Prépaiement Interac : référence générée, rapprochement automatique ou saisi par l'opérateur | absent | aucune occurrence de référence Interac dans `api/` | Décision du 26/09 (ligne 127) : « reste à faire » ; ligne 234 : Interac traité comme paiement au chauffeur, contraire au cahier et à l'amendement du prompt 07 |
| Paiement échelonné au-delà de 150 $ : adaptateur `InstallmentProvider` (`createPlan`, webhook), simulé en V1 | absent | aucun adaptateur dans `apps/api/src/adapters/` ; seuls le drapeau (`env.ts:143`) et le réglage (`seed:85`) existent | L'amendement du prompt 07 exige l'adaptateur simulé en V1 (fournisseur réel en V1.1). Table `installment_plans` absente |
| Course confirmée seulement après autorisation du prépaiement ou acceptation du plan | partiel | course immédiate : autorisation avant création (`payments.service.ts:193`, `atest/payments.e2e.test.ts:154`) | Réservation : créée et confirmée avant l'autorisation, faite à l'attribution (décision du 26/09, ligne 121) |
| Payer plus tard au chauffeur (espèces ou terminal), proposé seulement si des chauffeurs de la zone l'acceptent | conforme | `api/pricing/quotes.service.ts:259-265` ; `atest/card-payments-off.e2e.test.ts:30` ; `atest/dispatch.e2e.test.ts:448` | Une seule zone en V1 : la ville entière |
| Le chauffeur déclare ses modes ; le client ne voit que les modes compatibles (carte toujours acceptée) | conforme | `drivers.ts:29-31` ; `quotes.service.ts:259-265` ; `atest/payments.e2e.test.ts:113` | La carte n'est « toujours acceptée » que si Stripe réel est branché |
| Mode transmis avec la demande ; le chauffeur ne voit que les demandes compatibles | conforme | `api/rides/eligibility.ts:56-63` ; `atest/dispatch.e2e.test.ts:201` (isolation par le terminal, décision du 25/09, ligne 82) | |
| Lots de courses payés à la commande ou après chaque course | reporté | amendement du prompt 07 (« Lots de courses (V1.1) ») ; cahier 5.18 (V1.1) | |
| Autorisation à capture différée du prix maximal consenti + 15 %, marge plafonnée à 20 $ | conforme | `domain/payments/payments.ts:22-26` ; `seed:94-95` ; `dtest/payments.test.ts:8` ; `atest/payments.e2e.test.ts:116` | |
| Capture du montant final, jamais au-dessus de l'autorisation | conforme | `domain/payments/payments.ts:32-36` ; `dtest/payments.test.ts:19` ; `atest/payments.e2e.test.ts:116` | |
| Pourboire proposé après la course, paiement hors session sur la méthode enregistrée | conforme | `payments.service.ts:377-407` ; `atest/payments.e2e.test.ts:116` | Une fois par course, plafonné |
| Méthode enregistrée par SetupIntent au premier ajout | conforme | `payments.service.ts:81-133` ; `atest/payments.e2e.test.ts:80` | |
| Échec de capture : nouvelle tentative, ticket agent, blocage des nouvelles courses | conforme | `payments.service.ts:337-375,177` ; `atest/payments.e2e.test.ts:222` | |
| Paiement direct : montant confirmé par le chauffeur, `paid_direct`, frais et taxes inscrits au relevé, même reçu et même facture | conforme | `payments.service.ts:409-437` ; `domain/settlement/settlement.ts:137-141` ; `atest/payments.e2e.test.ts:286` ; `atest/invoicing.e2e.test.ts:110` | Écart de montant : incident |
| Versements : Stripe Connect Express ; vendredi, net positif transféré, net négatif prélevé | conforme | `api/settlement/settlement-payouts.service.ts:49-95` ; `atest/settlement.e2e.test.ts:185,203` ; `atest/payments.e2e.test.ts:379` | Testé avec le simulateur ; `drivers.require_payout_account` à `false` (`seed:121`) tant que Stripe réel manque |
| Remboursements : agent relation client jusqu'à 50 $ (approbation les 4 premières semaines), au-delà un humain, motif obligatoire, carte ou crédit au choix du client | partiel | `api/agents/agent-tools.service.ts` (plafonds `agents.max_refund_cents`) ; `payments.service.ts:439-492` ; `atest/agents.e2e.test.ts:143` ; `atest/payments.e2e.test.ts:318` | Le mode (carte ou crédit) est choisi par l'opérateur ou l'agent : aucun parcours ne laisse le client choisir |

### 2.7 Section 5.7 : packs de courses

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Activation immédiate, facturation sur le relevé du vendredi suivant | conforme | `domain/packs/packs.ts` ; `domain/settlement/settlement.ts:148-155` ; `dtest/packs.test.ts:28` ; `atest/driver-account.e2e.test.ts:178` | |
| Course terminée : une unité du pack actif le plus ancien ; annulations et non-présentations ne consomment rien | conforme | `dtest/packs.test.ts:62-78` ; `api/rides/pack-lifecycle.service.ts` ; `atest/growth-packs-promotions.e2e.test.ts:79` ; `atest/journeys.e2e.test.ts:83` | |
| Validité 28 jours (Découverte, Essentiel, Pro, Élite), 7 jours (Illimité) | conforme | `seed:50-56` ; `dtest/packs.test.ts:28,34` | |
| Report unique sur le pack suivant activé dans les 7 jours | conforme | `dtest/packs.test.ts:107-127` ; `atest/growth-packs-promotions.e2e.test.ts:130,175` | |
| Renouvellement automatique à l'épuisement (à l'expiration pour Illimité) ; changement de pack effectif à l'épuisement | conforme | `dtest/packs.test.ts:143-154` ; `atest/growth-packs-promotions.e2e.test.ts:79,175` | |
| Découverte offert aux 100 premiers chauffeurs et aux locataires R-LuxeEV, une seule fois | conforme | `dtest/packs.test.ts:46-56` ; `seed:93,155` ; `atest/growth-packs-promotions.e2e.test.ts:212` | |
| Sans pack actif ni renouvellement : aucune offre ; l'application propose d'en activer un | partiel | règle `eligibility.ts:40-43`, `presence.service.ts:118` ; `dtest/packs.test.ts:160-181` ; `atest/growth-packs-promotions.e2e.test.ts:130` | Désactivée par défaut (`drivers.require_active_pack` = `false`, `seed:115`), sans décision datée |
| Illimité : bonus de score sur les courses VIP, aéroport et entreprise | conforme | `domain/dispatch/scoring.ts:95` ; `dtest/dispatch.test.ts:59` | « VIP » = catégorie au-dessus de Neo Premium (décision du 26/09, ligne 193) |

### 2.8 Section 5.8 : règlement hebdomadaire

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Période du lundi 00 h au dimanche 23 h 59 (Montréal), génération le vendredi 6 h pour la semaine précédente | conforme | `domain/settlement/settlement.ts:190-200` ; `api/settlement/settlement-jobs.service.ts` ; `dtest/settlement.test.ts:171-188` ; `atest/settlement.e2e.test.ts:254` | |
| Net = crédits − débits | conforme | `settlement.ts:157-170` ; `dtest/settlement.test.ts:100,146-162` (200 courses recalculées) | |
| Crédits : tarifs plateforme, pourboires plateforme, compensations de promotions, primes, parrainage chauffeur, ajustements positifs | partiel | `settlement.ts:122-145` ; `api/settlement/statements.service.ts:213,351` | Aucune source de « primes » (`bonus` n'est jamais produit, seulement l'ajustement manuel). Le crédit de parrainage chauffeur réduit les packs du relevé (décision du 26/09, ligne 160) |
| Débits : packs, frais de service, redevances et leurs taxes collectés en direct, frais d'annulation dus, ajustements négatifs | partiel | `settlement.ts:137-141,148-155` | `cancellation_fee_due` sans source (décision du 26/09, ligne 162) |
| Net positif : transfert Connect le vendredi | conforme | `settlement-payouts.service.ts:59-71` ; `atest/settlement.e2e.test.ts:185,254` | |
| Net négatif : prélèvement ; échec : nouvel essai le lundi, puis suspension si solde négatif au-delà de 150 $ ou impayé plus de 7 jours | conforme | `settlement-payouts.service.ts:72-147` ; `settlement.ts:211-216` ; `dtest/settlement.test.ts:193-204` ; `atest/settlement.e2e.test.ts:203` | Au-delà de 150 $, la suspension attend le nouvel essai (décision du 26/09, ligne 163) |
| Relevé PDF par courriel et dans l'application, détail ligne par ligne | conforme | `api/settlement/statement-pdf.ts` ; `atest/settlement.e2e.test.ts:104` ; `atest/notifications.e2e.test.ts:111` ; `atest/driver-account.e2e.test.ts:281` | |
| Taxes sur les tarifs perçues par la plateforme reversées au chauffeur, rapport trimestriel | conforme | `settlement.ts:88-92,132-135` ; `api/ledgers/ledgers.service.ts:210-235` ; `dtest/settlement.test.ts:23` ; `atest/ledgers-exports.e2e.test.ts:287` | Traitement fiscal à confirmer par le comptable (décision du 22/09, lignes 8 et 20) |

### 2.9 Section 5.9 : promotions, parrainage, crédits

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Moteur de règles : première course, n-ième course, distance maximale, catégorie, zone, plage horaire, limites globale et par client, budget, évalués au devis | conforme | `domain/promotions/promotions.ts` ; `api/pricing/promotions.service.ts` ; `dtest/promotions.test.ts:25-81` ; `atest/growth-packs-promotions.e2e.test.ts:278` | |
| Conditions revalidées à la fin de course | partiel | aucune revalidation (`api/rides/rides.service.ts:773-825`) | Décision du 26/09 (ligne 133) : « pas de revalidation, prix garanti » ; elle contredit le cahier sans validation du fondateur |
| Troisième course offerte jusqu'à 10 km ; dixième course offerte | conforme | `seed:59-60` ; `dtest/promotions.test.ts:108,115,136` ; `atest/growth-packs-promotions.e2e.test.ts:235,260` | Frais aussi offerts (décision du 22/09, ligne 16) |
| Code de lancement 30 % sur trois courses pour 1 000 clients | conforme | `seed:61` ; `dtest/promotions.test.ts:119` ; `atest/growth-packs-promotions.e2e.test.ts:260` | Plafond de 15 $ par course ajouté (décision du 25/09, ligne 59) |
| Parrainage client 10 $ et 10 $ | conforme | `seed:86-87` ; `api/credits/referrals.service.ts` ; `atest/growth-credits-referral.e2e.test.ts:152` | |
| Découverte et « première semaine offerte » aux 100 premiers chauffeurs | partiel | Découverte : conforme (voir 5.7) | « Première semaine offerte » : aucune règle dans le code ni dans les données. Contenu à préciser par le fondateur |
| Parrainage chauffeur 50 $ après 50 courses du filleul | conforme | `seed:88-89` ; `atest/growth-credits-referral.e2e.test.ts:229` | Crédit de pack, jamais déduit d'une course (décision du 26/09, ligne 140) |
| Crédits : expiration 12 mois, appliqués automatiquement au total | conforme | `seed:92` ; `api/pricing/quotes.service.ts:314-319` ; `api/credits/credits.service.ts` ; `atest/growth-credits-referral.e2e.test.ts:92` | |
| Arrondi solidaire (V2) prévu dans le modèle (`credits` vers des organismes) | absent | `domain/enums.ts:103` (aucune origine ni destinataire « organisme ») | Structure V2 seulement ; rien dans le modèle |

### 2.10 Section 5.10 : chauffeur favori et préférences

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Favori possible après une course notée 4 ou plus ; liste « Mes chauffeurs » (D38) | conforme | `api/favorites/favorites.service.ts` ; `seed:148` ; `atest/growth-favorites-guarantee.e2e.test.ts:95` | |
| « Mon chauffeur favori » (+ 3 $) désigné à la demande ; priorité absolue s'il est disponible | conforme | `api/pricing/quotes.service.ts:126,148` ; `domain/dispatch/scoring.ts:93` ; exclusivité de 120 s ; `atest/growth-favorites-guarantee.e2e.test.ts:156` ; `atest/dispatch.e2e.test.ts:380` | |
| Sinon, autre favori puis chauffeur par défaut ; le client est prévenu et choisit de continuer sans supplément (D37) | partiel | `scoring.ts:94` ; décision du 25/09 (ligne 83) ; `atest/growth-favorites-guarantee.e2e.test.ts:156` | Client prévenu et supplément retiré automatiquement : il ne « choisit » pas. La disponibilité du favori au devis ne vérifie pas les conflits d'horaire (limite connue, décision du 26/09, ligne 141) |
| « Mes clients » côté chauffeur : clients qui l'ont mis en favori ou redemandé, priorité sur leurs courses, sans coordonnées complètes | partiel | `api/drivers/driver-activity.service.ts:339-360` ; `atest/driver-account.e2e.test.ts:205` | Liste conforme (prénom seulement). La priorité ne vaut que pour les clients qui ont mis le chauffeur en favori ; un client qui l'a simplement redemandé (`rides_count`) n'apporte aucun bonus au score |
| Sélection précise du véhicule : véhicules disponibles sur le créneau (modèle, couleur, année, photo, chauffeur, note), garantie modèle appliquée | partiel | `GET /v1/quotes/{id}/vehicles` (décision du 25/09, ligne 85) ; `api/rides/eligibility.ts` ; `atest/dispatch.e2e.test.ts:448` | Disponibilités déclarées par les chauffeurs non gérées (filtre « accepte les réservations et libre à ± 90 min ») ; `photoUrl` vide |
| Préférences : ambiance, musique et genre, température, langue du chauffeur, bagages (nombre, taille), siège enfant, accessibilité, demandes spéciales ; dans le profil, modifiables à chaque réservation | conforme | `domain/schemas/quotes.ts:24-36` ; `api/client/client-profile.service.ts` ; `rides.ts:37-38` ; `atest/client-profile.e2e.test.ts:34` | Les demandes spéciales sont saisies par course (`rides.special_requests`), pas gardées au profil |
| Transmises au chauffeur avec la demande et affichées sur sa fiche de course | conforme | `api/rides/dispatch.service.ts:946` (offre) ; `api/drivers/driver-activity.service.ts:474` (fiche) ; `atest/driver-account.e2e.test.ts:205` | |
| Commodités incluses rappelées à la confirmation avec le message D45 | conforme | `apps/mobile-client/src/i18n.ts:109` ; `apps/mobile-client/test/i18n.test.ts:30` ; `apps/mobile-client/maestro/reserver.yaml:35` | Texte de l'écran seulement (partie 6.x pour le reste) |

### 2.11 Section 5.11 : évaluations, incidents et sanctions graduées

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Évaluation après chaque course, des deux côtés, avec étiquettes | conforme | `api/rides/rides.service.ts:916-923` (client) ; `api/drivers/driver-activity.service.ts` (chauffeur) ; `domain/enums.ts:155` ; `rides.ts:185-194` ; `atest/rides.e2e.test.ts:41` ; `atest/driver-account.e2e.test.ts:205` | |
| Note minimale de 4,60 sur les 50 dernières courses | conforme | `domain/drivers/quality.ts:56-67` ; `api/agents/quality.agent.ts` ; `dtest/quality.test.ts` ; `atest/quality.e2e.test.ts:67` | Jugée à partir de 10 notes (`seed:173`) : ajout raisonnable, non prévu au cahier |
| Sanctions proposées par l'agent qualité, validées en mode approbation les quatre premières semaines | conforme | `quality.agent.ts` ; agent `quality` en `approval` (`seed:249`) ; `atest/quality.e2e.test.ts:67,139` | Agent déterministe, sans appel au modèle (décision du 26/09, ligne 192) |
| Avertissement sous 4,60 ; restriction sous 4,40 ou 3 annulations tardives en 7 jours ; suspension proposée sous 4,20, après 3 incidents graves ou une plainte de sécurité | conforme | `quality.ts:56-67` ; `seed:173-174` ; `dtest/quality.test.ts` ; `atest/quality.e2e.test.ts:67` | La plainte de sécurité suit le blocage préventif (ligne suivante) |
| Restriction = retrait des courses VIP et aéroport | partiel | `api/rides/eligibility.ts:47-49` ; décision du 26/09 (ligne 193) | Code présent ; aucun test ne vérifie qu'un chauffeur restreint est écarté d'une course aéroport ou haut de gamme (`quality.e2e.test.ts:112,134` ne contrôle que le statut) |
| Suspension définitive toujours humaine | conforme | `quality.ts:5-6` (jamais proposée) ; `seed:249` ; `api/admin/admin-directory.service.ts:115` | |
| Incident de sécurité (SOS, plainte) : blocage immédiat du chauffeur en attente d'une décision humaine | conforme | `domain/drivers/safety.ts:15-19` ; `api/rides/safety-hold.service.ts` ; `dtest/safety.test.ts` ; `atest/safety-hold.e2e.test.ts:38,85` ; `atest/agents.e2e.test.ts:314` | Exception assumée : le SOS du chauffeur lui-même ne le bloque pas (décision du 26/09, ligne 190) ; la course en cours n'est pas interrompue |

### 2.12 Section 5.12 : documents et conformité des chauffeurs et véhicules

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Types et échéances : permis, formation, antécédents (renouvellement selon la loi), assurance, immatriculation, vérification mécanique, TPS et TVQ, photo, inspection trimestrielle | partiel | types `domain/enums.ts:66` ; échéances `api/compliance/compliance.service.ts:113-131` ; `atest/compliance.e2e.test.ts:31,72` | Les échéances suivies ne portent que sur `drivers.required_documents` (permis, assurance, immatriculation par défaut, `seed:114`), plus la vérification mécanique et l'inspection. Le renouvellement de la vérification des antécédents n'est pas suivi |
| Vérification mécanique : à 4 ans ou 80 000 km, puis annuelle ou 60 000 km | partiel | `domain/drivers/compliance.ts:44-53` ; `dtest/compliance.test.ts` ; `atest/compliance.e2e.test.ts:72` | La règle des 60 000 km n'est pas appliquée : le kilométrage à la dernière vérification n'est pas enregistré (limite connue, décision du 26/09, ligne 186) |
| Inspection Neomoov trimestrielle | conforme | `compliance.service.ts:227-243` ; `atest/compliance.e2e.test.ts:72` | |
| Rappels automatiques à J-30, J-7 et J-1 | conforme | `compliance.ts:74-82` ; `dtest/compliance.test.ts` ; `atest/compliance.e2e.test.ts:31` | |
| À l'échéance : suspension automatique jusqu'au dépôt du nouveau document | conforme | `compliance.service.ts:175-220` ; `atest/compliance.e2e.test.ts:31` | Suspension le lendemain de l'échéance (document valide toute la journée J). Défaut probable : la levée (`compliance.service.ts:215`) repasse le chauffeur à `active` même s'il était `restricted` avant la suspension (`:183`), ce qui efface une restriction de qualité encore en cours ; aucun test ne couvre ce cas |
| Vérification par l'agent recrutement (dates, cohérence des noms), puis validation humaine en V1 | conforme | `api/agents/back-office.agents.ts` ; `api/agents/agent-tools.service.ts` (mode `auto` refusé, décision du 26/09, ligne 172) ; `atest/agents.e2e.test.ts:469` | |
| Entretien par appel avec un agent IA (D39) et sortie `interview_results` | reporté | cahier 5.12 (« V1.1 ») ; amendement du prompt 13 (« V1.1 ») | Table absente (voir 1.11) |
| Critères `recruitment_criteria`, score et recommandation (jamais une décision) | absent | aucune table ni code | L'amendement du prompt 12 met « critères et score » dans le module Recrutement de la V1 ; seul le résultat d'entretien est V1.1 |

### 2.13 Section 5.13 : facturation certifiée, redevance et taxes

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Facture générée immédiatement à chaque course terminée | partiel | `api/invoicing/invoice-jobs.service.ts` (file `invoicing` sur `ride.completed`) ; reprise `api/invoicing/invoicing.service.ts:452-460` ; `atest/invoicing.e2e.test.ts:110` | Émission asynchrone par file, avec rattrapage périodique : pas immédiate au sens strict |
| Numérotation séquentielle par fournisseur, sans trou | conforme | `drizzle/0001_postgis-triggers-partitions.sql:52-66` ; `billing.ts:45` ; `atest/invoicing.e2e.test.ts:204` (100 courses en parallèle) | |
| Contenu : identité et numéros du chauffeur, identité et numéros de Neomoov, trajet, distance, durée, tarif, suppléments, frais, redevance, TPS, TVQ, pourboire, total, mode de paiement, transaction SEV, QR, mention légale | partiel | `domain/schemas/invoicing.ts:31-117` ; `domain/invoicing/invoice.ts` ; `dtest/invoicing.test.ts` ; `atest/invoicing.e2e.test.ts:110,186` | Structure complète, mais données de Neomoov incomplètes : raison sociale « Neomoov » au lieu de la dénomination légale (D25, décision du 22/09, ligne 9), numéros de TPS et TVQ vides (`seed:161-164`) ; contenu « à confirmer avec le fournisseur du SEV et le comptable » (`seed:165`) |
| Envoi par courriel, disponible dans l'application | conforme | gabarit `invoice.issued` (`domain/notifications/matrix.ts:34`) ; `api/invoicing/invoicing.controller.ts` ; `atest/invoicing.e2e.test.ts:110` | Pas de liste des factures d'un client (décision du 26/09, ligne 232) |
| `SevProvider` : transmission de chaque facture, annulation et crédit, asynchrone avec reprises, état visible dans My Hub | conforme | `api/invoicing/sev.service.ts` ; `apps/api/src/adapters/types.ts:217-227` ; `atest/invoicing.e2e.test.ts:248,280,308` | |
| Implémentation simulée : journalise et renvoie un identifiant fictif | conforme | `MockSevProvider` (`apps/api/src/adapters/mock/index.ts`) ; `atest/invoicing.e2e.test.ts:110` | L'adaptateur réel n'est pas livré (`apps/api/src/adapters/real/index.ts:64-69` rejette tout) : fournisseur certifié à choisir |
| En mode réel, aucune course clôturée sans facture générée | absent | aucune garde : `rides.service.ts:773-825` termine la course avant toute facture | À imposer avant de brancher un SEV réel |
| Registres de la redevance (0,90 $) et des taxes ; exports mensuels et trimestriels CSV et rapport | conforme | `api/ledgers/ledger-jobs.service.ts` ; `api/ledgers/ledger-exports.service.ts` ; `atest/ledgers-exports.e2e.test.ts:120-263` ; `atest/ledgers-units.test.ts:9-64` | Redevance due même sur une course offerte, à confirmer par le comptable (décision du 26/09, ligne 145) |
| Export mensuel de géolocalisation pour le ministère, archivé et daté | conforme | `api/ledgers/geolocation-export.service.ts` ; `atest/ledgers-exports.e2e.test.ts:319` ; `atest/ledgers-units.test.ts:24-52` | Format provisoire `csv-v0`, à confirmer avec la CTQ (décision du 26/09, ligne 148) |

### 2.14 Section 5.14 : notifications

Matrice en données : `domain/notifications/matrix.ts:23-92` ; envoi `api/notifications/notification-delivery.service.ts` ; gabarits FR et EN `api/notifications/templates.ts`. Tests : `dtest/notifications.test.ts`, `atest/notifications.e2e.test.ts:42` (chaque ligne de la matrice, chaque canal).

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Course demandée : client push et écran ; chauffeur push et écran (offre) ; opérateur tableau de bord | conforme | `matrix.ts:25-26` ; `rides.service.ts:430-433` ; `api/rides/dispatch.service.ts:900` ; `api/rides/realtime.service.ts` ; `atest/realtime.e2e.test.ts:80` | |
| Chauffeur attribué : client push, texto si pas d'application (tiers) ; chauffeur écran | conforme | `matrix.ts:27-28` (critique, repli texto) ; `rides.service.ts:199-204,549-557` ; `atest/rides.e2e.test.ts:217` ; `atest/notifications.e2e.test.ts:77` | |
| Chauffeur en approche (2 minutes) et arrivé : push, texto pour tiers | partiel | `api/rides/approach-notifier.service.ts:80` (700 m) ; `rides.service.ts:722` ; `atest/messaging.e2e.test.ts:94` | Le passager tiers d'un client avec compte ne reçoit ni l'approche ni l'arrivée par texto (seulement le lien de suivi à l'attribution). 700 m approche les 2 minutes |
| Course terminée : client push et courriel (reçu, facture) ; chauffeur écran (résumé, pourboire) | conforme | `matrix.ts:32-34` ; `rides.service.ts:819-822` | |
| Annulation, non-présentation : client push, chauffeur push, opérateur alerte si répétée | partiel | `rides.service.ts:631,655,767` | Aucune alerte à l'exploitation pour des annulations ou non-présentations répétées |
| Réservation planifiée : client push, courriel, texto (confirmation, rappel J-1, attribution, départ) ; chauffeur push (offre, rappel 90 minutes avant) ; opérateur alerte si non confirmée à 30 minutes | partiel | `matrix.ts:49-51,87` ; `api/rides/scheduled.service.ts:75-99` ; `atest/scheduled.e2e.test.ts:25` | Attribution et départ partent en push seulement (`matrix.ts:27,29`). **Rappel au chauffeur 90 minutes avant : absent** (aucun gabarit) |
| Relevé émis, versement effectué, prélèvement échoué : chauffeur push et courriel ; opérateur alerte si échec | partiel | `api/settlement/statements.service.ts:323` ; `api/settlement/settlement-payouts.service.ts:91` | Gabarits `statement.paid` et `alert.settlement_failed` présents (`templates.ts:163,263`) mais **jamais mis en file** : ni avis de versement au chauffeur, ni alerte à l'exploitation |
| Document expirant (J-30, J-7, J-1), suspension : chauffeur push, courriel, texto ; opérateur tableau | conforme | `matrix.ts:67-70` ; `api/compliance/compliance.service.ts:97,188` ; `atest/compliance.e2e.test.ts:31` | |
| Pack presque épuisé (3), renouvelé, expiré : chauffeur push | conforme | `matrix.ts:77-81` ; `api/rides/pack-lifecycle.service.ts:161-285` ; `atest/growth-packs-promotions.e2e.test.ts:79` | |
| Incident, SOS : alerte immédiate au fondateur (push, texto, appel) | conforme | `matrix.ts:84` ; `rides.service.ts:1024` ; `api/voice/sos-call.service.ts` ; `atest/voice.e2e.test.ts:104` ; `atest/safety-hold.e2e.test.ts:38` | Push remplacé par courriel pour le personnel (décision du 26/09, ligne 210) |
| Message dans la course : client et chauffeur push | conforme | `matrix.ts:53` ; `rides.service.ts:994-1002` ; `atest/messaging.e2e.test.ts:37` | |
| Canaux : push par défaut, texto (secours, tiers), courriel (documents), WhatsApp si réservé par WhatsApp, écran | partiel | `matrix.ts:104-113` | La substitution WhatsApp n'est jamais activée : aucun appel de l'API ne passe `viaWhatsApp` (aucune occurrence dans `apps/api/src`) |
| Toutes les notifications journalisées dans `notifications`, préférences et désabonnement pour le marketing | partiel | outbox `api/rides/notifications-outbox.ts` ; consentement marketing (décision du 26/09, ligne 179) | Aucun lien de désabonnement ni préférence de canal ; aucune communication marketing en V1 |

### 2.15 Section 5.15 : Loi 25 dans le code

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Consentements distincts et horodatés par finalité | conforme | `identity.ts:82-90` ; `api/me/me.service.ts` ; `atest/me.e2e.test.ts:68` | |
| Géolocalisation en arrière-plan expliquée avant la demande de permission | conforme | écran `apps/mobile-driver/src/app/location-permission.tsx:38` ; `apps/mobile-driver/src/lib/location.ts:104-109` | Preuve directe par l'écran ; aucun test automatisé |
| Retrait possible à tout moment, conséquence expliquée (plus de courses) | conforme | `api/rides/presence.service.ts:113-117` ; `atest/driver-account.e2e.test.ts:159` ; `atest/me.e2e.test.ts:68` | |
| Politique de confidentialité versionnée ; nouvelle version = nouvelle acceptation | conforme | `seed:238` ; décision du 25/09 (ligne 53) ; `atest/auth.e2e.test.ts:43` | |
| Droits : accès (JSON et PDF), rectification, suppression (anonymisation des courses, effacement du reste), portabilité, retrait ; délai suivi dans `data_requests` | conforme | `api/privacy/privacy-jobs.service.ts` ; `api/privacy/privacy-export.ts` ; `api/me/me.controller.ts` ; `atest/me.e2e.test.ts:23,90,127` | La suppression n'annule pas les réservations à venir (décision du 26/09, ligne 233) |
| Rétention : positions 90 jours, trajets anonymisés à 12 mois, documents 12 mois après la fin de la relation, audit et factures 7 ans ; purges dans `retention_jobs` | conforme | `api/retention/retention.service.ts:51-161` ; `seed:190-194` ; `atest/retention.e2e.test.ts:28,37` | Purges suspendues sans sauvegarde vérifiée de moins de 26 heures (décision du 26/09, ligne 187) : à surveiller, sinon rien n'est jamais purgé |
| Registre des incidents de confidentialité dans My Hub, avec modèle de notification | conforme | `domain/privacy/breach.ts` ; `api/admin/admin-incidents.service.ts` ; `dtest/privacy-breach.test.ts` ; `atest/privacy-incidents.e2e.test.ts:36-97` | |
| Données biométriques (V1.1) : module isolé, activé après déclaration à la CAI, gabarits chiffrés jamais exportés | reporté | cahier 5.15 (« V1.1 ») ; drapeau `FEATURE_FACE_CHECK` (`env.ts:138`) ; `atest/driver-account.e2e.test.ts:304` | Aucun gabarit stocké en V1 (décision du 26/09, ligne 191) |

### 2.16 Section 5.16 : agents IA

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| SDK officiel `@anthropic-ai/sdk`, modèle `claude-opus-5` par défaut | conforme | `apps/api/src/adapters/real/anthropic.ts:9` ; `agents.ts:15` | Défaut passé à `claude-opus-5-5` (décision du 26/09, ligne 167), retour possible par agent |
| Raisonnement adaptatif, effort par agent (`output_config.effort`) | conforme | `anthropic.ts:75-103` ; `seed:245-249` ; `atest/anthropic-llm.test.ts:40` | |
| Sorties structurées (`messages.parse`, format Zod) pour toute décision ; boucle d'outils (`betaZodTool`, `toolRunner`) | conforme | `anthropic.ts:90,102-103` ; `atest/anthropic-llm.test.ts:40,82` | Variantes bêta pour permettre le repli (décision du 26/09, ligne 168) |
| Cache du prompt système ; repli côté serveur ; erreurs typées ; jetons et coût journalisés ; minimisation | conforme | `anthropic.ts:81-83` ; `api/agents/agent-runner.service.ts` ; `atest/anthropic-llm.test.ts:40,66,102` ; `atest/agents.e2e.test.ts:356` ; `dtest/agents.test.ts` | Plafond quotidien de 20 $ en plus |
| Modes `auto`, `approval`, `manual` ; chaque agent démarre en `approval`, passe en `auto` après quatre semaines sur décision du fondateur | partiel | `agents.ts:13,22` ; `api/agents/agents.controller.ts` ; `atest/agents.e2e.test.ts:356` | L'agent d'analyse est semé en `auto` (`seed:248`) : défendable (lecture seule, aucun seuil), mais contraire à la règle |
| Relation client : outils `lookupRide`, `lookupClient`, `issueCredit` (≤ 50 $), `refund` (≤ 50 $), `openIncident`, `escalateToHuman`, `sendMessage` ; approbation au-delà de 50 $, plainte de sécurité, ton hostile | conforme | `seed:245` ; `api/agents/customer-relations.agent.ts` ; `api/agents/agent-tools.service.ts` ; `atest/agents.e2e.test.ts:143,256,314,336` | `sendMessage` non présenté au modèle pour éviter un double envoi (décision du 26/09, ligne 170) |
| Recrutement : `extractDocumentFields` (vision), `compareIdentity`, `proposeDecision` ; validation finale humaine | conforme | `seed:246` ; `api/agents/back-office.agents.ts` ; `atest/agents.e2e.test.ts:469` | |
| Comptabilité : `listStatementLines`, `flagAnomaly` au relevé généré ; tout écart non expliqué approuvé | conforme | `seed:247` ; `back-office.agents.ts:90` ; `atest/agents.e2e.test.ts:504` | |
| Analyse et rapports : quotidien 7 h, hebdomadaire lundi, `queryMetrics`, rapport en français au fondateur (courriel et My Hub) | conforme | `seed:214-216,248` ; `api/agents/agent-jobs.service.ts` ; `atest/agents.e2e.test.ts:523` | |
| Centre d'appels vocal (Vapi) : `quote`, `createRide`, `rideStatus`, `cancelRide`, `transferToHuman` | conforme | `api/voice/voice.service.ts` ; `api/voice/voice.controller.ts` ; `atest/voice.e2e.test.ts:47,82` | Aucun compte créé sans consentement (décision du 26/09, ligne 182) |
| Autres agents (publicité, contenu, diffusion, prospection, répartition prédictive, qualité, conformité, investisseurs) | reporté | cahier 5.16 (« livrés en V1.1 ») | L'agent qualité est déjà livré, en règles déterministes (décision du 26/09, ligne 192) |
| Sécurité : outils déclarés seulement, droits et plafonds vérifiés, données minimisées, contenus des utilisateurs traités comme des données, tout appel journalisé | conforme | `api/agents/agent-tools.service.ts` ; décision du 26/09 (ligne 173) ; `atest/agents.e2e.test.ts:419` ; `dtest/agents.test.ts` (`redactSensitive`) | |

---

## 3. Écarts, triés par gravité

Efforts en heures de développement, tests compris, hors délais de décision du fondateur ou du comptable. Contexte de la bêta : toutes les courses sont des réservations à au moins 2 heures (D32), payées au chauffeur (carte fermée tant que Stripe réel manque, décision du 26/09, ligne 211), SEV simulé.

### 3.1 Bloquant pour la bêta

1. **Une course en cours ne peut pas être close autrement que « terminée »** (5.2). L'événement `incident` (vers `interrupted`) et `client_disputes` (vers `disputed`) ne sont déclenchés nulle part ; l'opérateur ne peut pas annuler une course `in_progress`. Un accident, un téléphone de chauffeur éteint ou une course figée (simple alerte, décision du 26/09, ligne 195) laisse la course ouverte ou oblige à la « terminer », donc à la facturer. Ajouter une transition opérateur `incident` (et la contestation). Effort : 4 h.
2. **Réservations (100 % des courses de la V1) : jalons de confirmation incomplets** (5.3, 5.14). Aucune échéance « attribution confirmée au plus tard 90 minutes avant », aucune alerte à 60 minutes (seulement à 30), **aucun rappel au chauffeur 90 minutes avant**. Risque direct de chauffeur absent. Trancher la contradiction interne du cahier (60 ou 30 minutes) puis coder le jalon et le rappel. Effort : 5 h.
3. **Frais d'annulation et de non-présentation facturés mais jamais encaissés** (5.2, 5.3). En bêta toutes les courses sont payées au chauffeur : les frais ne sont pas perçus (décision du 26/09, ligne 122), le chauffeur n'en reçoit rien, mais une facture de frais est quand même émise au client (ligne 152). Décider : ne pas facturer ce qui n'est pas perçu, ou exiger un moyen de secours. Effort : 3 h (option la plus simple).
4. **Option Priorité semée à × 1,15 au lieu de × 1,25** (`packages/db/src/seed/data.ts:71` contre cahier 5.1). Prix affiché au client différent de la spécification, sans décision. Trancher, puis aligner données ou cahier et ajouter un test sur la valeur semée. Effort : 0,5 h.
5. **Factures : raison sociale « Neomoov » et numéros de TPS et TVQ de Neomoov vides** (5.13, `seed:161-164`). Des taxes sont perçues sur des factures sans numéro d'inscription du fournisseur des frais de service. Renseigner la dénomination légale (D25) et les numéros dans les réglages, faire valider par le comptable. Effort : 0,5 h (données fournies par le fondateur).

### 3.2 À corriger avant le lancement commercial

6. **Prépaiement Interac absent** (5.6, amendement du prompt 07) ; Interac requalifié en paiement au chauffeur (décision du 26/09, ligne 234) sans validation. Effort : 8 h.
7. **Exigence d'un pack actif désactivée par défaut** (5.4, 5.7 ; `drivers.require_active_pack` = `false`, `seed:115`). Sans décision datée, un chauffeur sans pack reçoit des offres : le modèle de revenus des packs ne s'applique pas. Décision à prendre dès la bêta. Effort : 0,25 h.
8. **Réservation par carte autorisée à l'attribution et non à la réservation ; course confirmée avant l'autorisation** (5.3, 5.6 ; décision du 26/09, ligne 121). Écart technique justifié (validité de 7 jours d'une autorisation Stripe) mais contraire au cahier : faire amender le cahier ou prévoir un contrôle de carte bloquant à la réservation. Effort : 2 h plus décision.
9. **« Aucune course clôturée sans facture » non garanti en mode réel ; facture émise en différé** (5.13). À imposer avant de brancher un SEV certifié. Effort : 4 h.
10. **Intégrité référentielle incomplète** (section 4) : clés étrangères absentes sur `favorite_drivers.driver_id`, `client_driver_links.driver_id`, `quotes.client_id`, `rides.promotion_id`, `statement_lines.ride_id` et `pack_purchase_id`, `pack_purchases.statement_id`, `invoices.credit_note_of_id`, les cinq `organization_id`. Migration, contrôle préalable des orphelins. Effort : 4 h.
11. **Conformité incomplète** (5.12) : renouvellement de la vérification des antécédents non suivi, règle des 60 000 km inapplicable (kilométrage à la vérification non enregistré). Effort : 4 h.
12. **Restriction de qualité fragile** (5.11, 5.12) : aucun test de l'exclusion des courses aéroport et haut de gamme ; la levée d'une suspension de conformité repasse un chauffeur restreint à `active` (`compliance.service.ts:215`). Effort : 2 h.
13. **Table `feature_flags` jamais lue** (4.9) : deux sources de vérité pour les drapeaux (table et environnement), le pourcentage et le ciblage sont inopérants. Brancher la table ou la supprimer et documenter. Effort : 3 h.
14. **Notifications manquantes** (5.14) : `statement.paid` et `alert.settlement_failed` jamais mis en file, aucune alerte d'annulations répétées, attribution et départ d'une réservation en push seulement (cahier : push, courriel, texto). Effort : 3 h.
15. **Critères de recrutement et score absents** (`recruitment_criteria`, amendement du prompt 12 : V1). Effort : 6 h.
16. **Alerte quotidienne `benchmark_exceeded` absente** (5.1, D33) : l'événement est journalisé mais personne n'est prévenu. Effort : 2 h.
17. **Numéro de vol sans rappel ni liste pour l'opérateur** (5.3). Les forfaits aéroport sont au cœur de l'offre. Effort : 2 h.
18. **Décisions du journal qui contredisent le cahier, à faire valider** : pas de revalidation des promotions en fin de course (ligne 133), sanction de garantie modèle seulement proposée (ligne 142), repli automatique de la négociation (ligne 79), analyse en mode `auto`. Effort : 1 h de mise à jour du cahier une fois tranché, 2 h par règle à recoder si refusé.
19. **« Première semaine offerte aux 100 premiers chauffeurs »** (5.9) : aucune règle ; contenu à définir. Effort : 3 h après définition.
20. **Tables des amendements v1.1 absentes** alors que l'amendement du prompt 02 les exige dès le schéma : `ride_series`, `installment_plans`, `interview_results`, `recruitment_criteria`, `recording_consents`, `recordings` (reports de la décision du 25/09, ligne 63, jamais tenus). Effort : 4 h pour les structures seules.

### 3.3 V1.1

21. Adaptateur simulé `InstallmentProvider` (`createPlan`, webhook), demandé en V1 par l'amendement du prompt 07, fonction derrière `FEATURE_INSTALLMENTS`. Effort : 8 h.
22. Négociation : mesure du taux de prise en charge et du prix moyen par groupe du test comparatif ; repli « surcoût exceptionnel validé par l'opérateur » si l'avis juridique est défavorable. Effort : 4 h plus 6 h.
23. Modèle de données : `tenant_id` (ou décision de le remplacer par `organization_id`), UUID v7, `updated_at` et `deleted_at` généralisés, `city_code` sur les tables métier avant une deuxième ville, type `neomoov` des organisations. Effort : 8 h.
24. Répartition : tolérance de 15 minutes de l'Offre Flex, déséquilibre de zone (toujours 0), test de l'enchaînement, préavis `rides.immediate_min_lead_seconds` quand les courses immédiates seront ouvertes. Effort : 12 h.
25. Favoris et véhicule : priorité pour les clients qui redemandent un chauffeur sans favori, disponibilités déclarées et photos des véhicules, vérification des conflits d'horaire du favori au devis. Effort : 10 h.
26. Notifications : substitution WhatsApp jamais activée, texto d'approche et d'arrivée au passager tiers d'un client avec compte, désabonnement marketing. Effort : 6 h.
27. Règlement : source des primes (`bonus`), choix du mode de remboursement par le client, arrondi solidaire (V2, structure), états `quoted` et `expired` inutilisés à retirer ou à brancher. Effort : 7 h.

---
