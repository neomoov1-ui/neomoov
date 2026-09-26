# Forcer une réattribution ou une attribution de course

Étape 16. Règles de l'étape 6 (panneau opérateur, décisions du 25 septembre 2026). Rôles : **administrateur** ou **opérateur**. Écran : My Hub, Exploitation, **Courses**, puis la course (numéro `NM-AAAA-MM-JJ-0000`). Chaque geste demande un motif et est inscrit au journal d'audit et dans la chronologie de la course.

## Ce que la plateforme fait déjà seule

| Situation | Réaction automatique |
|---|---|
| Le chauffeur annule en route | Course remise en recherche, chauffeur exclu, recherche prioritaire |
| Le chauffeur attribué ne bouge pas (moins de 50 m en 3 minutes, réglages `dispatch.no_movement_*`) | Chauffeur retiré sans sanction, client prévenu, nouvelle recherche |
| Aucune réponse aux offres | Vagues successives (2, 5, 10 km puis la zone), trois balayages, puis `no_driver` avec alerte |
| Réservation planifiée non confirmée 30 minutes avant | Alerte « Planifiées non confirmées » sur le tableau de bord |

Le geste manuel sert quand la situation réelle est connue de l'exploitation et pas du système : chauffeur joint au téléphone qui ne viendra pas, client qui signale un problème, course sensible.

## Les boutons de la fiche de course

| Bouton | Quand il est permis | Effet |
|---|---|---|
| **Réattribuer** | Bouton affiché quand un chauffeur est en place : course `assigned`, `en_route` ou `arrived` (l'API l'accepte aussi sans chauffeur, en `requested` ou `offering`, pour relancer une recherche prioritaire) | Retire le chauffeur en place sans sanction ; case « Exclure le chauffeur actuel » pour qu'il ne soit pas resollicité ; nouvelle recherche prioritaire |
| **Attribuer** | Course sans chauffeur | Choix d'un chauffeur actif dans une recherche ; l'API vérifie la garantie de modèle (catégorie du véhicule au moins égale à celle réservée) |
| **Mettre en attente** | Course sans chauffeur (`requested`, `offering`) | Retire les offres en cours ; aucune nouvelle recherche jusqu'à la reprise |
| **Relancer la répartition** | Course en attente | Reprend la recherche automatique |
| **Annuler la course** | Mêmes états qu'une annulation par le client (la machine à états refuse sinon) | Motif obligatoire ; case « Facturer les frais d'annulation » : frais calculés selon la règle du client (gratuit avant l'attribution et dans les 2 minutes qui la suivent) |

Le bloc de répartition de la fiche montre l'état de la recherche, la vague, le rayon et chaque offre faite (chauffeur, état, heure).

## Procédures

### Remplacer un chauffeur qui ne viendra pas

1. Ouvrir la course. **Réattribuer**, motif (« Chauffeur injoignable, retard de 20 minutes »), case « Exclure le chauffeur actuel » cochée.
2. La recherche prioritaire démarre. Suivre les offres dans le bloc de répartition.
3. Prévenir le client si le retard change l'heure d'arrivée (messagerie de la course ou téléphone).

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

## Par l'API

```
POST /v1/admin/rides/{id}/reassign   {"reason": "…", "excludeDriver": true}
POST /v1/admin/rides/{id}/hold       {"reason": "…"}
POST /v1/admin/rides/{id}/release
POST /v1/admin/rides/{id}/assign     {"driverId": "…", "note": "…"}
GET  /v1/admin/rides/{id}/dispatch
```

Codes de refus : `RIDE_NOT_REASSIGNABLE` (état qui ne le permet plus), `RIDE_NOT_HOLDABLE` (un chauffeur est en place), `RIDE_NOT_HELD`, `RIDE_ALREADY_ASSIGNED`.

## Courses figées

Le worker signale une course figée (arrivé depuis plus de 30 minutes, en route depuis plus de 90, en course depuis plus de 4 heures, réservation en retard de 15 minutes, recherche au-delà de 20 minutes). La liste s'affiche dans la carte **Courses figées** du **Tableau de bord** (relue chaque minute ; `GET /v1/admin/rides/stuck`) : numéro de la course (lien vers sa fiche), état, durée. Rien n'est corrigé automatiquement : depuis la fiche, réattribuer, annuler ou appeler. L'alerte part aussi en notification push au personnel, qui n'a pas encore d'appareil enregistré : garder le tableau de bord ouvert.
