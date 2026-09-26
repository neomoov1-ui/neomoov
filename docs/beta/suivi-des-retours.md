# Suivi des retours de la bêta

Modèle à remplir pendant la bêta (`procedure.md`, sections 4 à 6). Une ligne par retour. **Aucune donnée personnelle** : pas de nom, de téléphone, de courriel, d'adresse ni de numéro de course complet d'un client ; le testeur est désigné par son code (`C01` à `C30`, `D01` à `D10`, `F` pour le fondateur, `O` pour un opérateur). Une capture d'écran qui montre des données personnelles reste dans la boîte `beta@neomoov.net`, jamais dans le dépôt.

## Légende

| Colonne | Valeurs |
|---|---|
| N° | `B-001`, `B-002`, … dans l'ordre d'arrivée |
| Date | Date de réception, `AAAA-MM-JJ` |
| Testeur | Code du testeur |
| Plateforme | `iOS 18.x`, `Android 15`, `Web`, `My Hub` ; modèle d'appareil si utile |
| Version | Version affichée et numéro de build (`1.0.0 (12)`) |
| Écran | Nom de l'écran tel qu'affiché (« Réservation, étape 3 », « Accueil chauffeur », « Relevés ») |
| Gravité | `Bloquant`, `Majeur`, `Mineur`, `Suggestion` |
| Description | Ce qui s'est passé, ce qui était attendu, étapes pour reproduire |
| Statut | `nouveau`, `qualifié`, `en cours`, `corrigé`, `vérifié`, `reporté`, `rejeté`, `doublon` |
| Décision | Ce qui est décidé, par qui, et la version qui corrige (« Corrigé en 1.0.1 (14) », « V1.1 », « Non retenu : contraire au préavis D32 ») |

## Tableau

| N° | Date | Testeur | Plateforme | Version | Écran | Gravité | Description | Statut | Décision |
|---|---|---|---|---|---|---|---|---|---|
| B-001 | AAAA-MM-JJ | C00 | iOS 18.0, iPhone 13 | 1.0.0 (1) | Exemple : Réservation, étape 3 | Mineur | Exemple fictif : le libellé « Payer le chauffeur après » est coupé sur petit écran. Attendu : libellé complet | nouveau | |

## Bilan hebdomadaire

| Semaine du | Nouveaux | Bloquants ouverts | Majeurs ouverts | Mineurs ouverts | Suggestions | Testeurs actifs (clients / chauffeurs) | Courses terminées | Sessions sans plantage |
|---|---|---|---|---|---|---|---|---|
| AAAA-MM-JJ | | | | | | / | | % |
