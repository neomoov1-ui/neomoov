# Notes internes — Publication des conditions CAP CHAUFFEUR

Document interne du 29 septembre 2026. Ne pas publier ce fichier.

## Choix commerciaux validés

99 $ CA avant taxes ; TPS 5 % et TVQ 9,975 % pour la vente taxable au Québec, total 113,83 $ CA ; première édition écrite de 7 microleçons et 8 fiches ; douze mois calendaires à compter de l’activation effective ; activation sous 24 heures après confirmation du paiement ; remboursement intégral sur demande dans les 14 jours suivant l’activation, traité sur le moyen d’origine sous 14 jours ; première réponse du support sous 2 jours ouvrés ; série vidéo exclue de cette vente.

Ces points ne sont plus présentés comme des propositions dans les textes publics préparés.

## Fichiers locaux et publication confirmée

- `CONDITIONS_CAP_CHAUFFEUR_PUBLICATION.md` : texte éditable des conditions.
- `CONDITIONS_CAP_CHAUFFEUR_WORDPRESS.html` : fragment HTML sémantique à insérer dans une page WordPress, sans thème complet ni script.
- `CONDITIONS_CAP_CHAUFFEUR_APERCU.html` : aperçu autonome lisible et imprimable pour revue.
- `BLOC_OFFRE_CAP_CHAUFFEUR_WORDPRESS.html` : récapitulatif de l’offre et lien vers les conditions, à insérer sur la page de vente.

Les conditions sont publiées sur **https://neomoov.net/conditions-cap-chauffeur/** : page WordPress indépendante **ID 1909**, mise en ligne le **29 septembre 2026 à 14 h 27 EDT**, heure de Montréal. Cette publication a été confirmée par le responsable de l’intégration ; les fichiers locaux sont conservés pour référence et mise à jour.

## Identité confirmée par le site officiel

Le responsable de l’intégration a lu dans les mentions légales publiques de Neomoov la formulation explicite selon laquelle Neomoov est une marque de **GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.** Cette identité est cohérente avec le nom affiché dans Square. Les textes finaux identifient désormais cette société comme vendeur et Neomoov comme marque ; l’avertissement d’ambiguïté a été retiré.

Source primaire : https://neomoov.net/mentions-legales/ . Coordonnées reprises : **204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8, Canada ; contact@neomoov.net ; +1 367 763-9063**. Constat transmis et intégré le 29 septembre 2026.

## Identifiants du vendeur

- Identifiants fiscaux **fournis par l’utilisateur** : **TPS/TVH 755212438 RT0001 ; TVQ 1233281863 TQ0001**. Ces numéros sont repris dans les documents du vendeur ; aucune vérification indépendante auprès de Revenu Québec n’est déclarée.
- **NEQ vérifié : 1181499600.** Fiche officielle du Registraire consultée directement par le responsable de l’intégration le **29 septembre 2026 à 14 h 39 EDT** : Groupe Nouveau Système Kardinal (Groupe NSK) Inc., 204 rue Saint-Sacrement, Montréal, H2Y 1W8 ; statut **Immatriculée**. Preuve locale : `livraison/neq-groupe-nsk-verifie.png`. Le numéro est repris comme information d’identification du vendeur dans les textes, sans reproduire la fiche du registre.

Les textes publics préparés comprennent le NEQ vérifié et les deux identifiants fiscaux fournis par l’utilisateur. Les faire figurer sur les justificatifs fiscaux applicables.

## État du paiement et de la publication

Application Square « Neomoov Academy » créée avec autorisation. Facture technique **000001**, total **113,83 $ CA**, conservée en **ébauche et non envoyée**. Aucun paiement réel ou test API n’est déclaré réussi. La création de l’application ne signifie pas que ses paramètres, ses autorisations et son intégration ont été vérifiés. Les ventes publiques restent fermées. Les paramètres fiscaux globaux Square ne doivent pas être modifiés.

La publication des conditions est **confirmée**, comme indiqué ci-dessus ; cela ne valide pas le paiement ou l’accès automatique. Brevo n’est pas confirmé connecté ; les séquences restent à intégrer et à tester.

