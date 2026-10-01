# CAP CHAUFFEUR — Démarrage et état de livraison

Neomoov Academy · Situation du 30 septembre 2026 · Ouverture commerciale cible : **mercredi 30 septembre 2026 à 10 h, heure de Montréal**.

**Les pages de présentation sont en ligne sur [neomoov.net/academy](https://neomoov.net/academy/).** **Square production connecté et ventes ouvertes** : clés privées raccordées, mode production et sales=1 enregistrés. Le GET de l’établissement exact a confirmé ACTIVE / CA / CAD / CREDIT_CARD_PROCESSING. Le webhook production est activé pour quatre événements. Prix configuré : 99,00 CAD + TPS 4,95 + TVQ 9,88 = **113,83 CAD** pour une vente taxable au Québec. **Un email technique unique a été reçu en boîte de réception**, confirmé par la capture fournie par l’utilisateur. Ce test ne valide pas encore la notification d’un achat réel ni la livraison d’un contrat client. **Brevo connecté à WordPress ; synchronisation activée sur les quatre listes 3, 4, 5 et 6.** **Migration Brevo confirmée : 28 / 28 modèles inactifs utilisent Neomoov Academy <contact@neomoov.net>, avec réponse à contact@neomoov.net.** Le nouvel export est déployé dans l’extrait WordPress 6 actif. La migration n’a déclenché aucun envoi. Preuve : [28 modèles professionnels](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-28-modeles-professionnels.png>). Les trois enregistrements DNS Brevo ont été ajoutés après autorisation : **neomoov.net est authentifié et contact@neomoov.net est vérifié**. Preuve : [expéditeur professionnel vérifié](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-expediteur-professionnel-verifie.png>). **Les quatre scénarios sont entièrement configurés et restent INACTIFS : Rentabilité #1 / liste 3 / R01–R07 ; Qualité de service #3 / liste 4 / S01–S07 ; Démarrer #4 / liste 5 / D01–D07 ; Entreprise #2 / liste 6 / E01–E07.** Les 28 actions ont été enregistrées avec l’expéditeur professionnel ; les anciens expéditeurs Gmail de E01–E05 ont été corrigés. Délais : 1, 2, 2, 3, 3, 4 jours. Réentrée désactivée sur les quatre scénarios ; sorties enregistrées sur désinscription de tous les emails et retrait immédiat de la liste propre au scénario. Cette configuration vérifiée dans l’interface ne constitue pas une recette d’envoi. La synchronisation exige consentement marketing et première connexion au compte. Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée. Aucune inscription client réelle ni aucun achat ou remboursement réel n’a été testé. Le test technique WordPress reçu précédemment est distinct de Brevo. Le dossier comprend la première édition écrite, les visuels, les contenus commerciaux et sept scripts vidéo. Les scripts ne sont pas des vidéos produites.

Ce document est un index et une liste d’opérations restantes. Il ne constitue pas un procès-verbal de tests du site, des inscriptions, des emails ou des paiements. La mise en ligne des pages ne suffit pas à confirmer que le parcours commercial fonctionne de bout en bout.

## 1. Les pages publiques

**Dernier contrôle public, après déploiement : 30 septembre 2026 à 01:12:14 UTC.** Les douze routes contrôlées répondent en HTTP 200, sans erreur PHP visible ni ancien lien Square. Les cinq pages d’offre affichent le total cohérent de 113,83 $ CA ; membre et formation demandent toujours une connexion au visiteur anonyme. Contrôle en lecture seule : aucune inscription ni aucun paiement soumis. Le contrôle précédent des cinq offres à 21:19 UTC le 29 septembre était également sans régression.

| Destination | Lien | Utilité |
|---|---|---|
| Accueil Academy | [CAP CHAUFFEUR](https://neomoov.net/academy/) | Présentation de la formation et orientation du visiteur |
| Rentabilité | [Parcours Rentabilité](https://neomoov.net/academy/rentabilite/) | Chauffeurs en activité : temps réel, kilomètres et coûts |
| Service | [Parcours Service](https://neomoov.net/academy/service/) | Accueil, confort, préparation du véhicule et constance |
| Démarrer | [Parcours Démarrer](https://neomoov.net/academy/demarrer/) | Futurs chauffeurs : préparation de l’activité |
| Entreprise | [Parcours Entreprise](https://neomoov.net/academy/entreprise/) | Exploitants et futurs investisseurs : organisation et indicateurs |

Autres destinations prévues dans l’intégration : [inscription gratuite](https://neomoov.net/academy/inscription/), [espace membre](https://neomoov.net/academy/membre/), [formation](https://neomoov.net/academy/formation/), [compagnon web](https://neomoov.net/academy/compagnon/), [ressources](https://neomoov.net/academy/ressources/), [passagers](https://neomoov.net/academy/passagers/) et [confidentialité](https://neomoov.net/academy/confidentialite/). Leur fonctionnement effectif et leurs restrictions d’accès doivent être contrôlés dans le parcours réel avant d’en annoncer les capacités.

## 2. État réel par composant

| Composant | État à cette étape | Ce qui reste à faire |
|---|---|---|
| Pages de présentation et quatre orientations | En ligne ; extrait WordPress **6 actif**, avec nouveau style, gestion de source Sandbox, aperçu de contrat et test email | Accueil contrôlé structurellement à 390 pixels CSS sans débordement ; revue visuelle des autres routes et sur de vrais téléphones encore conseillée |
| Inscription gratuite et espace membre | Intégration publiée ; affichage connecté vérifié | Contrôler création du compte, email d’accès, connexion, déconnexion et récupération du mot de passe |
| Accès payant à la formation | Rapprochement Sandbox vérifié au statut **sandbox_paid**, après contrôle billing_review et attestation fictive auditée ; seconde lecture avec les mêmes identifiants | Aucun accès réel accordé ; vérifier séparément l’attribution de production, les restrictions, les échéances et le remboursement |
| Square — ancien lien du Tableau de bord | Produit à 99,00 CAD et lien créés ; taxes forcées à 0 et quantité modifiable ; **non diffusé, pas prêt à vendre** | Ne pas utiliser ce lien comme substitut au parcours API isolé ; les paramètres fiscaux globaux restent inchangés |
| Square — facture individuelle | **Ébauche 000001 enregistrée, sans client, non envoyée : total 113,83 CAD ; PDF des conditions de 85,69 kB attaché et enregistré** | Préparer un véritable destinataire et son récapitulatif individuel avant un éventuel envoi autorisé ; contrôler tout paiement avant attribution |
| Square — API isolée | Production connectée, clés privées ; GET établissement exact ACTIVE / CA / CAD / CREDIT_CARD_PROCESSING réussi ; ventes ouvertes, sales=1, total Québec 113,83 CAD | Premier paiement réel et attribution réelle encore non testés |
| Square — webhooks | Production activée pour quatre événements ; quatre livraisons Sandbox HTTP 200 et rapprochement sandbox_paid déjà vérifiés | Réception et traitement d’une notification de paiement réel encore non testés |
| Contrat et test email | Aperçu fictif PHP correct : 11 sections, identifiants et taxes ; email technique unique reçu en Inbox, capture utilisateur | Tester la remise du contrat individuel après un achat réel |
| Paiement Stripe | Intégration conservée ; non utilisée et fermée | Ne pas basculer sans nouvelle vérification du prix, des taxes et du parcours complet |
| Brevo | Synchronisation WordPress active ; listes 3–6 ; 28 modèles inactifs ; domaine authentifié et expéditeur professionnel vérifié ; aucun envoi commercial | Quatre scénarios et 28 actions enregistrés, tous inactifs ; demande de test Brevo unique effectuée, réception non confirmée et parcours réels à vérifier avant activation |
| Formation | Sept microleçons écrites et huit fiches pratiques avec exercices/corrigés | Relecture pédagogique finale et vérification de la liste réellement accessible aux membres |
| Série vidéo | Sept scripts narrateur écrits ; **vidéos non incluses dans la vente de l’édition écrite** | Production ultérieure distincte, sans promettre de vidéos déjà disponibles aux acheteurs |
| Visuels | Logo PNG, affiche principale, quatre affiches Neomoov, quatre affiches produit, image hero | Vérifier les versions affichées sur le site et adapter les exports aux réseaux utilisés |
| Application compagnon | En ligne ; calcul et liste de priorités vérifiés | Contrôler la sauvegarde dans un compte de test |
| Applications Play Store / App Store | Non livrées | Projet ultérieur, distinct du lancement web |
| Promotion autonome | Textes, calendrier et règles préparés | Connecter les outils puis activer et surveiller les flux réels |

Le lien créé est [CAP CHAUFFEUR sur Square](https://square.link/u/LZziqYKZ). Il reste réservé à la configuration et **ne doit pas être diffusé comme une vente opérationnelle**. Le propriétaire refuse une modification des taxes globales de Square ; la résolution doit rester limitée à cette offre. La simulation et le rapprochement Sandbox décrits ci-dessous sont vérifiés ; aucun encaissement réel, accès réel ou remboursement de production n’est déclaré validé.

La cible pour une vente taxable au Québec à 99,00 CAD est **4,95 CAD de TPS (5 %) + 9,88 CAD de TVQ (9,975 %) = 113,83 CAD au total**, sous réserve du traitement applicable. L’ancien lien du Tableau de bord demande encore 99,00 CAD avec un paramètre fiscal à zéro. À l’inverse, la commande API **Sandbox** a été lue avec le total correct de 113,83 CAD et une quantité de 1 ; cela ne valide pas encore un encaissement en production. [Calcul officiel — Revenu Québec](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/calcul-des-taxes/)

Un second parcours technique a été vérifié : **facture 000001 « CAP CHAUFFEUR — Neomoov Academy », 113,83 CAD, Ébauche, sans client et non envoyée, PDF des conditions de 85,69 kB attaché et enregistré**. Deux taxes additives dédiées ont été créées, sans article assigné ni application aux montants personnalisés. Dans cette facture seulement, elles remplacent la sélection héritée à 15 %. Les dérogations et autres réglages fiscaux préexistants n’ont pas changé. Ce résultat ne valide pas le checkout public et n’est pas un paiement test. [Détail de la vérification](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/VERIFICATION_SQUARE_20260929.md>).

**Contrôles Square Sandbox confirmés :** CreatePaymentLink et RetrieveOrder ont renvoyé HTTP 200 ; commande composée d’une seule ligne CAP CHAUFFEUR à 99,00 CAD, avec TPS 4,95 CAD et TVQ 9,88 CAD, total 113,83 CAD. Le TestPayment du Developer Control Panel a réussi et le paiement simulé est au statut **COMPLETED**, avec source **EXTERNAL**. Quatre livraisons de webhooks payment.created / payment.updated ont reçu HTTP 200. L’extrait WordPress **6 actif** inclut le traitement de cette source strictement en Sandbox. Après le contrôle **billing_review** et une attestation fictive auditée, le rapprochement est vérifié au statut **sandbox_paid**. Une seconde lecture a retrouvé les mêmes identifiants. Aucun accès réel accordé par la recette Sandbox. **Square production connecté et ventes ouvertes** : clés privées raccordées, mode production et sales=1 enregistrés. Le GET de l’établissement exact a confirmé ACTIVE / CA / CAD / CREDIT_CARD_PROCESSING. Le webhook production est activé pour quatre événements. Prix configuré : 99,00 CAD + TPS 4,95 + TVQ 9,88 = **113,83 CAD** pour une vente taxable au Québec. **Un email technique unique a été reçu en boîte de réception**, confirmé par la capture fournie par l’utilisateur. Ce test ne valide pas encore la notification d’un achat réel ni la livraison d’un contrat client. **Restent non testés : premier paiement réel, remboursement réel, notification de production liée à une vente, inscription et parcours complet d’un nouveau compte. Aucun accès réel n’a été accordé.** Le compte administrateur UID 1 conserve son dossier Sandbox : utiliser un autre compte neuf pour la recette client réelle.

**Modalités commerciales approuvées :** 99 $ CA avant taxes ; 7 microleçons et 8 fiches ; accès pendant 12 mois calendaires dès activation ; activation dans les 24 heures après paiement confirmé ; remboursement intégral sur demande dans les 14 jours suivant l’activation, traité sur le moyen d’origine sous 14 jours ; première réponse du support sous 2 jours ouvrés. La série vidéo n’est pas vendue dans cette édition.

**Identifiants et conditions :** le **NEQ 1181499600** a été vérifié sur la fiche officielle du Registraire le **29 septembre 2026 à 14 h 39 EDT** (statut Immatriculée, nom et adresse concordants). Preuve locale : [capture de vérification](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/neq-groupe-nsk-verifie.png>). Les numéros **TPS/TVH 755212438 RT0001** et **TVQ 1233281863 TQ0001** ont été **fournis par l’utilisateur**, sans vérification indépendante Revenu Québec déclarée. Le vendeur identifié est GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., exploitant de la marque Neomoov, conformément aux mentions légales officielles. Les [conditions de vente](https://neomoov.net/conditions-cap-chauffeur/) sont **publiées : page WordPress ID 1909, le 29 septembre 2026 à 14 h 27 EDT (Montréal)**, selon la confirmation du responsable de l’intégration.

La première édition écrite ne représente pas les 21 heures envisagées dans les références. Les conseils fondés sur photos/questionnaire ne constituent pas un diagnostic mécanique ni une inspection réglementaire. Ne pas annoncer les fonctionnalités envisagées comme disponibles sans vérification.

## 3. Marketing — fichiers à utiliser

Ouvrir d’abord le [dossier marketing HTML](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/CAP_CHAUFFEUR_dossier_marketing.html>) : navigation entre tunnels, emails et publications ; mise en page d’impression intégrée.

| Fichier | Contenu |
|---|---|
| [README marketing](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/README.md>) | Mode d’emploi et limites d’activation |
| [Tunnels et pilotage](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/01_tunnels_et_pilotage.md>) | Quatre tunnels, calendrier, configuration, messages de service et opérations de lancement |
| [Séquences email](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/02_sequences_email.md>) | Quatre lots de sept emails : sujets, préheaders, corps, CTA, UTM, variantes préouverture/vente et identification Neomoov |
| [Vingt publications](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/03_publications.md>) | Textes complets, canaux, angles, visuels suggérés, calendrier, UTM et réponses aux commentaires |
| [Emails structurés JSON](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/emails_source.json>) | Source structurée des 28 messages ; ne constitue pas un import Brevo universel |
| [Templates préouverture](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/emails_html/preouverture>) | 28 fichiers HTML : R01–R07, S01–S07, D01–D07 et E01–E07 |
| [Templates vente](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/emails_html/vente>) | Les 28 mêmes messages dans leur variante vente, à activer seulement après ouverture réelle |
| [Générateur marketing](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/generer_livrables.cjs>) | Régénération des HTML et du JSON à partir des Markdown |

**Un contact reçoit un seul lot de sept emails.** Il ne reçoit pas les quatre lots ni les deux variantes. Remplacer le marqueur de désabonnement par le lien individuel natif de Brevo. Les achats confirmés et désabonnements doivent arrêter les relances commerciales. Les ventes sont ouvertes ; préparer la variante vente en brouillon, après alignement sur les conditions approuvées, sans déclencher de campagne avant vérification de la liaison et des règles d’arrêt.

## 4. Identité et visuels

Tous les fichiers ci-dessous sont présents localement. Les 11 images ont été importées dans WordPress (IDs 1898 à 1908). Aucune publication sur les réseaux n’a été effectuée.

| Fichier | Usage |
|---|---|
| [Logo Neomoov Academy](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/logo-neomoov-academy.png>) | Logo raster PNG ; aucune version vectorielle n’est annoncée |
| [Affiche principale CAP CHAUFFEUR](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-cap-chauffeur-principale.png>) | Présentation générale du produit |
| [Neomoov 1](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-neomoov1.png>) · [Neomoov 2](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-neomoov2.png>) · [Neomoov 3](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-neomoov3.png>) · [Neomoov 4](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-neomoov4.png>) | Quatre affiches de marque |
| [Produit 1](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-produit1.png>) · [Produit 2](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-produit2.png>) · [Produit 3](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-produit3.png>) · [Produit 4](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/affiche-produit4.png>) | Quatre affiches de la formation |
| [Image hero](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/hero-chauffeur.png>) | Illustration d’accueil du site |
| [Prompts et périmètre visuel](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/visuels/PROMPTS-VISUELS.md>) | Intentions, textes et limites des créations |

## 5. Formation et préparation vidéo

| Fichier | Contenu |
|---|---|
| [Guide HTML](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/CAP_CHAUFFEUR_GUIDE.html>) | Première édition écrite, à lire ou imprimer depuis un navigateur |
| [Guide Markdown](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/CAP_CHAUFFEUR_GUIDE.md>) | Version texte éditable |
| [Données pédagogiques](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/data.json>) | Sept microleçons, huit fiches et exercices/corrigés destinés à l’intégration |
| [Sources et périmètre](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SOURCES_ET_PERIMETRE.md>) | Utilisation des six références, choix pédagogiques et limites |
| [Sept scripts vidéo réunis](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/CAP_CHAUFFEUR_7_SCRIPTS_VIDEO.md>) | Narration et indications de réalisation ; aucune vidéo existante |
| [Scripts structurés JSON](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/scripts-video.json>) | Source des scripts et séquences |
| [Générateur du guide](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/generer-guide.ps1>) · [Générateur des scripts](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/generer-scripts-video.ps1>) | Fichiers techniques pour régénérer les documents |

Scripts individuels : [01 — Cadre professionnel](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_01_cadre-professionnel.md>), [02 — Journée maîtrisée](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_02_journee-maitrisee.md>), [03 — Chiffres utiles](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_03_chiffres-utiles.md>), [04 — Véhicule et client](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_04_vehicule-client.md>), [05 — Service professionnel](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_05_service-professionnel.md>), [06 — Incident factuel](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_06_incident-factuel.md>), [07 — Progression durable](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/formation/SCRIPT_VIDEO_07_progression-durable.md>).

Les durées proposées dans les scripts sont estimatives. Il reste à enregistrer les voix ou le présentateur, réaliser les plans, monter les séquences, vérifier le résultat et les publier dans le parcours membre. Une annonce « toutes les vidéos disponibles » serait donc prématurée.

## 6. Intégration WordPress — fichiers de livraison

| Fichier | Usage |
|---|---|
| [Source PHP](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/neomoov-academy.php>) | Source de l’intégration Academy |
| [Version PHP préparée](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/neomoov-academy-ready.php>) | Fichier assemblé pour intégration |
| [Export Code Snippets](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/neomoov-academy.code-snippets.json>) | Export d’intégration WordPress |
| [Générateur d’export](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/build-export.py>) | Construction de l’export |
| [Guide d’exploitation WordPress](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/EXPLOITATION.md>) | Réglages Square, contrôle manuel des paiements, attribution/révocation, limites et dépannage |

Ces fichiers décrivent le lot technique. Ne pas importer plusieurs versions simultanément : cela pourrait déclarer deux fois les mêmes fonctions. Une mise à jour doit être appliquée à l’intégration existante selon la procédure de déploiement retenue. Ce document n’effectue aucune modification WordPress.

## 7. Passer de la préouverture aux premières ventes

### A. Mettre en œuvre les modalités déjà approuvées

1. Conserver le prix accepté : **99 $ CA avant taxes**, soit **113,83 $ CA pour une vente taxable au Québec**. Contrôler le montant effectivement demandé dans le parcours qui sera utilisé. Ne pas présenter 199 $ comme un ancien prix ou une remise acquise.
2. Appliquer les engagements acceptés : **12 mois calendaires** depuis l’activation effective, activation sous **24 heures** après paiement confirmé, remboursement commercial demandé sous **14 jours** après activation et traité sur le moyen d’origine sous **14 jours**, première réponse du support sous **2 jours ouvrés**.
3. Conserver les données vendeur dans les documents de commande : **NEQ vérifié : 1181499600 ; TPS/TVH 755212438 RT0001 et TVQ 1233281863 TQ0001 fournies par l’utilisateur**. Le NEQ a été publié sur les conditions 1909 et les mentions légales 1426 avant 14 h 45. Les identifiants fiscaux sont ajoutés aux sources locales et leur publication sur les pages 1909 et 1426 a été confirmée par le responsable de l’intégration (« Page mise à jour »). Ne pas confondre fourniture des numéros par l’utilisateur et vérification par l’autorité fiscale.
4. Utiliser les conditions désormais publiées sur **https://neomoov.net/conditions-cap-chauffeur/** (page WordPress 1909, publiée le 29 septembre 2026 à 14 h 27 EDT). Raccorder cette URL au parcours de commande et conserver une copie datée pour chaque contrat ; la publication ne prouve pas encore le fonctionnement du paiement.
5. Avec chaque facture client, fournir avant paiement l’offre et les conditions datées ; remettre une copie durable du contrat et le récapitulatif dans les **24 heures après paiement confirmé**. Enregistrer les dates d’activation et de fin d’accès.
6. Décrire uniquement l’édition écrite vendue : **7 microleçons et 8 fiches**. Les vidéos et applications mobiles ne sont pas incluses. Ne pas présenter ce parcours comme 21 heures de formation.

### B. Surveiller la production et terminer la recette client

**Square production connecté et ventes ouvertes** : clés privées raccordées, mode production et sales=1 enregistrés. Le GET de l’établissement exact a confirmé ACTIVE / CA / CAD / CREDIT_CARD_PROCESSING. Le webhook production est activé pour quatre événements. Prix configuré : 99,00 CAD + TPS 4,95 + TVQ 9,88 = **113,83 CAD** pour une vente taxable au Québec.

La recette Sandbox a validé CreatePaymentLink / RetrieveOrder HTTP 200, une ligne et quantité 1, le total 113,83 CAD, TestPayment COMPLETED de source EXTERNAL, quatre livraisons de webhooks HTTP 200 et le rapprochement sandbox_paid après billing_review et attestation fictive auditée. La seconde lecture a retrouvé les mêmes identifiants. Le traitement particulier EXTERNAL reste strictement limité au Sandbox.

**Restent non testés : premier paiement réel, remboursement réel, notification de production liée à une vente, inscription et parcours complet d’un nouveau compte. Aucun accès réel n’a été accordé.** Le compte administrateur UID 1 conserve son dossier Sandbox : utiliser un autre compte neuf pour la recette client réelle.

1. Utiliser un compte neuf, distinct de l’administrateur UID 1, pour contrôler inscription, connexion, parcours de paiement, dates d’accès et copie conservable du contrat.
2. Consigner séparément le premier paiement réel, la notification signée correspondante, le rapprochement, l’accès et la remise du contrat. Ne pas déduire ces résultats de la réussite du GET établissement.
3. Compléter les scénarios non attestés : abandon, reprise, notifications répétées, remboursement et restriction d’accès. Ne pas procéder à un débit réel uniquement pour tester sans autorisation correspondante.
4. **Un email technique unique a été reçu en boîte de réception**, confirmé par la capture fournie par l’utilisateur. Ce test ne valide pas encore la notification d’un achat réel ni la livraison d’un contrat client. L’aperçu du contrat fictif contient onze sections, identifiants et taxes ; il ne prouve pas la remise du contrat individuel après achat.
5. Conserver l’ancien lien du Tableau de bord hors diffusion : taxes à zéro et quantité modifiable. Les paramètres fiscaux globaux Square restent inchangés.
6. En secours, vérifier le paiement dans Square et rapprocher ses références au compte WordPress avant attribution. Un retour navigateur ou une capture client ne suffit pas. Ne jamais demander un second paiement pour corriger un accès en attente.
7. Surveiller les ventes désormais ouvertes (sales=1, production) et les demandes d’assistance pour respecter le délai d’activation de 24 heures.

**Facture Square 000001 :** ébauche enregistrée, sans client et non envoyée, total **113,83 CAD**, PDF des conditions **85,69 kB attaché et enregistré**. Avant un éventuel envoi autorisé, renseigner un vrai destinataire et son récapitulatif individuel. Le brouillon ne constitue ni une vente ni un encaissement.

Procédure technique : [EXPLOITATION.md](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/wordpress/EXPLOITATION.md>). Fermer les ventes WordPress ne désactive pas un lien détenu chez Square.

### C. Finaliser les scénarios Brevo

**Brevo connecté à WordPress ; synchronisation activée sur les quatre listes 3, 4, 5 et 6.** **Migration Brevo confirmée : 28 / 28 modèles inactifs utilisent Neomoov Academy <contact@neomoov.net>, avec réponse à contact@neomoov.net.** Le nouvel export est déployé dans l’extrait WordPress 6 actif. La migration n’a déclenché aucun envoi. Preuve : [28 modèles professionnels](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-28-modeles-professionnels.png>). Les trois enregistrements DNS Brevo ont été ajoutés après autorisation : **neomoov.net est authentifié et contact@neomoov.net est vérifié**. Preuve : [expéditeur professionnel vérifié](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-expediteur-professionnel-verifie.png>). **Les quatre scénarios sont entièrement configurés et restent INACTIFS : Rentabilité #1 / liste 3 / R01–R07 ; Qualité de service #3 / liste 4 / S01–S07 ; Démarrer #4 / liste 5 / D01–D07 ; Entreprise #2 / liste 6 / E01–E07.** Les 28 actions ont été enregistrées avec l’expéditeur professionnel ; les anciens expéditeurs Gmail de E01–E05 ont été corrigés. Délais : 1, 2, 2, 3, 3, 4 jours. Réentrée désactivée sur les quatre scénarios ; sorties enregistrées sur désinscription de tous les emails et retrait immédiat de la liste propre au scénario. Cette configuration vérifiée dans l’interface ne constitue pas une recette d’envoi. La synchronisation exige consentement marketing et première connexion au compte. Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée. Aucune inscription client réelle ni aucun achat ou remboursement réel n’a été testé. Le test technique WordPress reçu précédemment est distinct de Brevo. Aucun parcours marketing automatisé de bout en bout n’est déclaré vérifié.

1. Le domaine neomoov.net est authentifié et contact@neomoov.net est vérifié. Les 28 modèles et les 28 actions des scénarios utilisent désormais l’expéditeur professionnel vérifié. Ne pas refaire les DNS validés.
2. La synchronisation WordPress avec les listes 3, 4, 5 et 6 est active. Vérifier le parcours réel de consentement et de première connexion, puis les sorties après achat ou retrait du consentement ; ne jamais publier la clé API.
3. Les 28 modèles sont importés et inactifs, avec le lien individuel natif de désabonnement. Migration des 28 modèles confirmée ; vérifier les liens et la présentation avant envoi.
4. Les quatre brouillons #1 à #4 sont configurés, avec sept actions chacun, les délais 1/2/2/3/3/4, les réentrées désactivées et les sorties enregistrées. Les garder inactifs jusqu’à validation des tests autorisés.
5. Les essais de réception Brevo, liens, désabonnement et arrêt après achat restent à effectuer. Une demande de test Brevo unique a été effectuée après autorisation, sans confirmation de livraison ni réception et sans renvoi ; aucune campagne commerciale envoyée ; l’email technique WordPress reçu ne valide pas ces scénarios.
6. Respecter les limites du forfait : la documentation officielle consultée indique 300 emails par jour, sans report, et jusqu’à 2 000 contacts uniques entrant dans les automatisations actives. Prévoir la consommation des autres envois. [Limites officielles Brevo](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

### D. Préparer la diffusion publique

1. Préparer les variantes vente adaptées à l’édition écrite désormais ouverte ; conserver les campagnes en brouillon jusqu’à vérification de leur fonctionnement.
2. Mettre les affiches aux bons emplacements, vérifier les légendes, les liens UTM et le rendu sur téléphone.
3. Programmer les publications sur les comptes de Neomoov selon le calendrier. Aucun envoi ni publication sur les réseaux n’est attesté par la présence des fichiers locaux.
4. Après ouverture effective, utiliser les variantes vente et surveiller paiements, accès et demandes de support. Ne pas déclencher les quatre séquences sur la même personne.

## 8. Ce qui peut avancer pendant l’activation des comptes

- Relire et enrichir les sept microleçons et huit fiches sans attendre la finalisation Square.
- Enregistrer les sept scripts vidéo, filmer uniquement les démonstrations adaptées et préparer leur montage.
- Mettre en forme les templates dans Brevo en brouillon, préparer les publications et leurs visuels.
- Compléter la revue des parcours gratuits sur de vrais téléphones. Le contrôle de structure de l’accueil à 390 pixels CSS est réussi ; il ne remplace pas une revue visuelle de toutes les routes.
- Mettre la page de l’offre et les documents de commande en cohérence avec les modalités approuvées et les conditions publiées ; préparer leur copie durable pour chaque client.

**Les ventes sont désormais ouvertes en production ; la campagne du 30 septembre à 10 h Montréal reste à préparer.** **Restent non testés : premier paiement réel, remboursement réel, notification de production liée à une vente, inscription et parcours complet d’un nouveau compte. Aucun accès réel n’a été accordé.** Le compte administrateur UID 1 conserve son dossier Sandbox : utiliser un autre compte neuf pour la recette client réelle. **Un email technique unique a été reçu en boîte de réception**, confirmé par la capture fournie par l’utilisateur. Ce test ne valide pas encore la notification d’un achat réel ni la livraison d’un contrat client. **Brevo connecté à WordPress ; synchronisation activée sur les quatre listes 3, 4, 5 et 6.** **Migration Brevo confirmée : 28 / 28 modèles inactifs utilisent Neomoov Academy <contact@neomoov.net>, avec réponse à contact@neomoov.net.** Le nouvel export est déployé dans l’extrait WordPress 6 actif. La migration n’a déclenché aucun envoi. Preuve : [28 modèles professionnels](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-28-modeles-professionnels.png>). Les trois enregistrements DNS Brevo ont été ajoutés après autorisation : **neomoov.net est authentifié et contact@neomoov.net est vérifié**. Preuve : [expéditeur professionnel vérifié](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-expediteur-professionnel-verifie.png>). **Les quatre scénarios sont entièrement configurés et restent INACTIFS : Rentabilité #1 / liste 3 / R01–R07 ; Qualité de service #3 / liste 4 / S01–S07 ; Démarrer #4 / liste 5 / D01–D07 ; Entreprise #2 / liste 6 / E01–E07.** Les 28 actions ont été enregistrées avec l’expéditeur professionnel ; les anciens expéditeurs Gmail de E01–E05 ont été corrigés. Délais : 1, 2, 2, 3, 3, 4 jours. Réentrée désactivée sur les quatre scénarios ; sorties enregistrées sur désinscription de tous les emails et retrait immédiat de la liste propre au scénario. Cette configuration vérifiée dans l’interface ne constitue pas une recette d’envoi. La synchronisation exige consentement marketing et première connexion au compte. Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée. Aucune inscription client réelle ni aucun achat ou remboursement réel n’a été testé. Le test technique WordPress reçu précédemment est distinct de Brevo. La recette globale n’est pas déclarée terminée.

## Copie conservable des conditions

[Conditions CAP CHAUFFEUR - PDF du 29 septembre 2026](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/marketing/CONDITIONS_CAP_CHAUFFEUR_2026-09-29.pdf>) : quatre pages numérotées, texte final avec NEQ et identifiants TPS/TVQ, contrôle textuel et inspection visuelle après rendu effectués. Les identifiants fiscaux sont également publiés sur les pages WordPress 1909 et 1426 selon la confirmation du responsable de l’intégration. Le PDF peut accompagner une facture client et le récapitulatif individuel du contrat. Le PDF de **85,69 kB** est **attaché à la facture interne 000001 et enregistré**. La facture reste en ébauche sans client et n’a pas été envoyée.


## Point de passage — scénarios prêts, envois non activés

Preuves des configurations : `livraison/brevo-rentabilite-7-etapes.png`, `livraison/brevo-service-7-etapes.png`, `livraison/brevo-demarrer-7-etapes.png`, `livraison/brevo-entreprise-7-etapes.png` et `livraison/brevo-entreprise-conditions.png` (chemins depuis la racine du dossier livré).

**Prochaines vérifications :** autorisation reçue et demande de test Brevo unique effectuée ; livraison et réception non confirmées, aucun renvoi, aucune campagne commerciale ni ajout de contact. Parcours complet d’inscription client, premier paiement réel Square, remise du contrat client et remboursement réel toujours non vérifiés. Les URL des comptes sociaux n’ont pas été fournies ; aucune publication sociale effectuée.


## Dernière recette publique et mobile

**Accueil à 390 pixels CSS : structure contrôlée sans débordement.** Le contrôle DOM communiqué par le responsable de l’intégration mesure une largeur et une largeur défilable de 390 pixels CSS, sans débordement des en-têtes, titres, paragraphes, boutons/CTA et champs inspectés. L’image principale débute à 875 px, sous le CTA (bas à 737 px) et le texte (bas à 825 px) : aucun chevauchement mesuré. La découpe initiale provenait du zoom de l’outil ; une largeur demandée de 335 pixels physiques a produit les 390 pixels CSS mesurés. Captures : `livraison/academy-mobile-layout-controle.png` et `livraison/academy-mobile-390.png` (chemins depuis la racine). La capture recadrée conserve un artefact de zoom : aucune validation visuelle de toutes les routes mobiles n’est revendiquée. Une revue sur de vrais téléphones reste conseillée.

Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée.


## Test Brevo unique autorisé — résultat non confirmé

Après autorisation explicite, le bouton « Envoyer le test » a été cliqué une seule fois pour R01, message d’automatisation 29, de contact@neomoov.net vers le seul destinataire neomoov1@gmail.com. Le bouton s’est désactivé pendant le traitement puis est redevenu disponible. Aucun succès ni erreur explicite n’a été capturé ; les zones d’alerte et de statut étaient vides. La page Transactionnel / Logs affichait zéro journal pour le 23–30 septembre, mais elle peut ne pas couvrir ce test marketing : cela ne prouve pas un échec. La réception a été demandée à l’utilisateur et reste non confirmée. Aucun renvoi effectué. La capture `livraison/brevo-test-r01-envoi.png` montre seulement l’interface après la demande, pas une confirmation de livraison. Les quatre scénarios restent inactifs ; aucune campagne commerciale ni ajout de contact n’a été effectué.
