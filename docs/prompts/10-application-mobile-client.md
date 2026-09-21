# Prompt 10. Étape 10 : application mobile client (J7 et J8)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 6 (introduction et 6.1 en entier), 5.1, 5.2, 5.3, 5.6, 5.10, 5.15, 7.2, 7.3, 2.8 et 11.1 (étape 10). Consulte `docs/decisions.md` et l'OpenAPI de l'API (`/v1/docs`) pour générer le client dans `packages/api-client` si ce n'est pas déjà fait.

## Objectif
L'application Neomoov pour les clients, iOS et Android, complète pour la V1 : tous les écrans de la section 6.1, la négociation présente mais masquée derrière le drapeau, prête pour TestFlight et le test interne Google Play.

## Tâches
1. Génère ou mets à jour `packages/api-client` depuis l'OpenAPI (client typé, gestion des jetons et du rafraîchissement automatique, file hors ligne pour les évaluations et messages).
2. Navigation Expo Router : pile d'accueil et connexion, onglets (Réserver, Réservations, Historique, Profil), modales (choix de catégorie, mode de paiement, préférences, tiers, arrêts, partage, assistance).
3. Écrans, dans l'ordre de la section 6.1, avec les critères d'acceptation comme tests Maestro : accueil et connexion (téléphone et code, Apple sur iOS, Google), consentements, carte et réservation (position, autocomplétion Places, lieux enregistrés, maintenant ou planifier), choix de catégorie et prix (détail dépliable identique au centime à l'API, options recalculant le devis), négociation (composant complet, affiché seulement si le drapeau distant est actif), mode de paiement (Stripe React Native : carte, Apple Pay, Google Pay ; Interac, espèces, terminal), recherche de chauffeur, chauffeur attribué et suivi (socket `/client`, position toutes les 2 à 5 secondes, appel et message masqués, partage, bouton d'urgence, annulation avec frais annoncés), en course, fin de course (prix final, pourboire, évaluation, favori), réservations planifiées, historique et reçus (PDF), profil et préférences (dont suppression de compte, consentements, droits, code de parrainage, crédits), assistance (conversation avec l'agent, escalade, téléphone).
4. Notifications push : enregistrement du jeton, réception en avant-plan et arrière-plan, liens profonds vers la course.
5. Localisation « lors de l'utilisation » seulement, avec explication avant la demande système.
6. Accessibilité : étiquettes, contraste, taille de police dynamique, ordre de focus ; i18n complet FR-CA et EN, aucun texte codé en dur.
7. Robustesse : états de chargement et d'erreur sur chaque écran, reprise après perte de réseau, bascule sur rafraîchissement HTTP si le socket est indisponible, gestion des sessions expirées, Sentry.
8. Tests : composants critiques (détail de prix, sélecteur de catégorie), tests Maestro des parcours 1, 3, 4, 5 et 6 de la section 9.2 contre l'API locale avec fournisseurs simulés ; captures d'écran des écrans principaux dans `docs/screens/client/`.
9. Configuration EAS : profils, identifiant `com.neomoov.client`, icône et écran de démarrage, versions, permissions déclarées avec les justificatifs, étiquettes de confidentialité préparées dans `docs/store/client.md`.

## Contraintes
- L'application n'effectue aucun calcul de prix : elle affiche le détail renvoyé par l'API.
- Aucune clé secrète dans l'application : uniquement la clé publique Stripe et les clés cartographiques restreintes par plateforme.
- Aucun texte en dur ; aucune couleur hors du thème de `packages/mobile-core`.

## Critères d'acceptation
- Les parcours Maestro passent sur simulateur iOS et émulateur Android.
- Démarrage en moins de 3 secondes jusqu'à l'accueil sur un appareil de milieu de gamme.
- Le build EAS `preview` s'installe et fonctionne contre l'API de staging (quand elle existera, sinon locale via tunnel).

## Vérifications à exécuter et à montrer
Sortie des tests Maestro, captures d'écran, sortie du build EAS `preview` (ou de la commande de build si les comptes ne sont pas encore prêts).

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 10 : application mobile client ».
