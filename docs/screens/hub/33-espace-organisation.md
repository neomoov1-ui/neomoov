# Écrans de l'étape 21 : My Hub côté organisation (descriptions)

Les captures de `docs/screens/hub/` sont produites par les tests Playwright (`pnpm test:e2e:web`, fonction `shot`). L'API locale n'a pas pu tourner pendant le travail parallèle du 1er octobre 2026 : les écrans ci-dessous sont décrits, à capturer au prochain passage des tests web (noms proposés entre parenthèses).

| Écran | Chemin | Contenu |
|---|---|---|
| Connexion, onglet « Organisation » (`33-connexion-organisation`) | `/hub/connexion?espace=organisation` | Onglets « Personnel Neomoov » et « Organisation » ; téléphone, puis code reçu par texto ; un numéro sans compte renvoie au lien d'invitation |
| Tableau de bord de l'organisation (`34-organisation-tableau-de-bord`) | `/hub/organisation` | Sélecteur d'organisation (rôle affiché), invitation à la double authentification si une permission sensible l'attend ; cartes : courses du jour, en cours, terminées, montant du jour, planifiées, chauffeurs actifs, en ligne, en pause, relevés à venir et leur net, sous-organisations, membres |
| Menu selon les permissions (`35-organisation-menu-agent`) | `/hub/organisation` | Un agent « répartiteur lecture seule » ne voit que Tableau de bord, Courses, Chauffeurs, Véhicules et Sécurité du compte |
| Courses (`36-organisation-courses`) | `/hub/organisation/courses` | Vues À répartir, Planifiées, Récentes ; recherche, filtre d'état, pagination ; fiche d'une course (trajet, prix, chauffeur, étapes) |
| Membres (`37-organisation-membres`) | `/hub/organisation/membres` | Membres (rôle, portée, état ; changer de rôle, suspendre, retirer), invitations (en attente, acceptées, expirées, révoquées ; révoquer), « Inviter un membre » (téléphone ou courriel, rôle, portée), « Transférer la propriété » pour un propriétaire |
| Rôles (`38-organisation-roles`) | `/hub/organisation/roles` | Rôles système (lecture seule) et personnalisés ; création : catalogue par module, permissions non détenues grisées, avertissement des permissions sensibles choisies |
| Sous-organisations (`39-organisation-arbre`) | `/hub/organisation/sous-organisations` | Arbre ; « Nouvelle sous-organisation » sous n'importe quel nœud ; « Gérer » ouvre la sous-organisation dans l'espace |
| Journal (`40-organisation-journal`) | `/hub/organisation/journal` | Entrées de l'organisation et de ses descendantes, dont `support_access.*` |
| Accès du support, côté organisation (`41-organisation-acces-support`) | `/hub/organisation/support` | Demandes et accès (demandeur, motif, durée, état, période) ; Approuver, Refuser, Révoquer |
| Sécurité du compte (`42-organisation-double-authentification`) | `/hub/organisation/securite` | Inscription TOTP (QR, clé, premier code, codes de secours) ou vérification du code ; mêmes écrans que le personnel |
| Accès du support, côté plateforme (`43-plateforme-acces-support`) | `/hub/support` | Demande (organisation, durée, motif) ; liste ; « Ouvrir l'espace de l'organisation » pendant un accès en cours, avec le bandeau « Accès support en cours » ; « Mettre fin » |
