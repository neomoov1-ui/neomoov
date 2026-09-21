# Prompt 12. Étape 12 : My Hub et réservation web (J9 et J10)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 6.3, 6.4, 6.5, 7.2 (Admin, Public), 7.3 (`/admin`), 8 (web) et 11.1 (étape 12). Consulte `docs/decisions.md`.

## Objectif
L'application web complète : My Hub (tous les modules V1 de la section 6.3, avec les endpoints admin manquants côté API), la réservation web publique, la page de suivi partagé, la page d'inscription des chauffeurs et l'API publique limitée pour WordPress.

## Tâches
1. API : complète les endpoints admin de la section 7.2 qui n'existent pas encore (tableau de bord agrégé, listes filtrées et paginées de courses, chauffeurs, véhicules, clients, documents avec revue, tarifs et zones avec édition de polygones, packs, promotions, factures, incidents, sanctions, agents et approbations en lecture pour l'instant, rapports avec les indicateurs de la section 11.7 du document de référence, paramètres, utilisateurs et rôles, registre des incidents de confidentialité, demandes de droits) ; tous avec autorisation par rôle (`admin`, `operator`, `finance`, `readonly`) et audit ; endpoints publics `POST /v1/public/leads`, `POST /v1/public/quotes`, `GET /v1/public/track/{token}` avec clé publique à portée limitée, limitation de débit et protection anti-robots (Turnstile ou équivalent).
2. Web, connexion : courriel, mot de passe, second facteur obligatoire, codes de secours, sessions.
3. Modules My Hub, un par route, avec shadcn/ui et TanStack Query : tableau de bord temps réel (socket `/admin`, carte de la flotte avec filtres, alertes SOS et incidents, courses planifiées non confirmées) ; répartition et panneau opérateur (liste triée par pertinence, création d'une course pour client existant ou fiche minimale avec géocodage, attribution manuelle, réattribution, mise en attente, annulation, chronologie, chat) ; chauffeurs (liste, fiche complète, visionneuse de documents, validation ou rejet motivé, suspension et réactivation, notes) ; véhicules ; clients ; tarifs et zones (grille avec validités, suppléments, forfaits, éditeur de polygones sur carte, simulation de devis) ; packs et règlements (génération, aperçu, émission, versements, prélèvements, échecs, soldes, suspensions) ; promotions ; facturation et conformité fiscale (factures, état SEV, registres, exports, export de géolocalisation) ; incidents et sécurité (file, décisions, sanctions, registre de confidentialité) ; agents IA (liste, mode, file d'approbation, journal ; branchement complet à l'étape 13) ; rapports (indicateurs, courbes, exports CSV) ; paramètres (villes, drapeaux, gabarits, utilisateurs et rôles, clés masquées, versions de la politique de confidentialité).
4. Réservation web publique (`/reserver`) : responsive, intégrable en iframe sur les domaines autorisés, adresses, date et heure, catégorie, prix détaillé, coordonnées avec vérification SMS, paiement par carte (Stripe Elements) ou « payer au chauffeur », confirmation, suivi par lien ; page de suivi partagé (`/suivi/{token}`) ; page d'inscription des chauffeurs (`/chauffeurs`) avec préinscription ; page d'état d'une demande de droits.
5. Accessibilité WCAG 2.1 AA (navigation clavier, contrastes, libellés), i18n FR-CA et EN, en-têtes de sécurité (CSP compatible avec l'iframe de réservation sur domaines autorisés), Sentry.
6. Tests : Playwright pour les parcours 13, 16 et 17 de la section 9.2, la connexion 2FA, la création d'une course par l'opérateur, la validation d'un chauffeur, la génération d'un relevé, la réservation web ; tests d'autorisation par rôle sur chaque route.

## Contraintes
- Aucune donnée sensible affichée en clair (numéros de taxes partiellement masqués, méthodes de paiement masquées).
- Chaque action administrative est journalisée avec l'acteur.
- Les polygones de zones sont validés (fermés, sans auto-intersection) avant enregistrement.

## Critères d'acceptation
- Le fondateur peut, depuis My Hub : suivre la flotte, créer et attribuer une course par téléphone, valider un chauffeur, modifier un tarif avec date de validité, générer et émettre un relevé, consulter une facture et l'état SEV, décider un incident, approuver une action d'agent.
- Réservation web complète sans compte, suivi par lien fonctionnel.
- Tests Playwright verts.

## Vérifications à exécuter et à montrer
Sortie des tests Playwright, captures des modules principaux dans `docs/screens/hub/`, exemple d'appel de l'API publique.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 12 : My Hub, réservation web et API publique ».
