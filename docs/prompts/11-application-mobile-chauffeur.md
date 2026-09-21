# Prompt 11. Étape 11 : application mobile chauffeur (J8 et J9)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 6 (introduction et 6.2 en entier), 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.12, 7.2 (Chauffeur), 7.3, 2.8 et 11.1 (étape 11). Consulte `docs/decisions.md`.

## Objectif
L'application Neomoov Chauffeur, iOS et Android, complète pour la V1 : tous les écrans de la section 6.2, localisation en arrière-plan fiable, navigation externe, vérification faciale présente mais masquée derrière le drapeau.

## Tâches
1. Navigation : inscription (assistant par étapes avec reprise), accueil (statut, pack, revenus, prochaine course, alertes), onglets (Accueil, Courses, Revenus, Documents, Profil), plein écran pour l'offre et la course.
2. Écrans de la section 6.2 avec leurs critères : inscription (téléphone, identité, type de qualification, numéros TPS et TVQ, véhicule avec catégorie déduite du modèle, documents avec appareil photo et recadrage, statut par document), formation (modules vidéo, quiz, attestation ; blocage du passage en ligne sans attestation), compte Stripe Connect (parcours Express en webview, statut), modes de paiement acceptés, accueil, offre de course (sonnerie, vibration, compte à rebours de 15 secondes, accepter, décliner, contre-proposer si le drapeau est actif), navigation de course (étapes, bouton vers Google Maps ou Waze par lien profond avec repli sur l'application disponible, appel et message masqués, compteur d'attente, SOS, incident), fin de course (montant, mode de paiement, confirmation du montant reçu si paiement direct, évaluation du client), packs, revenus et relevés (PDF, statut du versement, chaque ligne renvoie à sa course), clients fidèles, courses planifiées (réserver, confirmer, rappels), tableau de conduite, documents et échéances (rappels, suspension avec marche à suivre), sécurité et support, profil (zones préférées, consentements, retrait de la géolocalisation avec conséquence expliquée), vérification faciale (module isolé sous `FEATURE_FACE_CHECK`, prise de photo et appel API, sans traitement local).
3. Localisation en arrière-plan : `expo-location` et `expo-task-manager`, tâche d'arrière-plan active uniquement en ligne, envoi toutes les 5 secondes ou 50 mètres sur le socket `/driver` avec file locale et renvoi par lot en cas de coupure, arrêt garanti hors ligne, consommation de batterie mesurée et documentée ; explications avant la demande de permission « toujours » ; justificatifs `NSLocationAlwaysAndWhenInUseUsageDescription` et déclaration Android.
4. Calcul de la conduite : capture des accélérations et freinages à partir des positions (agrégation côté serveur), affichage du tableau.
5. Notifications push : offres (canal prioritaire, son distinct), planifiées, relevés, documents, packs ; liens profonds.
6. Robustesse : fonctionnement avec l'écran verrouillé, reprise après redémarrage de l'application en cours de course (état restauré depuis l'API), mode économie de données, Sentry.
7. Accessibilité et i18n complets.
8. Tests : Maestro pour les parcours 2, 8, 10, 11 et 12 de la section 9.2 ; test de la tâche d'arrière-plan sur appareil réel documenté dans `docs/testing/background-location.md` ; captures dans `docs/screens/driver/`.
9. Configuration EAS : `com.neomoov.driver`, permissions, étiquettes de confidentialité dans `docs/store/driver.md`, notes de revue pour Apple et Google expliquant la localisation en arrière-plan avec vidéo de démonstration à produire par le fondateur.

## Contraintes
- Le chauffeur ne saisit rien au-delà d'un bouton pendant la conduite.
- Aucune position envoyée hors ligne ; test automatisé de cette règle.
- Aucun calcul financier dans l'application.

## Critères d'acceptation
- Parcours Maestro passés sur les deux plateformes.
- Une course complète réalisée par le fondateur sur son téléphone contre l'API locale ou de staging, avec positions visibles côté client et dans My Hub (étape 12) ou dans l'outil de test.
- Build EAS `preview` fonctionnel.

## Vérifications à exécuter et à montrer
Sortie des tests, captures, mesure de la fréquence des positions reçues côté API pendant 10 minutes, sortie du build.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 11 : application mobile chauffeur ».
