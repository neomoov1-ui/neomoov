# Bêta fermée Neomoov

Étape 16 (prompt 16, tâche 8 ; cahier des charges, sections 9.4 et 10.5). Bêta fermée avec 10 chauffeurs et 30 clients choisis par le fondateur, sur les applications distribuées par TestFlight (iPhone) et le test interne de Google Play (Android), contre l'API de `api.neomoov.net`.

| Document | Contenu |
|---|---|
| `procedure.md` | Préparer, inviter, collecter les retours, trier, fréquence des revues et des versions |
| `suivi-des-retours.md` | Tableau de suivi des retours (modèle à remplir, sans donnée personnelle) |
| `comptes-de-test.md` | Comptes de test et de démonstration à créer (sans mot de passe ni donnée personnelle réelle) |

La liste nominative des testeurs (noms, courriels, téléphones) est un renseignement personnel : elle vit hors du dépôt (Bitwarden ou un classeur privé). Dans le dépôt, un testeur n'apparaît que sous un code : `C01` à `C30` pour les clients, `D01` à `D10` pour les chauffeurs.

## Critères de sortie de bêta

La bêta se termine quand tous les critères ci-dessous sont remplis. Proposition à valider par le fondateur ; les critères 1 à 5 reprennent la section 9.4 du cahier des charges.

| # | Critère | Mesure | Où le vérifier |
|---|---|---|---|
| 1 | Applications installées sur au moins 10 appareils de chauffeurs et 30 appareils de clients | Nombre de testeurs actifs | App Store Connect (TestFlight, Testeurs) ; Play Console (Test interne) |
| 2 | Les 25 parcours critiques passent, sauf 18 (agent vocal) et 21 (négociation) qui peuvent rester simulés | Tableau de `docs/testing/README.md` à jour, parcours Maestro joués sur un iPhone et un Android réels | `docs/testing/README.md` |
| 3 | Une journée d'exploitation complète faite par le fondateur dans My Hub sans intervention technique | Compte rendu de la journée simulée (prompt 16, tâche 9) puis d'une journée réelle | `docs/operations/daily.md` |
| 4 | Redémarrer, restaurer et diagnostiquer sans le développeur | Au moins un redémarrage de service et une restauration d'essai faits par le fondateur avec les manuels | `docs/runbooks/` |
| 5 | Cibles de performance tenues | Test de charge k6 sur le serveur de préproduction ; première offre au chauffeur en moins de 3 secondes mesurée pendant la bêta | Rapport de test de charge |
| 6 | Aucun retour de gravité « Bloquant » ouvert ; au plus 5 « Majeurs » ouverts, chacun avec un contournement connu | Tableau de suivi | `suivi-des-retours.md` |
| 7 | Stabilité : au moins 99 % de sessions sans plantage sur les 7 derniers jours | Consoles des magasins ; Sentry (projet `mobile`) si `EXPO_PUBLIC_SENTRY_DSN` est posé (branché dans les applications, inactif sans DSN) | App Store Connect, Play Console, Sentry |
| 8 | Aucun incident de confidentialité ouvert ; registre à jour | Registre | `docs/runbooks/incident-confidentialite.md` |
| 9 | Sauvegardes vérifiées chaque jour pendant 14 jours de suite, une restauration d'essai réussie | Journal des sauvegardes, entrée d'essai dans `sauvegardes.md` | `docs/runbooks/sauvegardes.md` |
| 10 | Relevés de deux vendredis consécutifs générés, émis et contrôlés sans correction manuelle imprévue | Relevés, file d'approbation de l'agent comptabilité | My Hub, Relevés |
| 11 | Manuels d'exploitation relus et validés par le fondateur | Date de validation notée dans `docs/runbooks/README.md` | |

Sortir de bêta ne vaut pas lancement commercial : celui-ci exige en plus les conditions de la section 10.6 du cahier des charges (autorisations de la CTQ, facturation certifiée en production, assurances, hébergement canadien effectué ou évaluation documentée, applications approuvées par les magasins, 100 chauffeurs formés, test de charge validé).

## Avant la première course de bêta : point juridique

Une course de bêta avec un vrai client et un vrai chauffeur est un transport rémunéré de personnes. Avant la première course payée, faire confirmer par l'avocat que le cadre le permet (qualification de chaque chauffeur, statut de Neomoov auprès de la CTQ, assurance couvrant ces courses, facturation). À défaut, limiter la bêta à des courses non rémunérées entre personnes de confiance, ou à des essais sans passager.
