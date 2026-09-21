# Prompt 14. Étape 14 : conformité, sécurité, Loi 25, documents et suspensions (J12)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.11, 5.12, 5.15, 8 (en entier), 4.7 et 11.1 (étape 14). Consulte `docs/decisions.md`.

## Objectif
Fermer toutes les exigences de conformité et de sécurité de la V1 : échéances et suspensions automatiques des chauffeurs et véhicules, sanctions graduées proposées, droits des personnes et purges, registre des incidents de confidentialité, chiffrement des champs sensibles, durcissement de l'API et du web, analyse antivirus, audit complet.

## Tâches
1. Conformité des chauffeurs et véhicules : `compliance_checks` alimentés à partir des documents et du véhicule (calcul de l'échéance de vérification mécanique : 4 ans ou 80 000 km, puis annuelle ou 60 000 km, à partir de l'année modèle et du kilométrage déclaré et mis à jour), rappels J-30, J-7, J-1 (matrice de notifications), suspension automatique à l'échéance (statut `suspended` avec motif, retrait de la présence), réactivation automatique à l'approbation du nouveau document, inspection Neomoov trimestrielle (échéance, formulaire dans My Hub), écran chauffeur avec marche à suivre.
2. Sanctions graduées : calcul quotidien de la note glissante sur 50 courses, des annulations tardives sur 7 jours, des incidents ; propositions `warning`, `restriction`, `suspension` selon la section 5.11, via l'infrastructure des agents (agent qualité en mode `approval`, prompt et outils `proposeSanction`, `applySanction` sous approbation) ; la suspension définitive est réservée aux humains ; blocage immédiat sur SOS ou plainte de sécurité en attente de décision humaine ; endpoints et écran My Hub.
3. Loi 25 : vérification que consentements, versions de politique et retrait fonctionnent de bout en bout ; endpoints et écrans des droits (accès avec export JSON et PDF, rectification, suppression avec anonymisation, portabilité, retrait) avec suivi des délais dans `data_requests` ; tâches de rétention (positions brutes agrégées après 90 jours, trajets anonymisés après 12 mois, documents supprimés 12 mois après la fin de la relation, journaux 7 ans, factures 7 ans) journalisées dans `retention_jobs` avec horloge simulée en test ; registre des incidents de confidentialité dans My Hub avec modèle de notification ; module biométrique isolé et inactif (`FEATURE_FACE_CHECK`), gabarits chiffrés, documentation `docs/privacy/efvp.md` (canevas d'évaluation des facteurs relatifs à la vie privée : inventaire des données, finalités, fournisseurs hors Québec, mesures) à compléter par le fondateur.
4. Chiffrement applicatif : champs sensibles (numéros de taxes, numéros de documents, gabarits biométriques, jetons de fournisseurs) chiffrés avec `ENCRYPTION_KEY` (AES-256-GCM, clé dérivée, rotation documentée) ; masquage dans les journaux vérifié par test.
5. Durcissement : limitation de débit revue par endpoint, protection contre l'énumération des comptes, verrouillage progressif, en-têtes de sécurité web et CSP, cookies, CSRF, taille et types de fichiers, analyse antivirus des documents (ClamAV en conteneur ou service équivalent, avec simulation en test), dépendances auditées en intégration continue (échec sur vulnérabilité haute), secrets absents du dépôt (vérification automatisée par un outil de détection de secrets en intégration continue).
6. Audit : vérification que toute action administrative, financière et d'agent est journalisée ; endpoint de consultation filtrée pour `admin` ; export.
7. Transmission réglementaire : vérification de l'export de géolocalisation de l'étape 9 et du registre de redevance ; documentation `docs/compliance/checklist.md` reprenant la section 4.4.6 du document de référence avec l'état technique de chaque point.
8. Tests : parcours 11 et 22 de la section 9.2 ; tests des sanctions avec données synthétiques ; tests de rétention avec horloge simulée ; tests d'autorisation générés pour tous les endpoints (aucun endpoint sans test) ; analyse statique et audit de dépendances sans vulnérabilité haute.

## Contraintes
- Aucune suspension définitive ni suppression de compte chauffeur par automatisme.
- Les purges sont irréversibles : elles sont précédées d'une sauvegarde vérifiée et journalisées.
- Toute donnée biométrique reste inactive tant que le drapeau est fermé.

## Critères d'acceptation
- Un document expiré suspend le chauffeur à minuit et le nouveau document approuvé le réactive (test avec horloge simulée).
- Une demande de suppression de compte client est traitée : courses anonymisées, autres données effacées, facture conservée.
- Rapport de sécurité : aucune vulnérabilité haute, aucun secret détecté, 100 % des endpoints couverts par un test d'autorisation.

## Vérifications à exécuter et à montrer
Sortie des tests, rapport d'audit de dépendances, liste des endpoints avec leur test d'autorisation, extrait d'un `retention_job`.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 14 : conformité, sécurité, Loi 25 et suspensions ».
