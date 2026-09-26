# Forcer une réattribution ou une attribution de course

Étape 16. Règles de l'étape 6 (panneau opérateur, décisions du 25 septembre 2026). Rôles : **administrateur** ou **opérateur**. Écran : My Hub, Exploitation, **Courses**, puis la course (numéro `NM-AAAA-MM-JJ-0000`). Chaque geste demande un motif et est inscrit au journal d'audit et dans la chronologie de la course.

## Ce que la plateforme fait déjà seule

| Situation | Réaction automatique |
|---|---|
| Le chauffeur annule en route | Course remise en recherche, chauffeur exclu, recherche prioritaire |
| Le chauffeur attribué ne bouge pas (moins de 50 m en 3 minutes, réglages `dispatch.no_movement_*`) | Chauffeur retiré sans sanction, client prévenu, nouvelle recherche |
| Aucune réponse aux offres | Vagues successives (2, 5, 10 km puis la zone), trois balayages, puis `no_driver` avec alerte (tableau de bord et courriel au personnel) |
| Réservation planifiée non confirmée 30 minutes avant | Alerte « Planifiées non confirmées » sur le tableau de bord et courriel au personnel |

Le geste manuel sert quand la situation réelle est connue de l'exploitation et pas du système : chauffeur joint au téléphone qui ne viendra pas, client qui signale un problème, course sensible.

## Les boutons de la fiche de course

| Bouton | Quand il est permis | Effet |
|---|---|---|
| **Réattribuer** | Bouton affiché quand un chauffeur est en place : course `assigned`, `en_route` ou `arrived` (l'API l'accepte aussi sans chauffeur, en `requested` ou `offering`, pour relancer une recherche prioritaire) | Retire le chauffeur en place sans sanction ; case « Exclure le chauffeur actuel » pour qu'il ne soit pas resollicité ; nouvelle recherche prioritaire |
| **Attribuer** | Course sans chauffeur | Choix d'un chauffeur actif dans une recherche ; l'API vérifie la garantie de modèle (catégorie du véhicule au moins égale à celle réservée) |
| **Mettre en attente** | Course sans chauffeur (`requested`, `offering`) | Retire les offres en cours ; aucune nouvelle recherche jusqu'à la reprise |
| **Relancer la répartition** | Course en attente | Reprend la recherche automatique |
| **Annuler la course** | Mêmes états qu'une annulation par le client (la machine à états refuse sinon) ; remplacé par **Interrompre la course** quand la course est `in_progress` | Motif obligatoire ; case « Facturer les frais d'annulation » : frais calculés selon la règle du client (gratuit avant l'attribution et dans les 2 minutes qui la suivent) |
| **Interrompre la course** | Course en cours (`in_progress`) seulement | Motif obligatoire ; case « Accident (incident grave) ». La course passe à `interrupted` (état final), un incident est ouvert (gravité élevée pour un accident, moyenne sinon), l'autorisation de paiement par carte est levée, **aucune facture** n'est émise automatiquement ; client (push et texto) et chauffeur prévenus |

Le bloc de répartition de la fiche montre l'état de la recherche, la vague, le rayon et chaque offre faite (chauffeur, état, heure).

## Procédures

### Remplacer un chauffeur qui ne viendra pas

1. Ouvrir la course. **Réattribuer**, motif (« Chauffeur injoignable, retard de 20 minutes »), case « Exclure le chauffeur actuel » cochée.
2. La recherche prioritaire démarre. Suivre les offres dans le bloc de répartition.
3. Prévenir le client si le retard change l'heure d'arrivée, par téléphone (numéro affiché dans le résumé de la fiche de course). Limite connue : My Hub ne peut pas écrire dans la messagerie d'une course en V1 (aucune route du personnel pour ces messages).

### Donner la course à un chauffeur précis

Joindre d'abord le chauffeur au téléphone pour qu'il accepte, puis :

1. Si un chauffeur est en place : **Réattribuer** (avec exclusion) pour le retirer.
2. **Mettre en attente** pour arrêter les offres automatiques.
3. **Attribuer** : chercher le chauffeur par nom, téléphone ou numéro (`CH-00000`), note facultative, confirmer. Refus possibles : catégorie du véhicule trop basse, chauffeur non actif, course déjà attribuée (409).

Non vérifié dans un test : l'attribution d'une course en attente. Si l'API la refuse, **Relancer la répartition** puis **Attribuer** tout de suite.

### Réservation planifiée non confirmée

Tableau de bord, bloc « Courses planifiées non confirmées par le chauffeur » : ouvrir la course, joindre le chauffeur ; s'il ne confirme pas, suivre « Donner la course à un chauffeur précis ».

### Course en `no_driver`

L'état est final : la course ne se réattribue pas. Le client a reçu un avis et l'autorisation de paiement a été levée. Si le client souhaite toujours partir : **Nouvelle course** (compte existant ou fiche minimale, paiement au chauffeur), puis **Attribuer** à un chauffeur joint au téléphone. Préavis de 2 heures appliqué par l'API au devis.

### Course en cours (`in_progress`)

Plus de réattribution possible. Un problème en course passe par les incidents (SOS, plainte) : Sécurité et conformité, **Incidents**.

Si la course ne peut pas se terminer normalement (accident, malaise, chauffeur injoignable, véhicule immobilisé) : **Interrompre la course**, motif précis, case « Accident » cochée s'il y a lieu. Ne pas la faire terminer par le chauffeur, ce qui la facturerait. Ensuite :

1. **Incidents** : l'incident ouvert (« Course interrompue : … ») porte la décision humaine ; blocage préventif du chauffeur si la sécurité est en cause.
2. Si le client doit être ramené à destination : la plateforme n'accepte que des réservations avec préavis (2 heures, D32, appliqué par l'API au devis, **Nouvelle course** comprise). Un retour immédiat s'organise hors plateforme (chauffeur ou taxi joint au téléphone), noté dans l'incident.
3. Aucun montant n'est prélevé ni facturé par la plateforme pour la course interrompue : un éventuel paiement partiel ou un geste commercial se décide et se traite hors plateforme en V1 (aucun bouton de facturation partielle), noté dans l'incident.
4. Accident : prévenir aussi l'assureur ; si des renseignements personnels sont en cause, suivre `incident-confidentialite.md`.

