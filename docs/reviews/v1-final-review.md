**La V1 n'est pas prête pour une bêta avec des testeurs externes : aucune application n'est encore installable par un testeur (comptes Apple et Google, projets EAS) et les fournisseurs réels (textos, stockage des documents, surveillance) ne sont pas branchés. Le code, lui, est prêt pour une bêta fermée interne avec les fournisseurs simulés ; ce qui manque dépend de comptes et de décisions du fondateur, pas de développement.**

# Revue finale de la V1 (prompt 17.B)

Revue du 26 septembre 2026. Branche d'intégration `etape-17c-corrections` (corrections de la revue, sécurité `etape-17b-securite` et manuels `etape-17d-manuels` fusionnées), partie de `main` à `1d82ebe`. Revues détaillées en annexe : `v1-revue-A-donnees-regles.md` (données et règles), `v1-revue-B-ecrans-api-exploitation.md` (écrans, API, exigences non fonctionnelles, exploitation, magasins), `v1-securite-et-code.md` (sécurité et revue de code).

## 1. Tests

| Suite | Résultat |
|---|---|
| API (intégration, base de développement Supabase, fournisseurs simulés, un seul fichier à la fois) | 285 réussis, 5 ignorés (Stripe et Claude réels), 1 échec hors étape 17 : `quality.e2e` dépasse 120 s, y compris sur `main` avant la revue (la passe de l'agent qualité parcourt toutes les données de test accumulées dans la base de développement) ; à corriger à l'étape 18 |
| Domaine (couverture) | 397 tests, couverture 100 % (instructions, branches, fonctions, lignes) |
| Turborepo (compilation, types, tests unitaires, lint) | Tout vert sauf un test d'API (webhooks simulés en production), corrigé par `6891797` et vérifié seul |
| OpenAPI | 243 chemins |

Non joués dans cette revue : parcours Playwright et Maestro sur appareils, profil de charge complet (environnement isolé à créer), tests avec les vrais fournisseurs (clés absentes).

## 2. Conformité au cahier des charges

État initial de la revue A : 274 exigences de données et de règles, 206 conformes, 49 partielles, 15 absentes, 4 reportées. Revue B : 74 endpoints de la section 7.2 sur 82 conformes, 52 éléments d'écran sur 91.

Rendus conformes pendant la revue (principaux) : interruption d'une course en cours par l'exploitation (transition `incident`) ; aucune facture de frais non perçus ; rappel au chauffeur 90 minutes avant une réservation ; restriction de qualité gardée après la fin d'une suspension ; chauffeur restreint attribuable hors VIP, aéroport et entreprise (il recevait des offres qu'il ne pouvait pas accepter) ; avis de versement et alerte de règlement en échec ; alerte quotidienne de veille prix ; alerte d'annulations répétées d'un client ; textos d'approche et d'arrivée au passager d'un tiers ; attribution et départ d'une réservation par push, courriel et texto ; messagerie de la course depuis My Hub ; relevé réglé hors plateforme ; tests de l'enchaînement et de la restriction.

## 3. Corrections faites pendant la revue

