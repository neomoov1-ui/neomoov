# Redevance Neomoov des chauffeurs et priorité des packs (3 octobre 2026)

Agent P, branche `redevance-chauffeurs` (depuis `main` local `205124c`). Décisions du fondateur du 3 octobre 2026 :
tous les chauffeurs (Pilote et flotte compris) versent une redevance Neomoov de 5 à 10 % (10 % par défaut), réglée
chauffeur par chauffeur dans My Hub ; un chauffeur sans pack reçoit des courses, mais après ceux qui en ont un.

Vocabulaire : « redevance » désignait déjà la **redevance gouvernementale** par course (`regulatory_fee_cents`,
`redevance_ledger`, exports pour Revenu Québec). Elle n'est pas touchée. La nouvelle notion est la **redevance Neomoov**
(frais de plateforme), nommée `platform_fee` / `platformFee` dans le code et « Redevance Neomoov » dans les textes.

## 1. Comment l'argent circulait avant (constat dans le code)

Une course a un **tarif du chauffeur** (`fare_cents` : ce qui lui revient, avant toute promotion), des **frais de service**
de Neomoov (`service_fee_cents`), la **redevance gouvernementale** (`regulatory_fee_cents`), les péages, la TPS et la TVQ.
Rien n'est versé course par course : tout passe par le **relevé hebdomadaire** (lundi au dimanche, généré et émis le
vendredi), moteur `packages/domain/src/settlement/settlement.ts`, service `apps/api/src/modules/settlement/statements.service.ts`.

