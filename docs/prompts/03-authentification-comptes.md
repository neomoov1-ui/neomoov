# Prompt 03. Étape 3 : authentification, comptes, rôles, appareils, consentements, audit (J2)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 4.1, 5.15, 7.1, 7.2 (groupe Auth), 8 et 11.1 (étape 3). Consulte `docs/decisions.md`.

## Objectif
Livrer le module d'identité complet de l'API : connexion par code SMS, Apple, Google, jetons courts avec rotation, rôles et autorisation par ressource, appareils et jetons push, consentements Loi 25 versionnés, demandes de droits, journal d'audit en ajout seul, second facteur pour My Hub.

## Tâches
1. `modules/auth` : `POST /v1/auth/otp/request` (numéro E.164, code à 6 chiffres haché, 5 minutes, 5 tentatives, limitation par numéro et par IP, envoi via `SmsProvider`, simulé en local avec code affiché dans les journaux de développement uniquement) ; `POST /v1/auth/otp/verify` (création du compte si nouveau, jetons) ; `POST /v1/auth/apple` et `POST /v1/auth/google` (vérification des jetons d'identité côté serveur, liaison au compte par téléphone vérifié) ; `POST /v1/auth/refresh` (rotation, détection de réutilisation, révocation de la famille de jetons) ; `POST /v1/auth/logout` ; sessions dans `sessions` avec appareil.
2. Jetons JWT d'accès de 15 minutes signés avec `JWT_ACCESS_SECRET`, jetons de rafraîchissement opaques hachés en base, 30 jours.
3. Autorisation : décorateurs de rôle et gardes de ressource (`OwnsRide`, `OwnsDriverProfile`, etc.), avec une politique par défaut de refus ; comptes de service pour les agents et intégrations (clés à portée limitée, table `api_keys` à ajouter si absente).
4. `GET /v1/me`, `PATCH /v1/me` (langue, nom, courriel), `POST /v1/me/devices` (jeton push, plateforme, version), `DELETE /v1/me` (suppression de compte selon la section 5.15 : anonymisation des courses, effacement du reste, file de traitement), `GET/POST /v1/me/consents` (finalités, versions, retrait), `POST /v1/me/data-requests` (accès, rectification, portabilité) avec génération asynchrone de l'export JSON et PDF via le worker et lien signé.
5. Second facteur pour les rôles `admin`, `operator`, `finance`, `readonly` : inscription TOTP (QR), vérification, codes de secours, obligatoire à la connexion sur My Hub ; connexion par courriel et mot de passe (argon2) réservée à ces rôles.
6. Journal d'audit : intercepteur qui enregistre toute action de mutation avec acteur, entité, avant et après (données sensibles masquées), IP, identifiant de corrélation ; table en ajout seul.
7. Limitation de débit globale (par utilisateur et par IP) et sur les endpoints sensibles ; en-têtes de sécurité ; masquage des données sensibles dans pino.
8. Tests d'intégration : parcours d'inscription complet, réutilisation d'un jeton de rafraîchissement détectée, accès interdit entre ressources de deux utilisateurs, 2FA obligatoire, consentements versionnés, suppression de compte.

## Contraintes
- Aucune donnée de mot de passe pour les clients et les chauffeurs (téléphone plus code, ou Apple, ou Google).
- Le code SMS n'apparaît jamais dans les journaux hors environnement local.
- Toute nouvelle variable dans `.env.example`.

## Critères d'acceptation
- Un client crée son compte et obtient ses jetons en moins de 60 secondes dans un test bout en bout d'API.
- Un test automatisé vérifie, pour chaque endpoint existant, qu'un rôle non autorisé reçoit 403.
- L'OpenAPI documente tous les endpoints avec les schémas Zod.

## Vérifications à exécuter et à montrer
Sortie des tests d'intégration, extrait du journal d'audit après une mutation, exemple de réponse d'erreur au format unique.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 3 : authentification, comptes, consentements et audit ».
