# Neomoov Academy

Formation des chauffeurs de l'écosystème Neomoov. Premier produit : **CAP CHAUFFEUR**, formation écrite vendue par
Neomoov (marque de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.) aux chauffeurs taxi et VTC, futurs chauffeurs,
exploitants et futurs investisseurs de Montréal.

| | |
|---|---|
| En ligne | https://neomoov.net/academy/ (quatorze routes, dont `/academy/chauffeur-pro/` et `/academy/attestation/`) ; conditions : https://neomoov.net/conditions-cap-chauffeur/ |
| Offre | 99 $ + TPS 4,95 $ + TVQ 9,88 $ = 113,83 $ ; 7 modules écrits avec exercices corrigés, quiz (5 questions, 4 bonnes réponses pour valider) et sources officielles ; attestation de suivi vérifiable par code ; 8 fiches pratiques (gratuites) ; application Neomoov Chauffeur Pro (version web, ex-compagnon web) ; accès 12 mois ; activation sous 24 h ; remboursement sur 14 jours |
| Hébergement | WordPress de neomoov.net chez LWS : extrait Code Snippets **n° 6** « Neomoov Academy CAP CHAUFFEUR » (application PHP autonome, routes `/academy/…`) |
| Paiement | Square API en production (compte Groupe NSK inc., CAD), webhook `https://neomoov.net/wp-json/neomoov-academy/v1/square-api` (distinct du webhook de la plateforme) |
| Courriels | WordPress (contrat, activation) ; Brevo (listes 3 à 6, 28 modèles, quatre scénarios **inactifs**) |
| État | Pages en ligne et contrôlées ; vente ouverte mais jamais testée de bout en bout en réel ; vidéos non produites (scripts à réécrire pour les nouveaux modules) ; Neomoov Chauffeur Pro en version web seulement |

## Contenu de ce dossier

- `livraison/wordpress/` : sources du code (routeur `neomoov-academy.php`, `formation-attestation.php` pour les modules,
  les quiz, l’attestation et la fiche de vérification, `square-checkout-api.php`,
  `contract-delivery.php`, `brevo-sync.php`, `brevo-templates.php`, `academy.css`) et `build-export.cjs`.
- `livraison/formation/modules/m1.json` à `m7.json` : source des sept modules (texte, exercice, quiz, sources) ;
  `node outils/lot2-modules.cjs` les intègre à `livraison/formation/data.json`, qui porte aussi les huit fiches.
- `livraison/marketing/` : source des 28 courriels Brevo.
- `docs/` : livre de reprise du développeur précédent, état de livraison, recettes, notes d'architecture et de
  parcours, conditions de vente, **révision du 1er octobre 2026** (`REVISION_2026-10-01.md`).
- `outils/` : inventaire, sauvegarde et déploiement de l'extrait dans WordPress (accès par `wp.js` des outils du site,
  identifiants dans le `.env` de ces outils, jamais affichés).

Aucun secret ici : les clés Square et Brevo sont dans les réglages privés de WordPress (`nma_settings`).

## Modifier et déployer

1. Corriger les sources (`livraison/…`), puis assembler depuis ce dossier : `node livraison/wordpress/build-export.cjs`
   (produit `neomoov-academy-ready.php`, ignoré par Git).
2. Vérifier la syntaxe avec PHP 8.3 (conteneur jetable sur le serveur Neomoov :
   `docker run --rm -v /tmp/nma.php:/w/nma.php:ro php:8.3-cli php -l /w/nma.php`).
3. Sauvegarder l'extrait en ligne : `node outils/academy-sauvegarde.cjs`.
4. Déployer avec retour arrière automatique :
   `node outils/academy-deployer.cjs livraison/wordpress/neomoov-academy-ready.php <sauvegarde.php>` (contrôle des quatorze
   adresses ; restauration si une page n'est pas saine).
5. Ne jamais garder deux extraits actifs du routeur.
6. Le déploiement vide ensuite le cache du serveur LWS pour les pages publiques (route `cache/purge`, administrateurs
   seulement) ; en cas de modification hors de l’outil, l’appeler à la main.

## Exploitation

- WP-Cron est déclenché toutes les cinq minutes depuis le serveur de la plateforme (`/etc/cron.d/neomoov-wpcron`) :
  file des webhooks Square, courriels et synchronisation Brevo.
- Les états de paiement, le contrat, les règles Brevo et la matrice de tests sont décrits dans
  `docs/LIVRE_DE_REPRISE_CAP_CHAUFFEUR.md`.

## Feuille de route

Voir `docs/REVISION_2026-10-01.md` : lot 2 livré le 1er octobre 2026 (section 6) ; restent la recette de vente réelle (lot 3), la performance
(lot 4), intégration à la plateforme Neomoov (lot 5 : lien avec la préinscription des chauffeurs, puis formation dans
l'application chauffeur).
