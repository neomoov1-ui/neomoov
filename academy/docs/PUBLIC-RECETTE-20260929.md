# Recette HTTP publique — 29 septembre 2026

## Dernier contrôle — après ouverture des ventes

**29 septembre 2026, 19:40:53 UTC (21:40:53 Paris).** Nouvelles requêtes GET publiques sans cookie, sans navigateur et sans soumission. Ce contrôle remplace les constats d’état « ventes fermées / prix en préparation / nouveau CSS absent » du contrôle initial conservé plus bas.

| Pages contrôlées | HTTP | Résultat après ouverture |
|---|---:|---|
| `/academy/`, `/academy/rentabilite/`, `/academy/service/`, `/academy/demarrer/`, `/academy/entreprise/` | 200 chacune | Prix 99,00 $ CA, TPS 4,95 $, TVQ 9,88 $, total 113,83 $ CA sur les cinq pages ; mention facturation Québec et vérification avant activation |
| `/academy/inscription/` | 200 | Formulaire gratuit et consentement commercial distinct présents ; aucune inscription soumise |
| `/academy/ressources/` | 200 | Les huit fiches sont présentes publiquement |
| `/academy/membre/`, `/academy/formation/` | 200 chacune | Connexion toujours demandée ; aucun des sept titres de leçons rendu dans la partie principale de la page formation anonyme |
| `/academy/compagnon/` | 200 | Interface publique présente ; calculs et interactions non exécutés |
| `/conditions-cap-chauffeur/`, `/mentions-legales/` | 200 chacune | Pages juridiques toujours accessibles, total fiscal des conditions inchangé |

Les **douze réponses** ne présentent aucune signature visible d’erreur fatale PHP, aucun identifiant d’ancien lien Square `LZziqYKZ` et aucun lien direct `square.link` ou `square.site`. Les cinq pages d’offre conservent les promesses 7 microleçons écrites + 8 fiches, 12 mois calendaires et vidéos non incluses. Les liens vers les conditions sont présents dans les dix pages Academy contrôlées. L’addition affichée est correcte : 99,00 + 4,95 + 9,88 = **113,83 CAD**.

La nouvelle règle CSS `.nmsa-checkout{` est désormais présente dans les réponses Academy. Cela confirme la livraison du CSS, **pas** une vérification visuelle du formulaire connecté. Les pages Academy conservent l’en-tête `no-cache, must-revalidate, max-age=0, no-store, private`.

Cette recette ne démontre ni un paiement réel réussi, ni un remboursement réel, ni l’email de création de compte, ni le parcours de mot de passe. Aucun de ces tests n’a été exécuté par cet audit. Les données de cette passe sont conservées séparément : `.verification/public-audit-open-20260929.json` et son script `.verification/public-audit-open-20260929.cjs`. Aucun PHP n’a été modifié.

## Contrôle initial — avant ouverture

Contrôle terminé le **29 septembre 2026 à 19:05:43 UTC (21:05:43, Paris)**. Requêtes GET anonymes, sans cookie, sans navigateur et sans soumission de formulaire. Aucun code ni réglage du site modifié. Les chemins ci-dessous sont sur `https://neomoov.net`.

## Résultat

Les onze pages répondent en **HTTP 200**, sans redirection vers une autre URL et sans signature visible d’erreur fatale PHP. Aucun des HTML contrôlés ne contient l’ancien lien/identifiant Square **LZziqYKZ**, ni de lien de paiement `square.link` ou `square.site`.

| Page | HTTP | Observation |
|---|---:|---|
| `/academy/` | 200 | Offre générale, ventes annoncées en préparation |
| `/academy/rentabilite/` | 200 | Offre chauffeurs en activité, ventes en préparation |
| `/academy/service/` | 200 | Offre qualité de service, ventes en préparation |
| `/academy/demarrer/` | 200 | Offre futurs chauffeurs, ventes en préparation |
| `/academy/entreprise/` | 200 | Offre exploitants, ventes en préparation |
| `/academy/membre/` | 200 | Demande de connexion, aucun paiement affiché |
| `/academy/formation/` | 200 | Demande de connexion, aucun contenu de leçon affiché |
| `/academy/ressources/` | 200 | Les huit fiches sont présentes publiquement |
| `/academy/compagnon/` | 200 | Interface publique du compagnon présente |
| `/conditions-cap-chauffeur/` | 200 | Conditions de vente publiées, version du 29 septembre 2026 |
| `/mentions-legales/` | 200 | Identité du vendeur et coordonnées présentes |

Toutes les pages Academy contrôlées renvoient `Cache-Control: no-cache, must-revalidate, max-age=0, no-store, private`. Les deux pages juridiques renvoient `max-age=0`.

## Accès sans connexion

