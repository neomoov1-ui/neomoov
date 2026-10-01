# Square API — intégration et recette

État après déploiement et recette administrateur du **29 septembre 2026** : le paiement fictif a été reconnu, sa revue de facturation a été traitée et la commande a atteint **`sandbox_paid`**, sans accès réel, document de production ni email. Une nouvelle réconciliation a conservé les mêmes références. La case d’ouverture des ventes a été **décochée en fin de recette (`sales=false`)**.

La configuration des clés de production et l’envoi du test email au seul administrateur ont été soumis au propriétaire ; **son accord est encore en attente à cet état de référence**. Aucun paiement de production, remboursement ou parcours email de bout en bout n’est déclaré testé. Les preuves observées sont détaillées plus bas ; les autres contrôles restent des étapes à réaliser.

## Configuration de recette

Après installation sur un environnement de recette, ouvrir **Outils → Neomoov Academy**, choisir **Square API — commande individuelle Québec**, puis enregistrer avec les ventes fermées. Les champs API apparaissent uniquement dans ce mode.

Configurer le token serveur, l’établissement, la signature webhook, l’environnement Sandbox, l’URL HTTPS des conditions et leur version ; les conditions validées fixent désormais 12 mois calendaires d’accès, activation sous 24 h, remboursement sous 14 jours selon conditions et support sous 2 jours ouvrés. Les secrets restent côté serveur ; leurs champs sont toujours vides, en `new-password`, et leur remplacement exige une case explicite. Des constantes serveur peuvent toujours remplacer les valeurs secrètes/environnement/établissement.

L’URL webhook exacte est affichée : `/wp-json/neomoov-academy/v1/square-api`. Abonner `payment.created`, `payment.updated`, `refund.created`, `refund.updated`. La signature dépend de l’URL complète exacte et du corps brut. Cocher la validation de configuration et ouvrir les ventes uniquement pour la recette prévue. `nma_ready()` gouverne toute nouvelle création ; refermer les ventes conserve la vérification et la révocation des commandes existantes.

## Comportement implémenté

- Commande individuelle : **99,00 CAD + TPS 4,95 + TVQ 9,88 = 113,83 CAD**. Article ad hoc, quantité 1, taxes explicites ; aucune modification du catalogue ni des taxes globales. Montants relus avant redirection.
- Formulaire intégré à l’espace membre : connexion, nonce, pays/province CA/QC, conditions versionnées, durée choisie et délai affichés. La création est bloquée si le membre porte un autre historique de paiement, même une tentative encore en attente.
- Idempotence persistée avant appel et verrou commun aux prestataires. La commande, le membre et le paiement doivent correspondre côté serveur. Le retour navigateur ne donne aucun accès.
- Vérification via bouton membre, réconciliation administrateur ou webhook signé. Les notifications sont mises en file WP-Cron ; les erreurs transitoires sont reprises. En hébergement sans trafic, prévoir un déclencheur fiable de WP-Cron et surveiller sa file. Les boutons manuels fonctionnent indépendamment de ce déclencheur.
- Si Square ne fournit pas une facturation CA/QC : état **revue de facturation**, sans attribution automatique. L’administrateur consulte le membre, rapproche le paiement et les éléments de facturation, atteste avec une note puis relance la vérification API. Cette attestation ne remplace aucun contrôle de montant ni de paiement.
- En production vérifiée, accès attribué jusqu’à l’échéance calculée sur 12 mois calendaires (29 février ramené au dernier jour de février suivant). Un nouveau webhook ne prolonge pas cette durée. L’accès formation applique l’échéance côté serveur.
- Sandbox : état `sandbox_paid` uniquement, jamais `nma_paid=yes`. Réserver des membres de test distincts.
- Recette Sandbox réservée aux administrateurs (`manage_options`), y compris endpoint de création authentifié : visiteurs et membres ordinaires voient les ventes fermées, même si la case ventes est cochée. La synchronisation serveur et WP-Cron restent indépendants de la session administrateur.
- Remboursement total : marqueur durable et retrait de l’accès API correspondant. Remboursement partiel : accès conservé, sous réserve de la politique choisie. Les anciennes mutations Stripe/Square manuel ne peuvent pas écraser une commande API, même en attente.

## Paiement fictif du Developer Control Panel

La recette du 29 septembre 2026 a confirmé dans les réponses Square un paiement fictif `COMPLETED` de **113,83 CAD** (`amount: 11383` centimes), lié à la bonne commande et au bon établissement, avec un tender unique. Le panneau de test utilise cependant `source_type: EXTERNAL`, avec `external_details.type: CARD` et `external_details.source: Developer Control Panel`. Le premier contrôle de l’application refusait cette source et restait en attente, même si le panneau affichait un succès.

Le correctif déployé et relu accepte ce cas uniquement lorsque **toutes** les conditions sont réunies :

1. La configuration et la commande concordent sur l’environnement **sandbox**.
2. `source_type` est exactement **EXTERNAL**.
3. `external_details` est un tableau, son `type` est exactement **CARD** et sa `source` est exactement **Developer Control Panel** (casse et espaces compris).
4. Les contrôles existants de commande, membre, établissement, quantité, taxes, devise, total et statut **COMPLETED** restent satisfaits.

En **production**, les seules sources permises restent **CARD** et **WALLET** : cette exception EXTERNAL est refusée, même avec les détails du panneau. Elle ne remplace aucun contrôle de montant ni d’association et ne s’appuie jamais sur une simple redirection navigateur.