## Par l'API

```
POST /v1/admin/rides/{id}/reassign   {"reason": "…", "excludeDriver": true}
POST /v1/admin/rides/{id}/hold       {"reason": "…"}
POST /v1/admin/rides/{id}/release
POST /v1/admin/rides/{id}/assign     {"driverId": "…", "note": "…"}
POST /v1/admin/rides/{id}/cancel     {"reason": "…", "chargeFee": false}
POST /v1/admin/rides/{id}/interrupt  {"reason": "…", "incidentType": "accident"}   (ou "other")
GET  /v1/admin/rides/{id}/dispatch
```

Codes de refus : `RIDE_NOT_REASSIGNABLE` (état qui ne le permet plus), `RIDE_NOT_HOLDABLE` (un chauffeur est en place), `RIDE_NOT_HELD`, `RIDE_ALREADY_ASSIGNED`. L'interruption d'une course qui n'est pas `in_progress` est refusée (409) ; rejouée, elle ne crée pas de second incident.

## Courses figées

Le worker signale une course figée (arrivé depuis plus de 30 minutes, en route depuis plus de 90, en course depuis plus de 4 heures, réservation en retard de 15 minutes, recherche au-delà de 20 minutes). La liste s'affiche dans la carte **Courses figées** du **Tableau de bord** (relue chaque minute ; `GET /v1/admin/rides/stuck`) : numéro de la course (lien vers sa fiche), état, durée. Rien n'est corrigé automatiquement : depuis la fiche, réattribuer, annuler, interrompre (course en cours) ou appeler. L'alerte part aussi par courriel aux administrateurs et opérateurs (`alert.stuck_ride`, une fois par course et par état ; envoyée seulement avec Resend réel, `docs/operations/acces-a-fournir.md`, section 6). Les alertes « aucun chauffeur » et « planifiée non confirmée » partent de la même façon, en plus de leur affichage sur le tableau de bord.
