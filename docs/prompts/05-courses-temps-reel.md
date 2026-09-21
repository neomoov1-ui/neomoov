# Prompt 05. Étape 5 : courses et temps réel (J3 et J4)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.2, 5.3, 5.10, 5.14 (pour les événements à émettre, sans encore envoyer de notifications externes), 7.2 (Courses, Chauffeur : statut, position, courses), 7.3 et 11.1 (étape 5). Consulte `docs/decisions.md`.

## Objectif
Le cœur opérationnel : création et cycle de vie des courses avec la machine à états de l'étape 2, réservation planifiée, présence et positions des chauffeurs en temps réel, diffusion Socket.IO, messagerie masquée, partage de trajet, SOS. La répartition automatique vient à l'étape 6 : ici, l'attribution se fait par un endpoint interne (utilisé par l'opérateur et par les tests).

## Tâches
1. `modules/rides` : `POST /v1/rides` (à partir d'un devis valide, avec `Idempotency-Key`, mode de paiement, préférences, tiers, favori demandé, type immédiat ou planifié), `GET /v1/rides/{id}`, `GET /v1/rides` (historique paginé), `POST /v1/rides/{id}/cancel` (application des règles de frais d'annulation de la section 5.2 : gratuit dans les 120 s après attribution, 500 cents ensuite, 700 cents pour non-présentation ; les montants viennent de `settings`), `POST /v1/rides/{id}/rate`, `POST /v1/rides/{id}/share` (lien public signé, page à l'étape 12), `POST /v1/rides/{id}/messages` (messagerie masquée, stockée, relayée en temps réel), `POST /v1/rides/{id}/sos` (crée un incident de gravité maximale et émet une alerte admin).
2. Endpoints chauffeur de déroulé : `arrive`, `start`, `complete` (calcul du prix final : attente au-delà de 300 s à 50 cents par minute, arrêts, dans la limite du prix maximal consenti ; le paiement et la facture sont branchés aux étapes 7 et 9 via des événements de domaine), `no-show` (après 300 s d'attente et deux tentatives de contact enregistrées), `cancel` (avec motif ; déclenche l'événement de réattribution consommé à l'étape 6).
3. Événements de domaine (`RideRequested`, `RideAssigned`, `RideCompleted`, etc.) publiés sur un bus interne et journalisés dans `ride_events` ; les étapes suivantes s'y abonnent.
4. Présence et positions : namespace Socket.IO `/driver` avec authentification par jeton ; `status.update` (online, offline, paused, avec vérification des prérequis : documents valides, véhicule conforme, pack ou renouvellement, solde non bloquant, sinon refus motivé) ; `location.update` toutes les 5 secondes ou 50 mètres, écrit dans l'index GEO Redis et dans `driver_locations` (écriture par lots) ; expiration de la présence après 60 secondes sans position ; `POST /v1/driver/location` en secours.
5. Namespace `/client` : abonnement à une course, réception de `ride.updated` et `driver.location` (position du chauffeur attribué seulement), `message.received`, `offers.updated` (réservé à l'étape 6). Namespace `/admin` : `ride.updated` pour toutes les courses, `driver.presence`, `alert.new`.
6. Réservation planifiée : création jusqu'à 30 jours, minimum 30 minutes ; table `scheduled_assignments` ; tâches planifiées du worker : rappel J-1 (événement), déclenchement de l'attribution à 60 minutes (événement consommé à l'étape 6), alerte opérateur si non confirmée à 30 minutes ; endpoints chauffeur `GET /v1/driver/scheduled`, `claim`, `confirm`.
7. Endpoint interne d'attribution `POST /v1/admin/rides/{id}/assign` (chauffeur forcé) et `POST /v1/admin/rides` (création par l'opérateur avec fiche minimale) ; les autres endpoints admin de courses viennent à l'étape 12.
8. Trace de course : enregistrement des positions pendant `in_progress`, simplification, distance et durée mesurées (`ride_tracks`).
9. Tests : machine à états sur toutes les transitions par endpoint, frais d'annulation, attente, non-présentation, socket (deux clients de test : positions reçues en moins de 2 secondes), planifiées avec horloge simulée, SOS.

## Contraintes
- Une course ne change d'état que par la machine à états ; aucune mise à jour directe du champ `status`.
- Toute transition enregistre l'acteur et est idempotente (rejouer la même transition ne crée pas de doublon).
- Positions : jamais exposées à un client autre que celui de la course en cours.

## Critères d'acceptation
- Un scénario d'intégration complet : devis, demande, attribution forcée, en route, arrivé, en cours, terminé, évaluation, avec événements et messages temps réel vérifiés.
- Scénario d'annulation dans et hors fenêtre gratuite, non-présentation.
- Scénario planifié avec horloge simulée : rappel J-1, déclenchement à 60 minutes, alerte à 30 minutes.
- Test de charge léger : 200 sockets chauffeurs envoyant une position toutes les 5 secondes pendant 2 minutes sans perte.

## Vérifications à exécuter et à montrer
Sortie des tests, extrait de `ride_events` d'une course complète, latence mesurée de diffusion d'une position.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 5 : courses, réservation planifiée et temps réel ».
