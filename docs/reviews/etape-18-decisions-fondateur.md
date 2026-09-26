# Étape 18 : décisions du fondateur du 26 septembre 2026

Revue de fin d'étape, 27 septembre 2026. Branche `etape-18-decisions`, fusionnée dans `main` après la suite complète de l'API.

## Ce qui est livré

| Décision | Contenu | Commit |
|---|---|---|
| D9 | Réservation jusqu'à 90 jours (réglages, textes des applications, test du préavis) | `8fe9dff`, `79d6056` |
| D3 | Transfert aéroport : annulation gratuite jusqu'à 1 heure avant ; frais annoncés justes par l'application (`airportTransfer`, délai dans `/v1/config`) | `ebb0fd4`, `6ad13bc` |
| Prix | Forfait aéroport Neo Premium à 48,20 $ ; veille prix : au moins 1 $ sous le moins cher d'Uber, de Lyft et du taxi (nouvelle référence taxi, migration 0016) | `79d6056` |
| Qualité | `quality.e2e` sous le délai de 120 s (réservations du test copiées en base) | `5422333` |
| D8 | Animal de compagnie en cage : Neo XL et Neo Prestige, supplément de 5,00 $ (migration 0017), préférence transmise au chauffeur, interrupteur dans l'application client | `6ad13bc` |
| D7 | Charte d'équité : note sur les 100 dernières courses qui comptent (exclusions, migration 0018), sécurité jamais sanctionnée, décision humaine même en mode automatique, réponse et appel du chauffeur (migration 0019), alertes 24 h et 4 h ouvrables, écrans chauffeur et My Hub | `2e60ee8`, `4cd6f53`, `f6b8553` |
| D10 | Garantie de ponctualité codée, désactivée jusqu'à la validation des montants | `5410c50` |

## Points vérifiés à la relecture

- Le tarif du chauffeur n'est jamais réduit : la remise d'alignement reste bornée aux frais de service ; le supplément animal va au chauffeur ; la garantie de ponctualité est financée par Neomoov.
- Idempotence : un seul crédit de ponctualité par course (verrou consultatif et référence), une seule demande ouverte par sanction (index unique partiel), une seule alerte par blocage ou par demande (marqueur au journal d'audit, en ajout seul).
- Confidentialité : le texte des réponses et appels des chauffeurs n'entre pas au journal d'audit.
- Compatibilité des applications déjà installées : `airportTransfer` et `airportFreeCancellationBeforeSeconds` sont facultatifs ; face à une API antérieure, l'application n'annonce jamais des frais inférieurs à ceux qui seront facturés.
- Base de développement : migrations 0016 à 0019 appliquées, réglages ajoutés (les données de départ ne réécrivent pas les réglages existants).

## Tests

- Domaine : 416 tests, couverture 100 %.
- Données de départ : 22 tests.
- API : suites touchées lancées une à une (devis 11, courses 9, qualité 3, équité 3, agents 13, notifications 5, droits 6, compte chauffeur 7, croissance 3 et 5), puis la suite complète avant la fusion (résultat dans le message de fusion).
- Applications : client 22, chauffeur 17, web 9 ; contrôle des types des quatre applications.

## Reste à faire ou à trancher

- Christopher : valider les montants de D10 (puis `punctuality.enabled` à vrai) ; dire qui absorbe l'écart au-delà des frais de service quand la cible « 1 $ sous la concurrence » n'est pas atteignable ; remboursement sur la carte plutôt qu'en crédit pour une course prépayée très en retard ; refus d'un animal par un chauffeur (allergie).
- Écrans : interrupteur « animal en cage » sur la réservation web et dans My Hub ; bouton « exclure une note » dans My Hub (l'API existe).
- Le rappel sous 4 heures des problèmes de compte ou de paiement passe par l'assistance (conversations escaladées) et n'est pas encore mesuré.