Les parties principales de `/academy/membre/` et `/academy/formation/` affichent « Connectez-vous à votre compte », « Me connecter », la récupération du mot de passe et la création gratuite du compte. Aucun des sept titres de microleçons n’est présent dans la partie principale de la réponse formation. Un HTTP 200 est normal ici : la page de connexion est rendue dans l’habillage Academy.

Ce contrôle confirme la barrière de connexion anonyme. Il ne teste pas les permissions d’un membre connecté non payant ou d’un membre payé.

## Promesses de l’offre et prix

Les cinq pages de vente (accueil et quatre parcours) annoncent toutes :

- 7 microleçons écrites avec exercices et corrigés ;
- 8 fiches pratiques imprimables ;
- 12 mois calendaires à compter de l’activation ;
- vidéos non incluses ;
- paiements en cours de préparation et inscription gratuite disponible.

Les huit titres de fiches du fichier local `livraison/formation/data.json` ont été retrouvés dans la page publique des ressources, après prise en compte des apostrophes encodées en HTML. Les fiches gratuites sont explicitement présentées comme telles.

**État du prix :** les pages de vente n’affichent actuellement aucun montant. Elles affichent « Offre de lancement en préparation » et « Le prix final et les taxes applicables seront précisés avant l’ouverture du paiement ». Les conditions publiées indiquent déjà : 99,00 $ CA avant taxes, TPS 5 % / 4,95 $, TVQ 9,975 % / 9,88 $, total Québec **113,83 $ CA**, paiement unique sans abonnement ni renouvellement automatique. Cela reste cohérent avec des ventes fermées, mais la présence du prix total sur le parcours réel devra être vérifiée avant ouverture.

Les conditions décrivent sept microleçons, huit fiches, douze mois calendaires, l’activation et la copie durable du contrat sous 24 heures après confirmation, la première réponse du support sous deux jours ouvrés et le remboursement commercial dans les quatorze jours suivant l’activation. Elles excluent les vidéos et distinguent les ressources pouvant aussi être proposées gratuitement.

## Liens et identité

Chaque page Academy contrôlée comporte un lien vers `https://neomoov.net/conditions-cap-chauffeur/`. Les cinq pages d’offre comportent ce lien dans l’offre et dans le pied de page. Aucun placeholder n’a été constaté sur ces liens.

Les mentions et les conditions identifient GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., NEQ 1181499600, TPS/TVH 755212438 RT0001, TVQ 1233281863 TQ0001, et les coordonnées montréalaises. Ce constat porte sur la présence publique des informations, pas sur une validation auprès d’un registre ni une certification juridique.

## Présentation locale non encore déployée lors de ce contrôle

La règle CSS `.nmsa-checkout{` est absente des neuf pages Academy récupérées. La nouvelle présentation locale du formulaire Square API n’était donc pas encore dans ces réponses à l’heure du contrôle. Le formulaire connecté Sandbox n’est pas accessible par cette recette anonyme ; son apparence, le nouvel alignement et le message « aucun email envoyé » ne sont pas validés ici.

## Limites et preuves

Aucune navigation visuelle, exécution JavaScript, création de compte, demande de paiement, opération Square ou tentative d’envoi d’email n’a été effectuée. Les erreurs détectées sont celles visibles dans les réponses HTML ; les journaux serveur n’ont pas été consultés. Les paiements, remboursements, webhooks, emails et tâches WP-Cron restent hors de cette recette publique.

Mesures et textes extraits : `.verification/public-audit-20260929.json`. Script reproductible : `.verification/public-audit-20260929.cjs`. Ces fichiers ne contiennent que les réponses publiques et leurs indicateurs, aucune authentification.

## Complément autorisé — rejet d’un webhook sans signature

Le 29 septembre 2026 à **19:09:47 UTC**, un POST anonyme vers `https://neomoov.net/wp-json/neomoov-academy/v1/square-api` a envoyé uniquement `{"event_id":"neomoov-negative-test-20260929","type":"payment.updated"}`. Aucun cookie, signature, identifiant de paiement réel ou secret n’a été transmis. Réponse : **HTTP 403**, corps vide, sans suivi de redirection. Le refus attendu est donc observé ; le code exact est 403, et non 401. Le code local du webhook renvoie bien 403 avant le décodage/traitement d’événement lorsque la signature HMAC est absente ou incorrecte.

L’appel a été fait avec Python `urllib`, sans navigateur ni appel à Square. Une première tentative de connexion via le proxy implicite du runtime avait échoué avant toute réponse HTTP (WinError 10061) ; le seul POST ayant reçu une réponse a été réalisé directement, proxy désactivé. Aucun test supplémentaire n’a été envoyé. L’absence de mutation est étayée par le retour préalable dans le code, mais les écritures serveur n’ont pas été inspectées pour cette requête.

Preuve : `.verification/webhook-negative-20260929.json` ; script : `.verification/webhook-negative-20260929.py`.
