# Neomoov : design des applications

Dossier du design de la plateforme Neomoov. Niveau interne. Créé le 22 septembre 2026.

| Fichier | Contenu |
|---|---|
| `01-analyse-reference-uber.md` | Ce que montrent les captures et relevés Uber du fondateur, ce que Neomoov en retient, le modèle des relevés, les écarts à arbitrer avec le cahier des charges |
| `02-prompts-claude-design.md` | Le prompt d'identité et les six prompts de lots d'écrans pour Claude Design |
| `03-questions-au-fondateur.md` | Les informations qu'il faut à Claude pour finir les applications |
| `canevas/project/` | Les sources des maquettes (une page `.dc.html` par écran et l'index `canvas.json`) |
| `canevas/outils/` | Le générateur des lots 2 et 3 : `lib.js` (composants communs, gabarit My Hub), `lot2-client.js`, `lot2-chauffeur.js`, `lot2-autres.js`, `lot3-mobile.js`, `lot3-hub.js` |

## Canevas en ligne

« Neomoov : design des applications » : https://claude.ai/artifact/EwhoGryiRhAWpzmR362u8z

Le canevas est privé : seul le compte du fondateur l'ouvre. Il ne contient que des écrans d'interface avec des données fictives. Il ne contient ni le document de référence, ni le modèle financier, ni aucune donnée des captures Uber.

## Charte appliquée

Planche de marque fournie par le fondateur le 22 septembre 2026 : titres en Montserrat Bold, textes en Nunito, bleu électrique, vert lime, gris anthracite, blanc, signature « Avancez vers demain. ».

Valeurs retenues : bleu électrique `#1485E0`, bleu électrique foncé `#0B5FB5` (actions sous texte blanc, pour un contraste suffisant), vert lime `#6CC04A`, gris anthracite `#2C3A4A`. **Ces valeurs sont relevées à l'œil sur la planche.** Elles seront recalées sur les fichiers du logo.

**Le logo est un emplacement provisoire** (barre en dégradé et mot « neomoov » en gras italique). Les images envoyées dans la conversation ne sont pas enregistrées sur le disque : déposer les fichiers du logo (PNG à fond transparent ou SVG, versions claire et sombre) dans `context/import/neomoov/identite/`.

## État au 22 septembre 2026 : 74 maquettes, les six prompts sont couverts

| Page du canevas | Maquettes |
|---|---|
| Fondations | 1 : couleurs, typographie, boutons, états, mode sombre |
| Application client | 18 : accueil, carte, catégorie et prix, suivi, fin de course, code par texto, consentements, options, paiement, recherche de chauffeur, en course, réservations, historique, profil, assistance, recherche de destination, état vide, aucun chauffeur disponible |
| Application chauffeur | 26 : accueil en ligne et hors ligne, offre, en route, attente, client à bord, fin de course en espèces, signalement, revenus, détail d'une course, répartition du paiement, courses planifiées, mes réservations, packs, documents, inscription, formation, tableau de conduite, sécurité, preuve de course, compte de versement, modes de paiement acceptés, arrêt en cours de route, clients fidèles, résumé de séance, profil |
| My Hub | 14 : tableau de bord, répartition, fiche d'un chauffeur, tarifs et zones, packs et règlements, véhicules, clients, promotions, facturation et taxes, incidents et sécurité, agents IA, rapports, paramètres, connexion à deux facteurs |
| Réservation web | 5 : réservation, suivi par lien, inscription des chauffeurs, étape 2 (catégorie et prix), confirmation |
| Relevé hebdomadaire | 4 : 3 pages du relevé normal, plus un relevé à solde négatif (prélèvement) |
| Récapitulatif mensuel | 3 : 2 pages du récapitulatif, plus le rapport trimestriel pour les déclarations de taxes |
| Courriel et facture | 3 : courriel du vendredi, facture remise au client, planche des gabarits de notifications (push, texto) |

Toutes les valeurs affichées viennent du cahier des charges : grille tarifaire, exemple de contrôle à 31,56 $, forfaits aéroport, packs, frais de service à 2,00 $, redevance à 0,90 $, seuil de suspension à 150 $. Les relevés, la facture et le rapport trimestriel sont des spécimens dont les totaux sont justes (le relevé à solde négatif donne −94,08 $ : 90,15 $ de crédits contre 184,23 $ de débits).

Rien ne reste des six prompts. Écrans qui ne seront dessinés qu'au moment de coder, parce qu'ils dépendent des réponses du fondateur ou de V1.1 : négociation encadrée, vérification faciale, comptes entreprises, flotte R-LuxeEV, module investisseurs.

**Les maquettes n'ont pas été contrôlées à l'écran par Claude.** Seul l'équilibre des balises a été vérifié. Le premier regard est celui du fondateur : signaler tout débordement ou chevauchement.

## Modifier le canevas

Depuis le workspace Jarvis, demander à Claude : « Modifie la maquette X du canevas Neomoov ». Claude relit d'abord la version en ligne, car le fondateur peut l'avoir modifiée à la main dans l'éditeur. Pour régénérer un lot : `node canevas/outils/lot2-client.js` (ou `lot3-mobile.js`, `lot3-hub.js`), puis publier les fichiers changés et `canvas.json`.
