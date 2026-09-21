# Prompt 15. Étape 15 : tests de bout en bout, charge, durcissement, observabilité (J12 et J13)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 9 (en entier), 2 (en entier), 10.4 et 11.1 (étape 15). Consulte `docs/decisions.md`.

## Objectif
Prouver la robustesse, la fiabilité et la stabilité : les 25 parcours de la section 9.2 automatisés et verts, les tests de charge aux cibles de la section 2.2, le mode dégradé, l'observabilité complète, et la correction de tout ce que ces tests révèlent.

## Tâches
1. Inventaire : liste les 25 parcours de la section 9.2 et, pour chacun, le test existant (Vitest, Playwright, Maestro) ou manquant. Écris les tests manquants. Les parcours 18 (vocal) et 21 (négociation) s'exécutent avec fournisseurs simulés et drapeau activé en environnement de test.
2. Jeu de données de bout en bout : script `pnpm seed:e2e` créant un état réaliste (50 chauffeurs en ligne répartis dans les zones, 200 clients, 300 courses passées avec paiements, relevés et factures) pour les tests et les démonstrations.
3. Tests de charge k6 (`pnpm test:load`) : 500 demandes de course simultanées avec attribution ; 2 000 sockets chauffeurs envoyant 400 positions par seconde pendant 15 minutes ; 100 devis par seconde ; mesure des latences (devis, attribution, diffusion de position, API) et comparaison automatique aux cibles de la section 2.2 ; rapport dans `docs/testing/load-report.md`. Corrige les goulots (index, requêtes N+1, verrous, taille des lots, connexions) jusqu'à atteindre les cibles.
4. Mode dégradé : tests du disjoncteur sur Routes, Stripe, SMS, LLM (pannes simulées), vérification que la plateforme continue (devis estimé, notification par un autre canal, file de retraitement, panneau opérateur) ; documentation du comportement dans `docs/runbooks/degraded-mode.md`.
5. Résilience des files : redémarrage du worker en pleine charge sans perte ni doublon (tests avec clés d'idempotence) ; file des échecs consultable dans My Hub ; retraitement manuel.
6. Observabilité : Sentry sur l'API, le worker, le web et les deux applications mobiles (versions et environnement), journaux pino structurés avec identifiant de corrélation propagé du mobile à l'API et aux files, métriques (courses par état, temps d'attribution, latences, taille des files, échecs de paiement, erreurs de fournisseurs) exposées et affichées dans My Hub, sondes de disponibilité Better Stack (API, web, socket) avec alertes courriel et SMS au fondateur, `GET /v1/health` détaillé.
7. Durcissement issu des tests : correction de toute fuite mémoire, de toute reconnexion défaillante des sockets, de toute course bloquée dans un état ; ajout d'une tâche de surveillance qui détecte les courses figées (par exemple `assigned` sans mouvement, `arrived` sans suite au-delà de 30 minutes) et alerte l'opérateur.
8. Sauvegarde et restauration : scripts `infra/scripts/backup.sh` et `restore.sh`, test de restauration sur une base vierge documenté.
9. Mise à jour de `docs/testing/README.md` : comment lancer chaque suite, durées, prérequis.

## Contraintes
- Aucun test n'est marqué ignoré pour passer ; un test qui révèle un défaut conduit à corriger le code.
- Les tests de charge s'exécutent contre un environnement isolé (local ou staging dédié), jamais contre la production.

## Critères d'acceptation
- 25 parcours verts (22 en réel, 18 et 21 en simulé).
- Rapport de charge : toutes les cibles de la section 2.2 atteintes.
- Redémarrage du worker sous charge sans perte ni doublon démontré.
- Restauration d'une sauvegarde réussie en moins de 4 heures (mesure documentée).

## Vérifications à exécuter et à montrer
Tableau des 25 parcours avec leur statut, rapport k6, capture des métriques dans My Hub, sortie du test de restauration.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 15 : tests de bout en bout, charge, durcissement et observabilité ».
