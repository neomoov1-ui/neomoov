# Finalisation U7 (3 octobre 2026) : couverture du domaine à 100 % et « Analyse en cours » dans My Hub

Branche `finalisation-u7-couverture` (copie `neomoov-wt24`), créée depuis la branche locale `integration-finale` (`98753f4`), puis fusionnée avec `integration-finale` à jour (`7be6808`, finalisation U4). Mission : `neomoov-outils/agents/U7-couverture-et-booster-hub.md`. Aucun fichier de Q1, de U2, des applications mobiles, d'`infra/` ni de U6 n'a été modifié ; aucune migration, aucune route, aucun essai sur la base.

## Points de la mission

| Point | État | Preuve (fichier, essai) |
|---|---|---|
| 1. Couverture du domaine à 100 % (instructions, branches, fonctions, lignes) | Fait ; seuil inchangé, aucune exclusion ajoutée | `packages/domain/test/publications.test.ts` (7 essais ajoutés, 3 complétés), `packages/domain/test/social-accounts.test.ts` (1 ajouté, 2 complétés) ; `pnpm --filter @neomoov/domain test` : 100 % partout |
| 1 bis. Code mort | Retiré, ou rendu inatteignable par le type | `campaignStart` retirée de `marketing/publications.ts` (importée nulle part dans le dépôt : l'API calcule le premier jour dans `publications.service.ts`) ; `SocialSpaceInfo.modes` typé non vide (`[SocialMode, ...SocialMode[]]`), d'où `defaultSocialMode` sans le repli `?? 'manual'` jamais atteint ; `rankPhotos` lit le nom du fichier par `lastIndexOf('/')` (même résultat, sans la branche `?? ''` impossible de `split('/').pop()`) |
| 2. « Analyse en cours » dans My Hub (inspections et performances) | Fait | `apps/web/src/components/hub/booster-analysis.tsx` ; pages `hub/(app)/booster/inspections/page.tsx`, `inspections/[id]/page.tsx`, `performance/page.tsx` ; clés `hub.booster.analysisPending`, `analysisStates`, `pendingNotice`, `reading` (fr-CA et en) dans `apps/web/src/lib/i18n-hub.ts` ; `apps/web/test/booster-analysis.test.ts` (4 essais) |
| 3. Suite du domaine, tests du web, types du web | Verts | Voir « Essais » |

Liste exacte des fichiers sous le seuil au départ (commande de couverture) : `marketing/publications.ts`, `marketing/social-accounts.ts`, `marketing/visuals.ts`, `schemas/publications.ts`, soit 3 instructions, 20 branches et 3 fonctions non couvertes.

## Ce qui est maintenant vérifié

- `marketing/publications.ts` : format et langue d'une variante gardés seulement s'ils sont admis par le réseau ; langue de base non admise ramenée au français ; variante déjà en anglais sans seconde version anglaise ; version anglaise avec titre, texte de l'image et mots-clics propres (sinon ceux de la version française) ; appel à l'action `none` sans lien, adresse inconnue signalée sans bloquer ; échec sans message du connecteur jamais pris pour un relais manuel ; créneaux du réglage pour un réseau, défauts pour un réseau absent ou à liste vide.
- `marketing/social-accounts.ts` : `isSocialSpace` (les dix espaces seulement, ni `google_business` ni `newsletter`) ; « en attente d'approbation » ramené à « non relié » pour un réseau sans approbation ou déjà approuvé ; mode par défaut de chaque espace.
- `marketing/visuals.ts` : texte coupé jamais réduit aux points de suspension quand le début n'est que ponctuation ; clé de variante sans photo ; fichier vidéo `.mp4` et référence nettoyée ; nom de fichier encodé ou adresse sans dossier pris en compte par `rankPhotos`.
- `schemas/publications.ts` : l'approbation en lot exige une campagne ou au moins une publication (message), bornes des jours et du rythme, champ inconnu refusé.

## Booster dans My Hub

- Fiche d'une inspection : l'état `pending` affiche « Analyse en cours : la page se met à jour d'elle-même dès que le résultat est prêt. » au lieu de « Rapport saisi sans analyse automatique. ». Le paragraphe est une zone `aria-live="polite"` : le résultat qui remplace « en cours » est lu par les lecteurs d'écran.
- Listes : nouvelle colonne « Analyse automatique » (inspections) et « Lecture des captures » (performances), pastille par état (Aucune, Analyse en cours, Terminée, En échec) ; avis « Analyse en cours pour N rapport(s) » au-dessus de la liste quand il y en a.
- Rafraîchissement : `refetchInterval` de React Query à 10 secondes tant qu'au moins une analyse de la page est `pending`, aucun sinon ; onglet caché : pas de relecture (comportement par défaut). La relecture s'arrête toujours : l'API rend `failed` une analyse restée `pending` plus de 10 minutes (`apps/api/src/modules/booster/booster-async.ts`).
- Choix : composants d'affichage dans un fichier à part pour les tester sans navigateur (même outillage que `hub-screens.test.ts` : rendu statique et contrôles du balisage) ; les pages ne font que brancher les requêtes.

## Essais (3 octobre 2026)

| Commande | Résultat |
|---|---|
| `pnpm --filter @neomoov/domain test` au départ | 46 fichiers, 618 tests verts ; couverture 99,91 % (instructions), 99,2 % (branches), 99,54 % (fonctions), 99,89 % (lignes) : **seuil de 100 % non atteint** |
| Même commande après les essais ajoutés, puis après la fusion d'`integration-finale` (`7be6808`) | 46 fichiers, **626 tests verts** ; **100 %** : 3441/3441 instructions, 2501/2501 branches, 654/654 fonctions, 2777/2777 lignes |
| `pnpm --filter @neomoov/domain typecheck` | Vert |
| `pnpm --filter @neomoov/web test` (avant et après la fusion) | 11 fichiers, **45 tests verts** (dont `booster-analysis.test.ts`, 4) |
| `pnpm --filter @neomoov/web typecheck` (après `domain build` et `api-client build`) | Vert, avant et après la fusion |
| `pnpm --filter @neomoov/api typecheck` (types du domaine modifiés) | Vert, avant et après la fusion |
| `/code-review` (effort bas) sur `integration-finale..HEAD` | Aucun constat sur le code ; les deux pages des inspections, sautées par l'outil, relues à la main |
| Base de développement, Playwright | Aucun essai : ni table, ni route, ni service de l'API touché ; Playwright demande un serveur contre la base partagée |

## Reste à faire, décisions

- Aucune décision du fondateur dans ce périmètre. Décision technique inscrite dans `docs/decisions.md` (ligne « Finalisation U7 »).
- `booster.analysis_async` reste faux (point « À trancher » de U3) : My Hub affiche déjà l'état `pending` dès qu'une application demande `?async=true`.
- Piège pour la session principale : dans une copie dont les `dist` sont anciens, `pnpm --filter @neomoov/web typecheck` échoue sur des membres absents du client (`platformBilling`, `crmRecords`…) sans rapport avec la branche ; construire d'abord `@neomoov/domain` puis `@neomoov/api-client`.
