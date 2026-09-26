# Évaluation des facteurs relatifs à la vie privée (EFVP) : canevas

Loi 25, prompt 14 tâche 3. Ce canevas décrit ce que la plateforme traite et comment ; les cases marquées « À compléter » relèvent du responsable de la protection des renseignements personnels (le fondateur, jusqu'à désignation). Une EFVP est refaite pour tout nouveau système ou toute nouvelle communication de renseignements hors du Québec.

## 1. Responsable et portée

- Entreprise : Neomoov (groupe NSK Inc.). Responsable de la protection des renseignements personnels : **À compléter** (nom, titre, courriel publié sur le site).
- Systèmes couverts : API, applications client et chauffeur, My Hub, réservation web, agents IA, agent vocal, WhatsApp.

## 2. Inventaire des renseignements

| Catégorie | Personnes | Exemples | Finalité | Conservation |
|---|---|---|---|---|
| Identité et contact | Clients, chauffeurs, personnel | Nom, téléphone, courriel, langue | Compte, service, avis | Durée du compte ; anonymisés à la suppression |
| Courses | Clients, chauffeurs | Adresses, horaires, prix, préférences, messages | Service, facturation, sécurité | 12 mois en clair, puis anonymisées ; montants 7 ans |
| Positions | Chauffeurs | Positions toutes les 3 à 5 s en course ou en ligne | Répartition, suivi, sécurité | 90 jours en clair (agrégats ensuite) |
| Documents | Chauffeurs | Permis, antécédents, assurance, immatriculation | Qualification légale | 12 mois après la fin de la relation |
| Paiements | Clients, chauffeurs | Identifiants Stripe, 4 derniers chiffres, relevés | Paiement, versements | Factures et relevés 7 ans ; aucune donnée de carte chez Neomoov |
| Fiscalité | Chauffeurs | Numéros de TPS et TVQ | Factures, registres | Chiffrés ; 7 ans avec les factures |
| Biométrie | Chauffeurs | Gabarit de vérification faciale | Vérification d'identité | **Inactif** (`FEATURE_FACE_CHECK`) : aucune collecte tant qu'une EFVP propre n'est pas faite |
| Journal d'audit | Personnel, agents | Actions, acteur, date | Traçabilité | 7 ans |

## 3. Communications hors du Québec (fournisseurs)

| Fournisseur | Données | Lieu | Mesures | Évaluation |
|---|---|---|---|---|
| Supabase (base, stockage) | Toutes | Canada | Chiffrement au repos et en transit, accès restreint | À compléter |
| Stripe | Paiements, identité minimale | États-Unis, Canada | PCI DSS, jetons seulement | À compléter |
| Twilio | Numéros, textes des textos | États-Unis | Contenu minimal, pas de données sensibles | À compléter |
| Resend | Courriels, factures et relevés en pièce jointe | États-Unis | Contenu minimal | À compléter |
| Expo (push) | Jetons d'appareil, textes des avis | États-Unis | Textes courts sans données sensibles | À compléter |
| Meta (WhatsApp) | Numéros, messages | États-Unis | Seulement si le client écrit par WhatsApp | À compléter |
| Vapi et Anthropic (agents) | Transcriptions, messages, données minimisées | États-Unis | Minimisation, aucun numéro de carte ni document complet, contenus traités comme des données | À compléter |
| Google Maps | Adresses saisies | États-Unis | Aucune donnée d'identité | À compléter |

## 4. Mesures de protection

- Consentement manifeste et versionné (politique de confidentialité), retrait en tout temps ; consentements distincts pour la géolocalisation, le marketing et, en V2, l'enregistrement audio et vidéo à bord (conservé 30 jours, stockage canadien chiffré).
- Chiffrement applicatif AES-256-GCM des champs sensibles (numéros de taxes, numéros de documents, gabarits biométriques, jetons de fournisseurs), clé dérivée de `ENCRYPTION_KEY`, rotation documentée ; masquage des numéros dans les journaux et dans My Hub.
- Contrôle d'accès par rôles, second facteur du personnel, verrouillage progressif, journal d'audit en ajout seul.
- Analyse antivirus des documents, limites de taille et de type, liens signés de courte durée.
- Durées de conservation appliquées chaque nuit après sauvegarde vérifiée, chaque purge journalisée (`retention_jobs`).
- Demandes de droits suivies avec leur échéance légale (30 jours) dans My Hub.

## 5. Risques et décisions

| Risque | Gravité | Probabilité | Mesure | Décision |
|---|---|---|---|---|
| Fuite de positions | À compléter | À compléter | Conservation 90 jours, accès restreint | À compléter |
| Accès non autorisé à un document | À compléter | À compléter | Stockage privé, liens signés, antivirus, journal | À compléter |
| Agent IA qui divulgue une donnée | À compléter | À compléter | Minimisation, outils plafonnés, approbation humaine | À compléter |
| Transfert hors Québec | À compléter | À compléter | Section 3 | À compléter |

## 6. Signature

Évaluation approuvée par : **À compléter**, le **À compléter**. Prochaine révision : à chaque nouveau système ou fournisseur, et au plus tard dans un an.
