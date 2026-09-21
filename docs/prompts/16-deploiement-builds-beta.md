# Prompt 16. Étape 16 : déploiement, builds, documentation d'exploitation, bêta fermée (J13 et J14)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 10 (en entier), 3.5, 3.6, 2.1 et 11.1 (étape 16). Consulte `docs/decisions.md`. Les identifiants des services d'hébergement sont dans `.env` et dans les variables des services ; ne les affiche jamais.

## Objectif
Mettre la V1 en ligne : staging et production sur Railway et Vercel, builds mobiles EAS distribués sur TestFlight et en test interne Google Play, documentation d'exploitation complète, plan de migration vers l'hébergement canadien, et lancement de la bêta fermée.

## Tâches
1. Railway : services `api` (2 instances), `worker`, PostgreSQL `postgis/postgis:16-3.4` avec volume, Redis ; variables d'environnement par service (staging et production séparés) ; domaines `api-staging.neomoov.net` et `api.neomoov.net` ; migrations exécutées avant démarrage avec verrou ; sauvegardes quotidiennes automatiques vers le stockage objet chiffré ; vérification de santé et redémarrage automatique. Utilise l'outil en ligne de commande Railway déjà installé.
2. Vercel : `apps/web` sur `hub-staging.neomoov.net`, `hub.neomoov.net`, `reserver.neomoov.net` ; variables ; en-têtes ; prévisualisations par branche.
3. GitHub Actions : déploiement automatique sur staging à chaque fusion dans `main`, déploiement en production par déclenchement manuel avec approbation, builds EAS déclenchés par étiquette de version, notes de version générées.
4. EAS : profils `preview` (staging) et `production`, identifiants et certificats iOS et Android (les comptes Apple et Google doivent exister ; sinon documente précisément ce qui manque et prépare tout le reste), soumission à TestFlight et au test interne Google Play, mises à jour à la volée configurées pour le JavaScript uniquement, versions et numéros de build gérés.
5. Magasins : `docs/store/client.md` et `docs/store/driver.md` complétés (descriptions FR et EN, captures, étiquettes de confidentialité, justificatifs de localisation, comptes de démonstration, notes de revue, liens vers la politique de confidentialité et la suppression de compte) ; liste de vérification de soumission.
6. Documentation d'exploitation `docs/runbooks/` : redémarrer un service, restaurer une sauvegarde, régénérer un relevé, forcer une réattribution, désactiver un drapeau, rotation d'un secret, réponse à un incident de confidentialité, mode dégradé, publication d'une nouvelle version mobile, procédure de bêta (inviter, collecter les retours, trier) ; `docs/operations/daily.md` (journée type d'exploitation pour le fondateur : ce qu'il regarde, ce qu'il valide, où).
7. Plan de migration canadienne `docs/operations/migration-canada.md` : architecture cible (AWS Montréal ou Google Cloud Montréal), étapes, fenêtre de maintenance, réplication et bascule, tests, retour arrière, estimation de coût mensuel ; pas d'exécution dans le sprint.
8. Bêta fermée : compte de test créés, invitations TestFlight et Google Play pour 10 chauffeurs et 30 clients (liste fournie par le fondateur), formulaire de retour intégré dans les applications (écran Assistance) et canal de collecte, tableau de suivi des retours dans `docs/beta/`.
9. Répétition générale : exécute sur staging une journée d'exploitation simulée avec le jeu de données de l'étape 15 et documente le résultat.

## Contraintes
- Les secrets de production ne sont jamais copiés dans un fichier du dépôt ni affichés.
- La production ne reçoit que des versions étiquetées ayant passé l'intégration continue et les tests de bout en bout sur staging.
- Toute commande destructive (réinitialisation de base, suppression de service) exige une confirmation explicite du fondateur.

## Critères d'acceptation
- `GET https://api-staging.neomoov.net/v1/health` et `hub-staging.neomoov.net` répondent ; My Hub accessible avec 2FA.
- Builds installés sur au moins un iPhone et un Android via TestFlight et test interne (ou, si les comptes ne sont pas encore validés, builds `preview` installables par lien et liste exacte des actions restantes).
- Sauvegarde automatique visible dans le stockage et restauration testée sur staging.
- Manuels d'exploitation relus et validés par le fondateur.

## Vérifications à exécuter et à montrer
Sortie des déploiements, résultat des sondes de disponibilité, liste des builds EAS, arborescence de `docs/runbooks/`, compte rendu de la répétition générale.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 16 : déploiement, builds, exploitation et bêta fermée », étiquette `v1.0.0-beta.1`.
