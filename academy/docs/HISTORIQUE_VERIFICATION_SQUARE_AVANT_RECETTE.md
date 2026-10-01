# Vérification Square — 29 septembre 2026

## État réellement constaté

- Compte Square connecté : Groupe NSK inc.
- Article créé : CAP CHAUFFEUR — Neomoov Academy, 99,00 CAD, type « Autre » (non physique).
- Lien du Tableau de bord créé et enregistré dans les paramètres Academy ; il n'est pas affiché aux visiteurs et n'est pas prêt à être diffusé.
- L'étape de paiement vérifiée après passage au type « Autre » ne demandait plus de livraison physique.
- La quantité du lien réutilisable reste modifiable : le lien ne satisfait donc pas encore le contrôle d'une commande individuelle à prix fixe.
- Les taxes sur ventes numériques et expéditions nationales sont désactivées dans Square. L'utilisateur a expressément refusé de modifier ce réglage global ; aucune modification de cette dérogation n'a été enregistrée.
- La taxe historique « TPS et TVQ » est à 15 %. Dans une simulation de facture à 99 CAD, elle était incluse dans le prix (12,91 CAD de taxe comprise). La simulation a été abandonnée sans sauvegarde ni envoi. La taxe historique est inchangée.
- L'utilisateur confirme l'inscription à la TPS et à la TVQ. Pour une vente taxable au Québec, le calcul cible est 99,00 + TPS 4,95 + TVQ 9,88 = 113,83 CAD. Ce total n'a pas encore été confirmé dans un checkout Square opérationnel.

## WordPress déployé

L'extrait Academy n°6 a été remplacé puis réactivé. Le mode Square manuel, le lien et le prix de 99 CAD sont enregistrés. La case d'ouverture des ventes reste décochée ; les conditions, le total fiscal et le délai ne sont pas encore configurés.

Un correctif empêche de présenter les champs Stripe dans le mode Square et valide le format des identifiants Stripe. Les anciennes valeurs invalides sont nettoyées sans afficher leur contenu. Les champs secrets utilisent `autocomplete="new-password"`. Aucun secret n'a été consulté ou inclus dans les fichiers livrés.

La version réellement déployée est sauvegardée dans `wordpress/neomoov-academy-en-ligne-square-manuel-20260929.php` et son export JSON homonyme. Les fichiers de développement peuvent contenir une intégration API plus récente : ne pas les confondre avec cette version en ligne.

## Vérifications réalisées

- Analyse syntaxique du PHP assemblé avec `php-parser` : réussie.
- Interface Code Snippets : état « Actif » confirmé après import.
- Interface Academy : mode Square manuel, prix 99,00 et lien enregistrés ; ventes fermées.
- Requêtes publiques sans authentification vers `/academy/`, `/academy/formation/` et `/academy/membre/` : HTTP 200, aucun texte « Fatal error », aucun lien Square provisoire exposé dans ces réponses.
- Accueil public chargé dans le navigateur après mise à jour.

Ces contrôles ne constituent pas un test de paiement, de webhook, d'envoi d'email ou d'attribution d'accès après paiement.

## Suite préparée

Une intégration API indépendante est en préparation locale pour créer une commande à quantité 1 et taxes explicites sans changer le catalogue ni les règles globales Square. La console développeur affiche un formulaire nommé « Neomoov Academy », mais la création de l'application et l'acceptation des conditions attendent l'accord de l'utilisateur. Aucun identifiant API n'a été créé pour cette intégration.

Le brouillon de conditions de vente est disponible dans `marketing/CONDITIONS_VENTE_PROPOSITION_SQUARE.html`. Les modalités proposées doivent être validées avant publication. Brevo reste à connecter et à tester.

**Aucun paiement réel, remboursement, facture envoyée, accès payant attribué ou campagne email déclenchée pendant ces vérifications.**

## Complément — facturation individuelle vérifiée

Après la première simulation, deux taxes dédiées ont été créées : `CAP CHAUFFEUR — TPS` (GST, 5 %) et `CAP CHAUFFEUR — TVQ` (QST, 9,975 %), toutes deux additives. Elles ne sont affectées à aucun article et l'application aux montants personnalisés est désactivée. Les dérogations fiscales globales et la taxe historique de 15 % restent inchangées.

Une nouvelle facture de préparation a été calculée en sélectionnant uniquement ces deux taxes sur la ligne CAP CHAUFFEUR, après désélection du taux historique pour cette facture : **99,00 + 4,95 + 9,88 = 113,83 CAD**. L'ébauche **000001** a été enregistrée sans client, avec une mention interne exigeant de compléter le client et les conditions validées avant envoi. L'interface confirme « Ébauches (1) », total 113,83 CAD. Aucun envoi n'a eu lieu.

Preuves : `square-facture-total-verifie.png` et `square-facture-ebauche-enregistree.png`. Procédure détaillée dans `wordpress/EXPLOITATION.md` et `wordpress/VERIFICATION_SQUARE_20260929.md`. Cette vérification de facture ne valide pas le lien public réutilisable ni la future intégration API.

## Déploiement API fermé et CGV — 29 septembre 2026
- Extrait ID6 remplacé et réactivé : état Actif vérifié dans WordPress.
- Prestataire Square API choisi. Mode Sandbox. Ventes décochées.
- Page de conditions publiée : https://neomoov.net/conditions-cap-chauffeur/ (WordPress1909).
- Version contractuelle configurée : CAP-2026-09-29-ECRIT-01.
- Établissement Sandbox : LTDXT8EAQ02B6.
- Token et signature non enregistrés : autorisation de transmission vers WordPress/LWS demandée, en attente.
- Webhook Sandbox préparé avec4événements, formulaire non enregistré.
- GET publics sans session : academy, membre, formation et conditions répondent200 ; aucune erreur PHP apparente. Membre/formation demandent la connexion. Ancien lien Square non exposé.
- Pas de paiement API exécuté. Pas de remboursement, email ou accès réel attribué.
- Revue en cours du correctif de contrat durable et emails transactionnels ; ce correctif n’est pas encore déployé.
- NEQ non confirmé : registre bloqué sur sa vérification de sécurité dans le navigateur. TPS/TVQ attendus de l’utilisateur.