| Commit | Correction |
|---|---|
| `75c26ec` | Interruption d'une course en cours par l'exploitation (incident, autorisation levée, avis) |
| `871829c` | Aucune facture de frais non perçus (course payée au chauffeur) |
| `be91b03` | La fin d'une suspension garde une restriction en cours |
| `7c0bf10`, `cb978d1` | Avis de versement au chauffeur, alerte de règlement en échec à l'exploitation |
| `fdf1435` | Jamais de retour silencieux aux simulateurs en production (`ALLOW_MOCK_PROVIDERS`) |
| `6e52e4f`, `554641b` | Prompts des agents inclus dans l'image de l'API |
| `f19b7a5` | Sauvegardes planifiées dès la préparation du serveur, 35 jours, restauration d'essai |
| `e6d5bc8` | Application chauffeur sans permission du micro |
| `900e7bf` | Rappel au chauffeur 90 minutes avant une réservation |
| `0433829` | Documentation OpenAPI fermée en production par défaut |
| `363203a` | Bouton « Appeler » masqué sans relais téléphonique |
| `3c0b6a7` | Alerte quotidienne de veille prix |
| `a51101b` | Textos d'approche et d'arrivée au passager d'un tiers |
| `c572362` | Alerte d'annulations et d'absences répétées d'un client |
| `57c390d` | Relevé réglé hors plateforme (migration 0015) |
| `f821df6` | `BOOKING_FRAME_ANCESTORS` transmise au build du web |
| `e116391` et suivants | Chauffeur restreint attribuable hors contexte premium, avis des réservations, messagerie My Hub |
| Branche `etape-17b-securite` | 14 corrections de sécurité et de montants (voir `v1-securite-et-code.md`) |
| Branche `etape-17d-manuels` | Manuels d'exploitation, magasins et bêta alignés sur le code (incohérences E1 à E25), liste des accès à fournir réécrite |

## 4. Sécurité

Voir `v1-securite-et-code.md` : 14 corrections (2 critiques : webhooks forgeables en production via les simulateurs, course gratuite après une annulation du chauffeur ; 12 élevées, surtout des montants faussés). Passe complémentaire de gravité moyenne et faible à prévoir avant le lancement commercial.

## 5. Manuels et magasins

Manuels : incohérences E1 à E25 corrigées, sauf limites connues écrites telles quelles. Magasins (revue B, partie 5) : 6 exigences satisfaites, 5 partielles, 10 manquantes, toutes liées aux comptes Apple et Google, à EAS et aux fiches.

## 6. Écarts restants, par gravité

### Bloquant pour une bêta externe (hors développement)

| Écart | Qui | Effort après accès |
|---|---|---|
| Comptes Apple et Google Play, projets EAS : aucun build installable | Fondateur | 3 h |
| Hébergement de l'API au Canada (latence HTTP au 95e centile de 2,3 s avec l'API en France et la base au Canada) | Décision du fondateur | 6 h |
| Clés Twilio (textos) et S3 (documents) ; sans elles, la production refuse de démarrer (garde `ALLOW_MOCK_PROVIDERS`) ou tourne en simulé déclaré | Fondateur | 1 h |
| Surveillance : Sentry et sonde externe | Fondateur | 1 h |
| Sauvegarde : premier essai de restauration sur le serveur | Fondateur (accès serveur) | 1 h |

### Avant le lancement commercial

Paiement par carte dans les écrans (Stripe réel) ; prépaiement Interac ; connexion Apple et Google dans les applications (ou décision de la retirer) ; performances (allers-retours, index, environnement de préproduction) ; politique de sécurité du contenu avec nonces ; analyse statique et mises à jour des dépendances ; accessibilité automatisée ; clés étrangères manquantes ; conformité (60 000 km, renouvellement des antécédents) ; critères de recrutement ; table `feature_flags` à brancher ou retirer ; raison sociale et numéros de taxes sur les factures ; test d'intrusion.

### V1.1 et au-delà

Négociation côté client (après avis juridique), lots de courses, paiement échelonné, relais d'appel masqué, suivi de vol, épinglage de certificat ; amendement v1.2 (organisations, sous-comptes, permissions fines, marque blanche, flotte, Pilote).

## 7. Décisions du fondateur

Hébergement de l'API au Canada ; option Priorité × 1,15 (données) ou × 1,25 (cahier) ; raison sociale et numéros de TPS et TVQ de l'entité qui facture ; échéances des réservations (90 et 60 minutes de l'amendement, ou 60 et 30 du cahier) ; pack actif obligatoire ; prépaiement Interac ; moment de l'autorisation de la carte ; connexion Apple et Google ; politique d'annulation des réservations (le site en affichait deux) ; étiquette `v1.0.0-beta.1` (non posée : elle déclencherait une publication). Décisions du mandat du 26 septembre : synthèse confidentielle, décisions D1 à D13.