**Course payée par carte (Stripe, ou Square depuis l'étape 26).** Le client est débité du total (empreinte puis capture)
sur le compte de Neomoov. Au relevé, le chauffeur est **crédité** du tarif payé par le client, des taxes sur son tarif
complet (D26 : il les remet lui-même), des péages, du pourboire et de la compensation de promotion (100 %). Neomoov garde
les frais de service, la redevance gouvernementale (remise à l'État, registre `redevance_ledger`) et les taxes sur ces
frais. Net positif : versement par Stripe Connect, ou virement hors plateforme avec Square.

**Course payée directement au chauffeur (espèces, Interac, terminal).** Le chauffeur encaisse tout le total. Au relevé,
il est **débité** des frais de service, de la redevance gouvernementale et des taxes sur ces frais (perçus pour Neomoov),
crédité d'un éventuel pourboire par l'application et de la compensation de promotion. Net négatif : prélèvement sur sa
carte de prélèvement ; un échec ouvre l'impayé (`driver_balances.unpaid_since`) ; suspension automatique au-delà de
150 $ de dette ou après 7 jours d'impayé (`evaluateSuspension`).

**Autres sommes du relevé.** Packs de courses : facturés au relevé suivant leur activation (jamais d'avance), avec
taxes ; crédit de parrainage de pack. Flotte (étape 23) : part de l'organisation (`fleet_share`, loyer par semaine ou
pourcentage du tarif) débitée au chauffeur, reversée à l'organisation par son relevé d'organisation. Pilote : aucun
abonnement facturé au chauffeur n'existe dans le code à ce jour (la rentabilité Pilote compte les packs comme coût).

**Packs et répartition.** La revue du 2 octobre le disait : `drivers.require_active_pack` vaut `false`, donc un chauffeur
sans pack reçoit des offres comme les autres et ne verse rien à Neomoov (ni pack ni commission). Le seul effet du pack à
la répartition était le petit bonus « Illimité » (5 points) sur les courses VIP, aéroport ou entreprise. Le commentaire
de `scoring.ts` sur le pack décrivait le filtre facultatif, pas une priorité.

## 2. Comment l'argent circule après

Une seule ligne de plus au relevé, un **débit** « Redevance Neomoov (x %) » par course terminée :

| Course | Ce qui change |
|---|---|
| Payée par carte | La redevance est **retenue sur le versement** du vendredi (le net baisse d'autant). |
| Payée au chauffeur | La redevance s'**ajoute à ce qu'il doit** (avec les frais de service et la redevance gouvernementale perçus en direct) : même prélèvement du relevé négatif, même impayé, même suspension pour dette. |
| Annulée ou absence (frais payants) | Aucune redevance (seules les courses terminées). |
| Garantie modèle validée, chauffeur en faute (tarif repris) | Redevance **remise** par un ajustement lié à la course, aussi si le relevé était déjà émis. |
| Chauffeur de flotte | Redevance Neomoov en plus de la part de l'organisation (`fleet_share`), toutes deux sur le relevé du chauffeur. |
| Chauffeur Pilote | Même redevance ; elle apparaît aussi dans ses coûts (rentabilité nette). |

Exemple (tarif 24,55 $, taux 10 %) : redevance 2,46 $ (245,5 ¢ arrondi au cent supérieur). Par carte : le chauffeur
reçoit 24,55 + 3,68 (taxes du tarif) − 2,46 = 25,77 $. Payée en espèces : il doit 2,00 + 0,90 + 0,43 + 2,46 = 5,79 $.

## 3. Ce qui a été fait

**Domaine** (`packages/domain`, couverture 100 %, 586 tests) :
- `settlement/platform-fee.ts` : bornes (500 à 1000 points de base, 1000 par défaut), `isValidPlatformFeeBps`,
  `platformFeeBpsOrDefault` (réglage hors bornes ignoré), `computePlatformFee` (assiette = tarif du chauffeur, arrondi au
  cent, erreur sur un taux hors bornes ou un tarif invalide), libellé français du taux (« 7,5 % »).
- `settlement.ts` : nature de débit `platform_fee`, champ `platformFee` (montant et taux figés) sur `SettlementRide`,
  ligne ajoutée par `classifyRideForStatement` pour une course terminée, carte ou paiement direct.
- `dispatch/scoring.ts` : `hasActivePack` sur le candidat, `packPriorityTier` (le favori demandé par le client garde sa
  place, D37), `splitByPackPriority`, tri « avec pack d'abord » dans `scoreCandidates` (score inchangé dans chaque groupe).
- `pilot/profitability.ts` : `platformFeesCents` dans les coûts.
- Schémas : taux sur la fiche chauffeur (`adminDriverDetailSchema`), `driverPlatformFeeSchema`, résumé des finances
  (`platformFeeSummarySchema`), revenus du chauffeur (`platformFeeCents`, `platformFeeBps` par course ;
  `totals.platformFeeCents`, `totals.netCents`), rentabilité Pilote.

**Base** (migration `0036_platform-fee`, rejouable, inverse dans `drizzle/down/`, appliquée sur la base de développement) :
- `drivers.platform_fee_bps` entier, défaut 1000, `CHECK BETWEEN 500 AND 1000`.
- Table `platform_fees` : une ligne par course (`UNIQUE ride_id`), chauffeur, assiette, taux (`CHECK 500..1000`),
  montant, canal (`platform` ou `direct`). Invariant d'argent porté par la base :
  `amount_cents = (base_cents × rate_bps + 5000) / 10000`. Isolation : droits du rôle restreint, sécurité au niveau des
  lignes, politique « par course » comme `redevance_ledger` et `tax_ledger`.
- Réglages : `drivers.platform_fee_default_bps` (1000) et `dispatch.pack_priority_seconds` (120), dans la migration et
  dans les seeds.
- Choix de la table dédiée plutôt que le grand livre des relevés : les lignes de relevé sont recalculées tant que le
  relevé est un brouillon ; la redevance doit garder le taux de la fin de course et exister une seule fois par course.

**API** :
- Fin de course (`RidesService.complete`) : la redevance est écrite **dans la transaction de la transition** (taux du
  chauffeur à ce moment, `ON CONFLICT DO NOTHING` par course) ; une fin de course rejouée n'écrit rien de plus.
- Relevés : jointure `platform_fees`, ligne `platform_fee` ; garantie modèle validée : `adjustment_positive` lié à la
  course (élément tardif ajouté à `LATE_KINDS`).
- My Hub : `PUT /v1/admin/drivers/{id}/platform-fee` (`statements.manage`, finances et administration, double
  authentification ; 400 hors bornes ou non entier ; audit `admin.driver_platform_fee` avec ancien et nouveau taux) ;
  `platformFeeBps` sur `GET /v1/admin/drivers/{id}` ; `GET /v1/admin/platform-fees?from&to` (`statements.read`) : total
  d'une période (jour local de fin de course), par canal et par taux.
- Nouveaux chauffeurs : candidature (`POST /v1/driver/apply`) et invitation de flotte prennent le réglage global.
- Revenus du chauffeur (`GET /v1/driver/earnings`, et l'accueil) et rentabilité Pilote : redevance par course et totaux.
- Répartition : colonne `has_active_pack` (même règle que `canReceiveOffers` : pack utilisable ou renouvellement
  automatique en attente, fragment `hasUsablePack` partagé avec le filtre) dans les trois requêtes de candidats.
  Immédiate : offres séquentielles dans l'ordre « avec pack d'abord » (et la limite de 60 candidats ne coupe jamais un
  chauffeur avec pack). Planifiée : chauffeurs avec pack seuls pendant `dispatch.pack_priority_seconds`, puis les autres
  jusqu'à la fin de la fenêtre, les premières offres restant ouvertes ; un autre favori du client sans pack n'a
  l'exclusivité que si personne n'a de pack. Négociation et liste des véhicules d'un devis : même ordre.
- Pilote et flotte : aucun traitement à part dans la répartition (la flotte filtre seulement par organisation tant que la
  course n'est pas partagée au réseau) ; la même règle s'applique donc à eux.
- OpenAPI régénérée (403 chemins), client d'API : `setDriverPlatformFee`, `platformFees`.

**My Hub** : fiche chauffeur, carte « Redevance Neomoov » (taux ; modification bornée de 5 à 10 %, au quart de point,
pour les finances et l'administration) ; Relevés, carte « Redevance Neomoov de la période » (total, retenue sur les
versements, ajoutée à la dette, par taux ; mois en cours par défaut). FR et EN.

**Application chauffeur** : écran Revenus, ligne « Redevance Neomoov » et « Net après redevance Neomoov », et sous chaque
course « Redevance Neomoov (10 %) : −2,46 $ » ; rentabilité Pilote, ligne « Redevance Neomoov retenue ». Les relevés et
leur PDF montrent déjà la ligne (libellé venu de l'API). FR et EN, vouvoiement.

## 4. Essais

- Domaine : `pnpm --filter @neomoov/domain test` : 43 fichiers, 586 tests, couverture 100 % (lignes, branches,
  fonctions). Nouveau fichier `test/platform-fee.test.ts` (bornes, arrondi, relevé carte et direct, priorité).
- Base : `pnpm --filter @neomoov/db test` : 28 tests (journal des migrations compris).
- Types : `typecheck` vert pour domain, db, api (tests compris), api-client, web, mobile-driver, mobile-client,
  mobile-core, worker. Tests unitaires web (17), mobile-driver (21), api-client (30) verts.
- e2e sous verrou (`db-lock.cjs run redevance …`) :
  - `test/platform-fee.e2e.test.ts` (nouveau, 4 scénarios) : course par carte, course en paiement direct, changement
    de taux (refus 499, 1001, 750,5 et « 750 » ; 403 pour un opérateur ; audit), idempotence (fin de course rejouée,
    écriture rejouée), relevé (lignes et net), garantie modèle (remise), revenus, finances (et 400, 403), réglage des
    nouveaux chauffeurs, planifiée (chauffeur avec pack seul, puis sans pack à 121 s, qui peut accepter), immédiate
    (chauffeur avec pack plus loin sollicité avant le chauffeur sans pack plus proche, puis celui-ci après un refus).
    4 sur 4.
  - `dispatch`, `revue-b-dispatch`, `isolation-coverage` : 27 sur 27.
  - Deuxième lot (`settlement`, `statement-correction`, `pilot`, `driver-account`, `admin-hub`,
    `growth-favorites-guarantee`, `fleet`, `growth-packs-promotions`, `revue-a-argent`) : 47 sur 48 au premier passage ;
    le seul échec venait de `driver-account` (comparaison stricte des totaux de l'accueil, qui portent désormais
    `platformFeeCents` et `netCents`) : attente mise à jour, `driver-account` relancé seul, 7 sur 7.
- Non lancé : la suite complète de l'API (réservée à la session principale) et les parcours Playwright ou Maestro.

## 5. Ce qui reste à décider par le fondateur

1. **Courses offertes ou promotions** : la redevance porte aujourd'hui sur le tarif complet (le chauffeur reçoit le tarif
   complet, compensé par Neomoov). Faut-il l'exonérer sur une course offerte par Neomoov (`free_ride`) ou la calculer sur
   le tarif payé par le client ?
2. **Pourboire** : jamais soumis (choix par défaut). À confirmer.
3. **Annulations et absences payantes** (frais de 5 $ et 7 $, 100 % au chauffeur) : pas de redevance aujourd'hui.
4. **Assiette** : tarif du chauffeur seulement (hors frais de service de Neomoov, péages, taxes, redevance
   gouvernementale). L'attente facturée et les suppléments (chauffeur favori, nuit, aéroport, siège enfant, animal…)
   font partie du tarif du chauffeur, donc de l'assiette : à confirmer.
5. **Prix négocié** : la redevance porte sur le tarif convenu (plus bas que le prix affiché). À confirmer.
6. **Remboursement d'un client sans faute du chauffeur** (geste commercial) : la redevance reste due. À confirmer.
7. **Priorité des packs** : à rayon égal pour les courses immédiates (un chauffeur sans pack à 2 km passe avant un
   chauffeur avec pack trouvé seulement au rayon de 5 km) ; délai de 120 s pour les planifiées ; le favori demandé par le
   client n'est pas déclassé. Exclure les chauffeurs sans pack reste possible par `drivers.require_active_pack`.
8. **Abonnement Pilote et loyer de flotte** : la redevance s'y ajoute (décision 1). Aucun abonnement Pilote n'est
   facturé par le code aujourd'hui : à prévoir si Pilote devient payant.
9. **Taux par organisation** (flotte, marque blanche) : non prévu ; le taux est par chauffeur. Une flotte n'a pas accès au
   réglage (route de la plateforme seulement).
10. **Communication** : rien n'a été publié ni modifié côté public (règle) ; voir la section 6.

## 6. Points de communication à revoir (« zéro commission »), non modifiés

Recherche du 3 octobre 2026 (« zéro commission », « sans commission », « aucune commission », « Commission Neomoov »).
Rien n'a été changé ; tout est à revoir avec le fondateur avant la mise en production.

**Dans le dépôt de la plateforme :**
- Application chauffeur, `apps/mobile-driver/src/i18n.ts` : `intro` (« Zéro commission : vos packs de courses prépayés… »,
  et l'anglais « Zero commission… ») et `costs.commission` (« Commission Neomoov : 0,00 $ », affiché sur l'écran Coûts de
  Pilote, désormais sous la ligne « Redevance Neomoov retenue » : contradiction visible à trancher en priorité).
- Maquettes et règles de design (`docs/design/02-prompts-claude-design.md`, `01-analyse-reference-uber.md`,
  `canevas/project/Chauffeur-02`, `-04`, `-06`, `-12`, `-13`, `-15`, `-16`, `-25`, `Releve-Hebdo-1`, `-2`, `-Negatif`,
  `Releve-Mensuel-1`, `Rapport-Trimestriel`, `Doc-01-CourrielVendredi`, outils `lot2-*.js`, `lot3-*.js`) : « Commission
  Neomoov : 0,00 $ », « sans commission », « zéro commission ».
- `docs/operations/mise-en-service-finale.md` (ligne des décisions en attente : « Redevance 10 % (non publiée : contredit
  « sans commission ») ») et `academy/docs/REVISION_2026-10-01.md` (« le site public annonce « sans commission » »).
- Academy : les mentions de « commission » des modules et de l'ebook parlent des opérateurs en général (pas de Neomoov).

**Hors dépôt (site neomoov.net et documents, dossier de sauvegarde d'octobre 2026, `livrables/`) :**
- Site WordPress : `sites-web/neomoov-site-wordpress/contenu/pages.js` (accueil, chauffeurs, packs, FAQ « Que signifie
  « sans commission » ? », engagements, formulaire de candidature, article « Chauffeur sans commission »),
  `contenu/pages-ajouts.js` (page taxis et VTC : « zéro commission », « Gardez 100 % du tarif »), `outils/publier.js` et
  `outils/images.js` (image `neomoov-chauffeurs-sans-commission.png` et son texte), `images-sources/` (deux visuels),
  `reponses-assistant-lws.html`, copies `brut/test-*.html`.
- Documents : `rédaction/neomoov-document-reference/` (document de référence v1 et ses sources, questionnaire),
  `rédaction/neomoov-formation-chauffeurs/03`, `04`, `05` (produit d'appel, séquence de courriels, page de paiement),
  `rédaction/neomoov-etude-concurrence/01`, `02`, `applications/neomoov-plateforme/confidentiel/` (mise en service,
  synthèse de la revue, design, synthèse du mandat du 26 septembre).

## 7. Pièges

La base de développement est partagée (migration 0036 appliquée sous verrou ; elle ajoute une colonne avec
défaut et une table, sans effet sur les autres branches) ; `test/helpers.ts` supprime désormais les lignes
`platform_fees` avant les courses et les chauffeurs de test (clé étrangère sans cascade, voulue pour l'argent) ; un
réglage `drivers.platform_fee_default_bps` saisi hors bornes dans Paramètres est ignoré (10 %).
