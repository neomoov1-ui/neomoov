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
| 2026-09-22 | Heures de pointe : donnée de configuration | La section 5.1 ne définit pas les heures de pointe. Elles viennent de `settings` (`peakWindows`). Les plages des tests sont un exemple. Question au fondateur |
| 2026-09-22 | Forfait : options et suppléments ignorés, et signalés | Le forfait remplace tout le calcul (section 5.1). Le devis renvoie `ignoredOptions`. Un forfait dont le total ne se décompose pas en lignes arrondies est refusé (`FLAT_RATE_NOT_DECOMPOSABLE`) : My Hub devra valider le montant à la saisie |
| 2026-09-22 | Course offerte : frais et taxes selon la promotion | La section 5.9 applique la promotion au tarif du chauffeur. Le drapeau `waivesFees` de la promotion décide si Neomoov renonce aussi aux frais de service, à la redevance et aux taxes. Sans lui, une course « offerte » coûte 3,34 $ au client. Question au fondateur |
| 2026-09-22 | Prix maximal consenti = total + marge configurable | « Plafond 20 $ » du prompt 04 lu comme une marge d’attente et d’arrêts de 20,00 $ au plus (`maxExtraAllowanceCents`). L’attente se facture par minute entière après le délai gratuit |
| 2026-09-22 | Ordre des opérations | Minimum, puis suppléments fixes, puis multiplicateur Flex ou Priorité, puis chauffeur favori, comme l’ordre des lignes de la section 5.1 |
