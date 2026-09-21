# Prompt 17. Reprise d'une étape interrompue, et revue finale de la V1

Deux prompts distincts. Le premier sert chaque fois qu'une session Claude Code s'arrête avant la fin d'une étape. Le second sert une fois, à la fin du sprint.

---

## 17.A Prompt de reprise

Nous reprenons la construction de la plateforme Neomoov après une interruption. Lis `CLAUDE.md`, `docs/decisions.md`, puis exécute `git status`, `git log --oneline -20` et `pnpm test` pour établir l'état réel du dépôt. Identifie l'étape en cours à partir de `docs/cahier-des-charges-v1.md` section 11.1 (la dernière étape commitée plus un). Lis les sections du cahier des charges indiquées par le prompt de cette étape (fichier `docs/prompts/NN-*.md` si présent, sinon je te le colle).

Ensuite :
1. Dresse la liste de ce qui est fait, de ce qui est commencé et de ce qui reste pour cette étape, en t'appuyant sur le code et les tests, pas sur les messages de commit.
2. Si des tests échouent, corrige-les avant toute nouvelle fonctionnalité.
3. Termine l'étape selon ses critères d'acceptation, avec ses vérifications, `/code-review`, `docs/decisions.md` et un commit.
4. Ne refais pas ce qui est déjà fait et testé. Ne change pas une décision inscrite dans `docs/decisions.md` sans me le demander.

---

## 17.B Prompt de revue finale de la V1

La V1 de la plateforme Neomoov est déclarée terminée. Réalise une revue finale complète, sans rien construire de nouveau, et rends un rapport dans `docs/reviews/v1-final-review.md`.

Lis `CLAUDE.md`, `docs/decisions.md`, `docs/cahier-des-charges-v1.md` en entier. Puis :

1. **Conformité au cahier des charges.** Pour chaque table de la section 4, chaque règle des sections 5.1 à 5.16, chaque écran des sections 6.1 à 6.4, chaque endpoint de la section 7.2, chaque exigence des sections 2 et 8 : indique « conforme », « partiel » ou « absent », avec le fichier et la ligne. Aucune ligne ne peut être laissée sans statut.
2. **Tests.** Exécute `pnpm test`, `pnpm test:e2e:web`, `pnpm test:e2e:mobile` (ou documente ce qui empêche l'exécution mobile) et `pnpm test:load` sur l'environnement isolé. Joins les résultats et la couverture (100 % exigés sur `packages/domain/pricing` et `packages/domain/settlement`).
3. **Sécurité.** Lance `/security-review` sur l'ensemble du dépôt, l'audit de dépendances et la détection de secrets. Liste les constats par gravité avec correction proposée.
4. **Revue de code.** Lance `/code-review` au niveau élevé sur les modules critiques : tarification, répartition, paiements, règlement, facturation, authentification, agents. Corrige les constats bloquants, liste les autres.
5. **Exploitation.** Vérifie que chaque manuel de `docs/runbooks/` correspond au code (commandes existantes, variables réelles). Vérifie la sauvegarde et la restauration.
6. **Magasins.** Vérifie que les prérequis de la section 10.5 sont satisfaits ou listés précisément.
7. **Écarts et risques.** Termine par une liste ordonnée des écarts restants, chacun avec sa gravité, son effort estimé et sa recommandation (corriger avant la bêta, corriger avant le lancement commercial, reporter en V1.1).

Le rapport est en français, factuel, sans complaisance. Si la V1 n'est pas prête pour la bêta, dis-le en première ligne avec la raison principale.
