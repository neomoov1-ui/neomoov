# Journal des décisions techniques

Une entrée par décision : date, contexte, décision, conséquences. Le cahier des charges fait foi ; ce journal couvre ce sur quoi il est muet.

| Date | Décision | Contexte et conséquences |
|---|---|---|
| 2026-09-22 | Dépôt créé, étape 0 | Cahier des charges v1.0, 18 prompts et design (lot 1, 20 maquettes) copiés dans `docs/`. Docker, pnpm et l'accès GitHub restent à installer sur le poste avant l'étape 1 |
| 2026-09-22 | Taxes des chauffeurs : pas de perception ni de remise en leur nom | Décision du fondateur (D26 du document de référence), conforme à la section 5.8 : les taxes sur les tarifs sont reversées au chauffeur, qui déclare lui-même. À faire confirmer par un comptable |
| 2026-09-22 | Dénomination légale | « GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. » pour Stripe, les magasins et les documents juridiques (D25) |
| 2026-09-22 | Poste de développement | pnpm 12.5.1 installé. Poste à 6 Go de mémoire vive, WSL absent : choix à faire entre Docker Desktop et une base de développement hébergée avant l’étape 1 |
| 2026-09-22 | Monorepo amorcé avant l’étape 1 complète | pnpm 12.5.1, Turborepo, TypeScript strict, `packages/config` et `packages/domain`. Les applications (API, worker, web, mobiles) restent à créer à l’étape 1, qui attend le choix entre Docker et une base hébergée |
| 2026-09-22 | Moteur de tarification écrit en avance (étape 4, partie pure) | `packages/domain/src/pricing`, 70 tests, couverture de 100 %. Aucune valeur métier dans le code : les règles sont des entrées |
| 2026-09-22 | Flex et Priorité ne se cumulent pas | Le cahier des charges est muet. Les deux options se contredisent (attendre jusqu’à 15 minutes, ou le chauffeur le plus proche tout de suite). Erreur `FLEX_AND_PRIORITY_EXCLUSIVE`. À confirmer par le fondateur |
| 2026-09-22 | Heures de pointe : donnée de configuration, plages provisoires | La section 5.1 ne les définit pas. Elles viennent de `settings` (`peakWindows`). Proposition provisoire, acceptée « on y reviendra » par le fondateur : du lundi au vendredi de 6 h 30 à 9 h 30 et de 15 h 30 à 18 h 30, plus les vendredis et samedis de 22 h à 2 h. Elles ne servent qu’à refuser l’Offre Flex, jamais à majorer un prix |
| 2026-09-22 | Forfait : options et suppléments ignorés, et signalés | Le forfait remplace tout le calcul (section 5.1). Le devis renvoie `ignoredOptions`. Un forfait dont le total ne se décompose pas en lignes arrondies est refusé (`FLAT_RATE_NOT_DECOMPOSABLE`) : My Hub devra valider le montant à la saisie |
| 2026-09-22 | Course offerte : Neomoov absorbe aussi les frais et les taxes | Confirmé par le fondateur. Une course « offerte » coûte 0,00 $ au client : le drapeau `waivesFees` est vrai pour les promotions « troisième course offerte » et « dixième course offerte » dans les données de départ. Le chauffeur reçoit son tarif normal en compensation |
| 2026-09-22 | Prix maximal consenti = prix affiché + marge de 20,00 $ au plus | Confirmé par le fondateur. « Plafond 20 $ » du prompt 04 : marge d’attente et d’arrêts (`maxExtraAllowanceCents`), l’attente facturée par minute entière après 5 minutes gratuites, jamais au-delà |
| 2026-09-22 | Ordre des opérations | Minimum, puis suppléments fixes, puis multiplicateur Flex ou Priorité, puis chauffeur favori, comme l’ordre des lignes de la section 5.1 |
