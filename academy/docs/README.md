# Livrables marketing — CAP CHAUFFEUR

**Point d’entrée :** ouvrir `CAP_CHAUFFEUR_dossier_marketing.html` dans un navigateur. Il réunit les trois dossiers, avec navigation et styles d’impression A4. Le bouton « Imprimer / PDF » utilise le navigateur ; aucun PDF n’est présenté comme déjà généré.

## État du 30 septembre — domaine et expéditeur vérifiés

**Brevo connecté à WordPress ; synchronisation activée sur les quatre listes 3, 4, 5 et 6.** **Migration Brevo confirmée : 28 / 28 modèles inactifs utilisent Neomoov Academy <contact@neomoov.net>, avec réponse à contact@neomoov.net.** Le nouvel export est déployé dans l’extrait WordPress 6 actif. La migration n’a déclenché aucun envoi. Preuve : [28 modèles professionnels](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-28-modeles-professionnels.png>). Les trois enregistrements DNS Brevo ont été ajoutés après autorisation : **neomoov.net est authentifié et contact@neomoov.net est vérifié**. Preuve : [expéditeur professionnel vérifié](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-expediteur-professionnel-verifie.png>). **Les quatre scénarios sont entièrement configurés et restent INACTIFS : Rentabilité #1 / liste 3 / R01–R07 ; Qualité de service #3 / liste 4 / S01–S07 ; Démarrer #4 / liste 5 / D01–D07 ; Entreprise #2 / liste 6 / E01–E07.** Les 28 actions ont été enregistrées avec l’expéditeur professionnel ; les anciens expéditeurs Gmail de E01–E05 ont été corrigés. Délais : 1, 2, 2, 3, 3, 4 jours. Réentrée désactivée sur les quatre scénarios ; sorties enregistrées sur désinscription de tous les emails et retrait immédiat de la liste propre au scénario. Cette configuration vérifiée dans l’interface ne constitue pas une recette d’envoi. La synchronisation exige consentement marketing et première connexion au compte. Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée. Aucune inscription client réelle ni aucun achat ou remboursement réel n’a été testé. Le test technique WordPress reçu précédemment est distinct de Brevo.

`emails_html/brevo-ready/` contient les 28 versions importées avec le lien natif `{{ unsubscribe }}`, les taxes et l’identité légale. Les mentions historiques ci-dessous relatives aux 56 variantes décrivent leurs sources éditoriales.

## Inventaire

- `01_tunnels_et_pilotage.md` : quatre tunnels Rentabilité / Service / Démarrer / Entreprise, promesse, étapes, objections, calendrier de lancement, configuration Brevo, règles de consentement et de sortie, messages de service.
- `02_sequences_email.md` : quatre lots de sept emails, soit **28 messages**. Chacun possède un sujet, un préheader, un corps complet, deux fins alternatives, un CTA avec UTM et le pied d’identification.
- `03_publications.md` : **20 publications** complètes, chacune avec canal, angle, idée visuelle, texte, variantes selon l’état d’ouverture et lien UTM. Six réponses types aux commentaires complètent le dossier.
- `CAP_CHAUFFEUR_dossier_marketing.html` : version mise en page réunissant ces trois dossiers.
- `emails_source.json` : données structurées des 28 emails pour intégration. Ce n’est pas un fichier d’import Brevo universel ; les automatisations doivent être créées et testées dans le compte.
- `emails_html/preouverture/` : **28 templates HTML** prêts à intégrer en brouillon.
- `emails_html/vente/` : **28 variantes HTML** à utiliser uniquement après activation et vérification de l’offre.
- `generer_livrables.cjs` : générateur local des HTML et du JSON, sans dépendance externe. Commande : `node livraison/marketing/generer_livrables.cjs` depuis la racine du projet.

## Avant utilisation

Les 56 templates sont deux versions de 28 emails, et non 56 messages successifs. Ne jamais envoyer les quatre lots à la même personne. Dans les sources historiques `preouverture/` et `vente/`, le marqueur du **lien individuel de désabonnement** doit être remplacé avant usage. Les 28 versions `brevo-ready/` déjà importées utilisent le lien natif `{{ unsubscribe }}`. Une vérification des liens et un test interne sont nécessaires avant activation.

Le prix de lancement de **99 $ CA avant taxes** est approuvé ; pour une vente taxable au Québec, le total est **113,83 $ CA**. Aucune fausse remise n’est construite autour de 199 $ CA. Les CTA renvoient aux pages publiées sur neomoov.net, contrôlées ci-dessous. La connexion Brevo est active, mais les modèles et scénarios restent inactifs ; aucun paiement réel n’est déclaré testé.

Le calendrier vise le **30 septembre 2026 à 10 h à Montréal**. Les annonces sont conditionnées aux tests réels. Les vidéos, applications mobiles et fonctionnalités envisagées dans les références ne sont jamais présentées comme déjà livrées.

## Contrôles effectués

**Dernier contrôle public, après déploiement : 30 septembre 2026 à 01:12:14 UTC.** Les douze routes contrôlées répondent en HTTP 200, sans erreur PHP visible ni ancien lien Square. Les cinq pages d’offre affichent le total cohérent de 113,83 $ CA ; membre et formation demandent toujours une connexion au visiteur anonyme. Contrôle en lecture seule : aucune inscription ni aucun paiement soumis. Le contrôle précédent des cinq offres à 21:19 UTC le 29 septembre était également sans régression.

Comptage automatisé : quatre lots de sept emails, vingt publications, cinquante-six variantes HTML. Vérification structurelle des sujets, préheaders, fins, CTA et UTM par le générateur. Les documents HTML disposent d’une langue fr-CA, d’un encodage UTF-8 et d’une mise en page adaptative. Aucun test de délivrabilité, activation d’automatisation, publication externe ou envoi commercial n’a été effectué dans ce lot de travail.

