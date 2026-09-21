# Neomoov : design des applications

Dossier du design de la plateforme Neomoov. Niveau interne. Créé le 22 septembre 2026.

| Fichier | Contenu |
|---|---|
| `01-analyse-reference-uber.md` | Ce que montrent les captures et relevés Uber du fondateur, ce que Neomoov en retient, le modèle des relevés, les écarts à arbitrer avec le cahier des charges |
| `02-prompts-claude-design.md` | Le prompt d'identité et les six prompts de lots d'écrans pour Claude Design |
| `canevas/project/` | Les sources des maquettes (une page `.dc.html` par écran et l'index `canvas.json`) |
| `canevas/outils/` | Le générateur des lots 2 : `lib.js` (composants communs), `lot2-client.js`, `lot2-chauffeur.js`, `lot2-autres.js` |

## Canevas en ligne

« Neomoov : design des applications » : https://claude.ai/artifact/EwhoGryiRhAWpzmR362u8z

Le canevas est privé : seul le compte du fondateur l'ouvre. Il ne contient que des écrans d'interface avec des données fictives. Il ne contient ni le document de référence, ni le modèle financier, ni aucune donnée des captures Uber.

## Charte appliquée

Planche de marque fournie par le fondateur le 22 septembre 2026 : titres en Montserrat Bold, textes en Nunito, bleu électrique, vert lime, gris anthracite, blanc, signature « Avancez vers demain. ».

Valeurs retenues : bleu électrique `#1485E0`, bleu électrique foncé `#0B5FB5` (actions sous texte blanc, pour un contraste suffisant), vert lime `#6CC04A`, gris anthracite `#2C3A4A`. **Ces valeurs sont relevées à l'œil sur la planche.** Elles seront recalées sur les fichiers du logo.

**Le logo est un emplacement provisoire** (barre en dégradé et mot « neomoov » en gras italique). Les images envoyées dans la conversation ne sont pas enregistrées sur le disque : déposer les fichiers du logo (PNG à fond transparent ou SVG, versions claire et sombre) dans `context/import/neomoov/identite/`.

## État au 22 septembre 2026 : 51 maquettes

| Page du canevas | Maquettes |
|---|---|
| Fondations | 1 : couleurs, typographie, boutons, états, mode sombre |
| Application client | 15 : accueil, carte, catégorie et prix, suivi, fin de course, code par texto, consentements, options, paiement, recherche de chauffeur, en course, réservations, historique, profil, assistance |
| Application chauffeur | 20 : accueil en ligne et hors ligne, offre, en route, attente, client à bord, fin de course en espèces, signalement, revenus, détail d'une course, répartition du paiement, courses planifiées, mes réservations, packs, documents, inscription, formation, tableau de conduite, sécurité, preuve de course |
| My Hub | 5 : tableau de bord, répartition, fiche d'un chauffeur, tarifs et zones, packs et règlements |
| Réservation web | 3 : réservation, suivi par lien, inscription des chauffeurs |
| Relevé hebdomadaire | 3 pages, format lettre, spécimen |
| Récapitulatif mensuel | 2 pages, format lettre, spécimen |
| Courriel et facture | 2 : courriel du vendredi, facture remise au client |

Toutes les valeurs affichées viennent du cahier des charges : grille tarifaire, exemple de contrôle à 31,56 $, forfaits aéroport, packs. Les relevés et la facture sont des spécimens dont les totaux sont justes.

Restent à dessiner (prompts 1 à 6) : recherche de destination, états vides et erreurs du client ; compte de versement, modes de paiement acceptés, arrêt en cours de route, clients fidèles, résumé de séance et profil du chauffeur ; huit modules de My Hub (véhicules, clients, promotions, facturation, incidents, agents IA, rapports, paramètres) et la connexion à deux facteurs ; étapes suivantes de la réservation web ; relevé à solde négatif, rapport trimestriel ; gabarits de notifications.

**Les maquettes n'ont pas été contrôlées à l'écran par Claude.** Seul l'équilibre des balises a été vérifié. Le premier regard est celui du fondateur : signaler tout débordement ou chevauchement.

## Modifier le canevas

Depuis le workspace Jarvis, demander à Claude : « Modifie la maquette X du canevas Neomoov ». Claude relit d'abord la version en ligne, car le fondateur peut l'avoir modifiée à la main dans l'éditeur. Pour régénérer un lot : `node canevas/outils/lot2-client.js`, puis publier les fichiers changés.