## Mise en œuvre correspondant au texte

1. L’accès commence à la confirmation **effective de l’activation**, avec une date d’expiration égale à douze mois calendaires. Consigner les deux dates et les envoyer au client.
2. L’engagement de 24 heures porte sur l’activation et sur la remise de la copie durable du contrat après confirmation du paiement. Il s’agit d’heures consécutives ; le support sous deux jours ouvrés ne permet pas de dépasser ce délai.
3. Avec chaque facture individuelle, joindre **avant paiement** le récapitulatif, les conditions datées et la description des contenus. Après paiement, envoyer dans les 24 heures la copie définitive du contrat et la confirmation d’accès. Un lien vers une page modifiable ne remplace pas la copie conservable de la version acceptée.
4. La facture et le contrat individuel doivent porter les données du vendeur/client, la référence et date de commande, le prix/taxes/total, la liste de livraison, les dates d’accès et les modalités de remboursement. Une facture Square ne contient pas nécessairement à elle seule tous ces éléments.
5. Configurer et vérifier la possibilité de rembourser sur le moyen d’origine. L’engagement est de traiter le remboursement dans les 14 jours suivant la demande, sans déduction des frais Square.
6. Ne proposer hors Québec qu’un parcours déterminant les taxes applicables. Le total fixe 113,83 $ décrit la vente taxable québécoise et ne justifie pas de forcer TPS/TVQ pour tous les territoires.
7. Le bloc commercial pointe vers la route publiée et ne comporte aucun bouton de paiement supposé actif. Raccorder les conditions au parcours de commande et vérifier ce parcours avant ouverture.

## Références de contrôle

- [OPC — Obligations de commerce en ligne](https://www.opc.gouv.qc.ca/en/enligne) : renseignements précontractuels, description, coordonnées et remise du contrat.
- [OPC — Contenu du contrat](https://www.opc.gouv.qc.ca/consommateur/sujet/achat/internet/contrat/) : copie durable et informations individuelles.
- [OPC — Annulation](https://www.opc.gouv.qc.ca/consommateur/sujet/achat/internet/annulation) : distinguer la garantie commerciale des droits légaux.
- [Revenu Québec — Calcul des taxes](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/calcul-des-taxes/) : taux et base de calcul.
- [Revenu Québec — Préparation des factures](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/preparation-des-factures/) : justificatifs pour CTI/RTI et paliers calculés taxes comprises.

La publication des conditions est confirmée. Ce document n’atteste aucun paiement réussi, test API, connexion Brevo ou validation juridique complète.

## Synchronisation des pages publiques et identifiants fiscaux

Le NEQ **1181499600** a été publié avant 14 h 45 le 29 septembre 2026 sur la page des conditions WordPress **1909** et sur les mentions légales **1426**, selon la confirmation du responsable de l’intégration. Preuves locales : `livraison/conditions-publiees-neq.png` et `livraison/mentions-legales-neq.png`.

Les numéros **TPS/TVH 755212438 RT0001** et **TVQ 1233281863 TQ0001**, fournis par l’utilisateur, sont ajoutés aux sources locales des conditions et du bloc de présentation. Le responsable de l’intégration a confirmé la mise à jour publiée des pages WordPress **1909** et **1426** avec ces identifiants fiscaux, et a vérifié le message « Page mise à jour ». Aucune validation par Revenu Québec n’est revendiquée.

## Copie PDF conservable

Fichier final : `CONDITIONS_CAP_CHAUFFEUR_2026-09-29.pdf`, quatre pages numérotées, reprenant les conditions finales sans modification juridique. NEQ et identifiants fiscaux sont inclus ; ces derniers restent des données fournies par l’utilisateur. Génération ReportLab, extraction texte contrôlée, rendu Poppler et inspection visuelle des quatre pages terminés. Aucun contenu masqué ou champ provisoire laissé dans le PDF. Ce PDF est prêt à joindre à la facture brouillon 000001 ; son rattachement et son envoi ne sont pas effectués par ce lot. Il accompagne le récapitulatif individuel de commande et ne le remplace pas.
