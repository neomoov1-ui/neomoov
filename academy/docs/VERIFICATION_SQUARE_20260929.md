# Square — vérification technique du 29 septembre 2026

**Résultat : une facture interne à 113,83 CAD est enregistrée en ébauche. Aucun client, aucun envoi, aucun paiement et aucun accès acheteur attribué. Les ventes publiques restent fermées.**

## Périmètre constaté dans l’interface Square

Les constatations ci-dessous ont été confirmées par l’agent principal pendant la préparation dans le Tableau de bord Square ; cette note ne transforme pas une simulation de facture en test de règlement.

| Élément | Résultat observé |
|---|---|
| Produit | CAP CHAUFFEUR — Neomoov Academy |
| Prix de base | 99,00 CAD |
| Quantité de la facture | 1 |
| Taxe dédiée TPS | CAP CHAUFFEUR — TPS 5 %, type GST, additive : 4,95 CAD |
| Taxe dédiée TVQ | CAP CHAUFFEUR — TVQ 9,975 %, type QST, additive : 9,88 CAD |
| Total de la facture | **113,83 CAD** |
| Facture | **000001** |
| État | **Ébauche**, enregistrée ; liste Ébauches : 1 |
| Destinataire | Aucun client renseigné |
| Consultation | Non consultée |
| Mention | BROUILLON INTERNE |
| Envoi / encaissement | Aucun |

[Ouvrir l’ébauche dans l’administration Square](https://app.squareup.com/dashboard/invoices/inv:0-ChDWZfC-g8abDdSHMAWJJtR2EP4P/edit). Ce lien d’administration ne doit pas être diffusé comme lien de vente.

## Isolation des taxes

Deux nouvelles définitions dédiées à CAP CHAUFFEUR ont été créées. Elles ne sont assignées à **aucun article** et ne s’appliquent pas aux **montants personnalisés**. Elles ne déclenchent donc pas l’application automatique d’une nouvelle taxe aux autres ventes.

Pour cette facture uniquement, les deux taxes dédiées ont été sélectionnées et la taxe héritée à **15 %** a été décochée. Les dérogations globales et les paramètres fiscaux préexistants restent inchangés. Le refus du propriétaire de modifier les taxes globales demeure la contrainte à respecter.

Le calcul observé correspond à 99,00 + 4,95 + 9,88 = **113,83 CAD**. Les taux TPS 5 % et TVQ 9,975 % se calculent sur le prix avant taxes. Leur applicabilité au vendeur et à chaque vente doit être confirmée séparément. [Calcul des taxes — Revenu Québec](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/calcul-des-taxes/)

## Ce qui n’est pas validé

- Le lien public [Square CAP CHAUFFEUR](https://square.link/u/LZziqYKZ) : son dernier état observé reste à 99,00 CAD avec un paramètre fiscal forcé à 0 et une quantité modifiable. La réussite de la facture ne change pas cet état.
- Un paiement par carte ou portefeuille, une réception de fonds, un reçu envoyé ou un remboursement.
- L’attribution de l’accès après un règlement effectif, ni la réception des emails de compte.
- Une automatisation Square API : la solution reste en préparation locale, sans déploiement ni recette authentifiée attestés.
- Une connexion ou une séquence Brevo opérationnelle.

## Préparer une facture client

1. Renseigner un vrai destinataire et son courriel, puis vérifier le compte membre Academy bénéficiaire.
2. Finaliser et communiquer avant l’envoi/la conclusion les conditions de vente : vendeur, contenus disponibles, prix et taxes, durée d’accès, délai de vérification manuelle, livraison, contact et remboursement. Conserver la preuve de l’acceptation retenue.
3. Préparer une facture client distincte ou adapter l’ébauche après validation. Ne retirer la mention interne que pour la facture effectivement destinée au client. Vérifier article, quantité **1**, prix **99,00 CAD**, deux seules taxes dédiées et total **113,83 CAD**, lorsque ce traitement fiscal est applicable.
4. Vérifier à nouveau que la taxe héritée à 15 % reste décochée pour cette facture et qu’aucun réglage global n’a été modifié. Contrôler destinataire, échéance, description et conditions avant l’envoi.
5. Après règlement, ouvrir le paiement dans Square : statut **COMPLETED / terminé**, article, quantité 1, montant, taxes, devise CAD, courriel, bénéficiaire et absence de remboursement total. Relever la **référence du paiement**, distincte du numéro de facture.
6. Rapprocher la référence et le courriel avec l’ID du membre WordPress, puis activer l’accès dans l’outil manuel Academy et consigner la vérification. Une capture client ou une page de retour ne constitue pas une preuve suffisante.
7. Traiter tout remboursement dans Square et la révocation d’accès dans WordPress séparément. Consulter [le guide d’exploitation](</C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/EXPLOITATION.md>) pour les contrôles et limites.

## Captures conservées

![Total de facture vérifié](</C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/square-facture-total-verifie.png>)

![Ébauche enregistrée, sans client et non envoyée](</C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/square-facture-ebauche-enregistree.png>)