Références rédactionnelles : `references_extraites/FORMATION_CHAUFFEURS_VERSION_FINALE_WORD.txt` et `references_extraites/RETRANSCRIPTION_BRUTE_PAROLES_FORMATION_CHAUFFEURS.txt`.

Limites Brevo consultées le 29 septembre 2026 : https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan

## Actualisation de l’exploitation

Les modalités de la première édition écrite sont approuvées : 7 microleçons et 8 fiches, 12 mois calendaires d’accès à partir de l’activation, activation sous 24 heures après paiement confirmé, remboursement commercial sur demande dans les 14 jours, traitement du remboursement sur le moyen d’origine sous 14 jours et première réponse support sous 2 jours ouvrés. Les vidéos ne sont pas incluses.

Application Square « Neomoov Academy » créée avec autorisation ; facture interne 000001 vérifiée à 113,83 $ CA, conservée en ébauche non envoyée. Ce brouillon seul ne prouve pas un paiement réussi. L’API a depuis été vérifiée en Sandbox et les ventes sont ouvertes en production ; aucun encaissement ou remboursement réel n’a été testé. Brevo est désormais connecté ; consulter l’état actualisé ci-dessus. **NEQ 1181499600 vérifié officiellement le 29 septembre 2026 à 14 h 39 EDT** pour Groupe Nouveau Système Kardinal (Groupe NSK) Inc., nom et adresse concordants ; preuve locale `../neq-groupe-nsk-verifie.png`. Les numéros **TPS/TVH 755212438 RT0001** et **TVQ 1233281863 TQ0001** ont été **fournis par l’utilisateur** ; aucune vérification Revenu Québec n’est déclarée.

Les conditions sont publiées sur **https://neomoov.net/conditions-cap-chauffeur/** : page WordPress **1909**, mise en ligne le **29 septembre 2026 à 14 h 27 EDT** (Montréal), selon la confirmation du responsable de l’intégration. Les variantes préouverture sont conservées comme sources historiques. Les variantes vente sont préparées en brouillon ; aucun scénario ne doit être présenté comme actif avant sa configuration et sa vérification effectives. Consulter `../DEMARRAGE_ET_ETAT.md` et `CONDITIONS_CAP_CHAUFFEUR_NOTES_INTERNES.md` pour les prochaines opérations.

Le NEQ a été publié sur les conditions WordPress 1909 et les mentions légales 1426 avant 14 h 45, selon les preuves communiquées par le responsable de l’intégration. Les identifiants fiscaux fournis sont maintenant repris dans les sources locales ; leur ajout aux pages publiques WordPress 1909 et 1426 est confirmé par le responsable de l’intégration (« Page mise à jour »).

Copie conservable finale : `CONDITIONS_CAP_CHAUFFEUR_2026-09-29.pdf`, quatre pages, pagination, identifiants vendeur et taxes inclus. Contrôle du texte et inspection visuelle après rendu réalisés. PDF prêt à joindre au brouillon de facture Square ; aucune facture envoyée dans ce lot.


## Point de passage — scénarios prêts, envois non activés

Preuves des configurations : `livraison/brevo-rentabilite-7-etapes.png`, `livraison/brevo-service-7-etapes.png`, `livraison/brevo-demarrer-7-etapes.png`, `livraison/brevo-entreprise-7-etapes.png` et `livraison/brevo-entreprise-conditions.png` (chemins depuis la racine du dossier livré).

**Prochaines vérifications :** autorisation reçue et demande de test Brevo unique effectuée ; livraison et réception non confirmées, aucun renvoi, aucune campagne commerciale ni ajout de contact. Parcours complet d’inscription client, premier paiement réel Square, remise du contrat client et remboursement réel toujours non vérifiés. Les URL des comptes sociaux n’ont pas été fournies ; aucune publication sociale effectuée.


## Dernière recette publique et mobile

**Accueil à 390 pixels CSS : structure contrôlée sans débordement.** Le contrôle DOM communiqué par le responsable de l’intégration mesure une largeur et une largeur défilable de 390 pixels CSS, sans débordement des en-têtes, titres, paragraphes, boutons/CTA et champs inspectés. L’image principale débute à 875 px, sous le CTA (bas à 737 px) et le texte (bas à 825 px) : aucun chevauchement mesuré. La découpe initiale provenait du zoom de l’outil ; une largeur demandée de 335 pixels physiques a produit les 390 pixels CSS mesurés. Captures : `livraison/academy-mobile-layout-controle.png` et `livraison/academy-mobile-390.png` (chemins depuis la racine). La capture recadrée conserve un artefact de zoom : aucune validation visuelle de toutes les routes mobiles n’est revendiquée. Une revue sur de vrais téléphones reste conseillée.

Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée.


## Test Brevo unique autorisé — résultat non confirmé

Après autorisation explicite, le bouton « Envoyer le test » a été cliqué une seule fois pour R01, message d’automatisation 29, de contact@neomoov.net vers le seul destinataire neomoov1@gmail.com. Le bouton s’est désactivé pendant le traitement puis est redevenu disponible. Aucun succès ni erreur explicite n’a été capturé ; les zones d’alerte et de statut étaient vides. La page Transactionnel / Logs affichait zéro journal pour le 23–30 septembre, mais elle peut ne pas couvrir ce test marketing : cela ne prouve pas un échec. La réception a été demandée à l’utilisateur et reste non confirmée. Aucun renvoi effectué. La capture `livraison/brevo-test-r01-envoi.png` montre seulement l’interface après la demande, pas une confirmation de livraison. Les quatre scénarios restent inactifs ; aucune campagne commerciale ni ajout de contact n’a été effectué.