Après intégration, la relecture du même paiement a produit **`pending` → `billing_review`**. Une attestation des coordonnées **fictives CA/QC**, explicitement consignée dans le journal pour cette recette, puis la réconciliation ont produit **`sandbox_paid`**. Cette opération teste le circuit de revue ; elle ne vérifie pas la facturation d’un acheteur réel. Aucun nouveau paiement n’a été nécessaire pour résoudre l’état en attente.

Références de recette : commande `SfrhhoDeUjyHCTHb5CNZWhkdV9EZY`, paiement fictif `2ymbDct6sZpAPfeWCsRT9X6j3lGZY`. Aucun paiement réel n’est représenté par ces références. `Order OPEN` ne constitue pas, à lui seul, une erreur : le contrôle porte sur le paiement et ses associations.

Une réconciliation répétée a conservé le même paiement et la même commande. Les documents et les trois files d’email sont restés **absents, avec zéro tentative**, sans attribution réelle. Ne pas basculer cette commande Sandbox en production et ne pas contourner les gardes de messagerie pour tester un email.

L’échéance affichée pour cette commande est explicitement libellée **« Échéance simulée (aucun accès réel) »**. Les nouveaux outils administrateur permettent de prévisualiser séparément un contrat fictif et de préparer un email technique au seul compte administrateur. Ils ne réutilisent ni ne modifient la commande Sandbox ; le test email réel exige une confirmation dédiée et ne doit être déclenché qu’après accord explicite. Leur fonctionnement et leurs limites figurent dans `CONTRAT-LIVRAISON-RECETTE.md`.

## Écran de contrôle

Dans les réglages, section **Square API — état et réconciliation**, rechercher un ID membre pour consulter état, commande, paiement, environnement et journal. Le bouton relit Square. Si une revue de facturation existe, une attestation réservée à l’administrateur devient disponible. Elle est rattachée au paiement précis et journalisée. Aucun remboursement monétaire n’est exécuté par ce module.

Un changement de conditions/version interdit la reprise du lien depuis le formulaire. Les liens déjà obtenus auprès de Square doivent être traités explicitement si l’offre précédente est retirée ; une commande existante conserve les conditions et la durée acceptées. Pas de création automatique d’une nouvelle commande après remboursement : intervention support nécessaire.

## Contrôles complémentaires à effectuer

Le parcours de paiement/revue décrit ci-dessus est observé dans l’interface. La liste suivante reste le plan de vérification complémentaire et de non-régression : elle ne constitue pas une affirmation que tous ces cas ont été exécutés.

1. Compte Québec vierge : création, affichage exact des deux taxes et 113,83 CAD, paiement Sandbox, vérification et état `sandbox_paid` sans accès réel.
2. Double clic et timeout : même commande ; fermeture ventes : aucune nouvelle création ; champs modifiés côté client : aucun autre prix/quantité accepté.
3. Nonce/signature faux, commande d’un autre membre, historique Stripe/Square manuel en attente : refus sans mutation d’accès.
4. Facturation absente/hors Québec : revue ; attestation admin : nouvelle lecture API et journal ; aucune attribution sur simple retour navigateur.
5. Remboursement total, notification ancienne, paiement différé et webhook hors ordre : pas de réactivation ; erreurs API ou stockage : reprise/erreur, pas de confirmation mensongère.
6. Échéance d’accès atteinte : formation refusée ; nouvel événement : échéance inchangée. Vérifier la délivrabilité des emails et les conditions avant toute activation Production.

## Validation effectuée

**Observations après déploiement, rapportées par l’agent principal :** reconnaissance du paiement Sandbox et passage en revue de facturation ; attestation fictive CA/QC journalisée ; état `sandbox_paid` ; nouvelle réconciliation sans changement des identifiants ; documents/emails absents et zéro tentative. L’aperçu du contrat par POST administrateur a également généré ses **11 sections**, avec les bons identifiants du vendeur et montants fiscaux, sans erreur PHP. Il s’agit d’un aperçu explicitement fictif, sans envoi ni achat. Les ventes ont été refermées à la fin.

**Non validé par ces observations :** paiement de production, remboursement complet ou partiel, traitement automatique de bout en bout par webhook/WP-Cron, génération/persistance/remise d’un véritable contrat après achat, transport email et réception par le destinataire. Le test email dédié n’a pas été exécuté et les actions relatives aux clés de production attendent encore l’accord demandé au propriétaire.

Les versions précédentes ont passé l’analyse syntaxique des sources et de leur assemblage. Pour le correctif du panneau Sandbox : parseur PHP sans erreur ; matrice de **26 cas** évaluée sur l’AST du helper PHP effectivement écrit (acceptation exacte en Sandbox, refus en production, environnement inconnu, détails manquants, mauvaises sources/types/casse/espaces et maintien de CARD/WALLET). Les contrôles commande/montant/statut et la sortie Sandbox avant mutation d’accès sont également vérifiés statiquement.

Commande locale de cette matrice depuis la racine : `node .verification/square-source-tests.cjs`. Cet évaluateur de branche n’est **pas** un runtime PHP ou WordPress. Aucun nouveau paiement, email, fichier assemblé ou export n’est produit par ce test local. La recette authentifiée de l’interface décrite ci-dessus le complète, mais **la production n’est pas déclarée validée**.

Reconstruction depuis la racine du projet : `node livraison/wordpress/build-export.cjs` (ou le script Python équivalent si Python est installé). La proposition initiale conserve les références documentaires officielles ; le présent document décrit l’intégration courante.
