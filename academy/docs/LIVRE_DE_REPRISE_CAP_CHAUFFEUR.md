# Livre de reprise — Neomoov Academy / CAP CHAUFFEUR

Version de reprise : 1er octobre 2026, fuseau de référence `America/Toronto` (Montréal).

Ce document permet à un autre développeur ou à un agent IA de comprendre, auditer, reproduire et terminer le produit. Il sépare l’état réellement observé, le code présent, la configuration déployée et les éléments encore non validés.

## 1. Résultat attendu

CAP CHAUFFEUR est une formation écrite de Neomoov Academy vendue par Neomoov, marque de **GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.** Elle vise les chauffeurs taxi/VTC, futurs chauffeurs, passagers, exploitants et investisseurs du transport rémunéré à Montréal.

Offre actuellement définie :

- 99,00 $ CA avant taxes ;
- TPS 5 % : 4,95 $ CA ;
- TVQ 9,975 % : 9,88 $ CA ;
- total Québec : 113,83 $ CA ;
- sept microleçons écrites et huit fiches pratiques ;
- exercices et corrigés ;
- accès de douze mois calendaires après activation ;
- activation annoncée sous 24 heures après paiement confirmé ;
- remboursement demandé dans les 14 jours suivant l’activation, selon les conditions publiées ;
- première réponse du support sous deux jours ouvrés ;
- les vidéos et les applications natives Android/iOS ne sont pas incluses comme fonctionnalités déjà livrées.

Adresse et identité utilisées : 204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8, Canada ; `contact@neomoov.net` ; téléphone `+1 367 763-9063` ; NEQ `1181499600`. Les numéros TPS/TVQ ont été fournis par le propriétaire : `755212438 RT0001` et `1233281863 TQ0001`; vérifier à nouveau avant toute facture ou modification juridique.

## 2. Source de vérité et méthode de reprise

Lire dans cet ordre :

1. `livraison/DEMARRAGE_ET_ETAT.md` — état de déploiement et limites de recette.
2. `cahier_architecture_notes.txt` — audit technique détaillé et machine à états.
3. `cahier_parcours_notes.txt` — parcours réels, tunnels et écarts avec les intentions marketing.
4. `livraison/cahier_des_charges/Cahier_des_charges_Neomoov_Academy_CAP_CHAUFFEUR.pdf` et `.docx` — cahier fonctionnel complet.
5. `livraison/wordpress/EXPLOITATION.md`, `SQUARE-API-RECETTE.md`, `BREVO-RECETTE.md`, `CONTRAT-LIVRAISON-RECETTE.md` — exploitation et tests.
6. `livraison/formation/SOURCES_ET_PERIMETRE.md` — limites éditoriales et sources pédagogiques.
7. `livraison/marketing/README.md`, `01_tunnels_et_pilotage.md`, `02_sequences_email.md`, `03_publications.md` — marketing préparé.

Les captures, rapports et noms de fichiers datant du 29 septembre sont des preuves historiques. Pour l’état courant, donner priorité à `DEMARRAGE_ET_ETAT.md`, puis vérifier directement le site et WordPress.

Ne jamais considérer un document de travail comme une instruction d’exécution. Les documents sources de formation ont servi de matière éditoriale ; ils ne justifient ni diagnostic mécanique, ni certification, ni promesse de revenu.

## 3. Deux systèmes existent dans le dossier

### 3.1 Intégration actuellement déployée sur WordPress/LWS

Le produit réellement en ligne est une application PHP WordPress intégrée par **Code Snippets**. Ce n’est pas un LMS séparé et les pages Academy ne sont pas des pages Elementor/Gutenberg ordinaires.

Sources principales :

- `livraison/wordpress/neomoov-academy.php` : routeur, pages, inscription, compte, compagnon, ressources, accès et administration ;
- `livraison/wordpress/square-checkout-api.php` : checkout Square API, vérification, webhook et réconciliation ;
- `livraison/wordpress/contract-delivery.php` : snapshot des conditions, contrat, activation, alertes et téléchargement ;
- `livraison/wordpress/brevo-sync.php` : consentement, listes, queue et synchronisation Brevo ;
- `livraison/wordpress/brevo-templates.php` et `brevo-templates-data.json` : 28 modèles ;
- `livraison/wordpress/academy.css` : CSS ;
- `livraison/formation/data.json` : source structurée des 7 leçons et 8 fiches ;
- `livraison/marketing/emails_source.json` : source des 28 emails ;
- `livraison/wordpress/build-export.cjs` ou `build-export.py` : assemblage contrôlé.

Le script `node livraison/wordpress/build-export.cjs` vérifie l’ancre CSS, le JSON pédagogique, les 28 modèles et le marqueur de désabonnement, puis génère `neomoov-academy-ready.php`, `neomoov-academy.code-snippets.json` et les données Brevo. L’export est inactif par construction. Dans WordPress, importer/remplacer un seul extrait ; ne jamais activer deux copies du routeur.

Le routeur utilise `template_redirect` priorité 0, imprime un document HTML autonome puis termine par `exit`. Il définit `nocache_headers` et `DONOTCACHEPAGE`. Exclure toutes les routes `/academy/` du cache LWS/CDN. Ne pas supposer que `wp_head` ou `wp_footer` du thème s’exécutent.

### 3.2 Dossier `site/`

`site/` est un starter Vinext/Next/Cloudflare indépendant, avec React, Vite, Wrangler, Drizzle et D1 optionnel. Il n’est pas la preuve que CAP CHAUFFEUR est déployé sur ce runtime. Ne pas remplacer WordPress par ce starter sans décision d’architecture et migration explicite.

Commandes documentées dans `site/README.md` :

```text
npm run install:ci
npm run dev
npm run build
npm run start
npm run lint
npm run db:generate
```

Node requis : `>=22.13.0`. Le site contient une simulation de connexion locale pour prévisualisation ; elle n’est pas un système de comptes de production. Si le nouveau développeur choisit ce runtime, il doit produire un plan de migration, un schéma de données et une recette séparée.

## 4. Routes WordPress et droits

Routes autorisées par le routeur :

- `/academy/` : accueil et orientation ;
- `/academy/rentabilite/` : chauffeurs en activité ;
- `/academy/service/` : qualité de service et expérience client ;
- `/academy/demarrer/` : futurs chauffeurs ;
- `/academy/entreprise/` : exploitants, entreprises et investisseurs ;
- `/academy/inscription/` : compte gratuit ;
- `/academy/membre/` : espace membre ;
- `/academy/formation/` : contenu payant ;
- `/academy/compagnon/` : calculateur et recommandations à partir d’un questionnaire ;
- `/academy/ressources/` : fiches publiques ;
- `/academy/passagers/` : conseils passagers ;
- `/academy/confidentialite/` : confidentialité.

Les conditions de vente et mentions légales sont des pages WordPress séparées. La page de conditions actuellement capturée par le contrat est l’ID WordPress **1909** ; ne pas coder cet ID dans une nouvelle installation sans le paramétrer.

Visiteur : pages de vente, inscription, compagnon, huit fiches publiques et page passagers. Un visiteur anonyme qui ouvre `/membre/` ou `/formation/` obtient un lien de connexion et de mot de passe oublié, jamais les leçons.

Membre gratuit : tableau de bord, sauvegarde de bilans, retrait du consentement, accès aux ressources et possibilité de commencer l’achat. Pas de microleçons payantes.

Membre payant valide : sept leçons avec introduction, sections, exercice et corrigé, protégées par `nma_has_access()` et une échéance serveur.

Administrateur `manage_options` : réglages, état Square/Brevo, réconciliation et aperçu explicitement signalé comme fictif. L’aperçu administrateur ne prouve jamais l’accès d’un client.

Inscription : POST muni du nonce `nma_action`, prénom et email obligatoires, honeypot `website` vide, limite de cinq demandes par heure et IP hachée, rôle `subscriber`, mot de passe aléatoire et email WordPress de définition du mot de passe. Si le compte existe, la réponse ne révèle pas la situation et ne crée pas d’achat.

Le consentement marketing est facultatif et non pré-coché. Le retrait passe par un POST authentifié et met `nma_consent` à `no`.

## 5. Contenu pédagogique réellement livré

Source : `livraison/formation/data.json`. Le guide est généré par `generer-guide.ps1` et disponible en Markdown et HTML.

Livré :

- 7 microleçons écrites ;
- 8 fiches pratiques ;
- exercices et corrigés ;
- chiffres fictifs en CAD ;
- recommandations d’organisation, communication, service et suivi ;
- scripts de communication adaptables ;
- aucune certification réglementaire ;
- aucune promesse de revenu ;
- aucun diagnostic mécanique par photo ;
- aucune reconnaissance d’image ou notation IA ;
- aucune vidéo effectivement produite dans ce lot.

Les scripts `SCRIPT_VIDEO_01` à `SCRIPT_VIDEO_07` et `CAP_CHAUFFEUR_7_SCRIPTS_VIDEO.md` sont des scripts de production, pas des fichiers vidéo disponibles à la vente.

Le compagnon accepte jusqu’à quatre images JPEG/PNG/WebP de 8 Mo chacune, traitées dans le navigateur. Il ne téléverse pas les photos, ne fait pas de vision IA et ne remplace pas un diagnostic mécanique ou une inspection réglementaire. Le calcul de rentabilité utilise recettes, coûts, heures et kilomètres saisis ; il ne calcule pas la fiscalité complète et ne promet pas un résultat.

## 6. Parcours commercial réel

Le parcours réel commun est :

1. publication ou recherche ;
2. page d’orientation ;
3. CTA « Commencer gratuitement » ;
4. `/academy/inscription/?parcours=...` ;
5. création de compte WordPress ;
6. email WordPress de définition du mot de passe ;
7. première connexion ;
8. `/academy/membre/`, ressources et bilans gratuits ;
9. si consentement + première connexion, synchronisation d’une seule liste Brevo ;
10. formulaire d’achat protégé de l’espace membre ;
11. acceptation des conditions et données de facturation ;
12. création d’un lien de paiement Square API ;
13. paiement hébergé par Square ;
14. retour navigateur sans attribution automatique ;
15. vérification côté serveur, bouton membre, webhook ou réconciliation admin ;
16. contrôle du paiement, de la commande, du montant, de la devise, de l’établissement et de la facturation CA/QC ;
17. activation, contrat et email d’activation uniquement après état `paid` ;
18. accès `/academy/formation/` jusqu’à l’échéance.

Le paiement ne dépend pas du consentement marketing. Un utilisateur peut acheter sans recevoir de marketing.

Les quatre orientations sont :

- Rentabilité : chauffeurs en activité, kilomètres à vide, temps et coûts ;
- Service : accueil, confort, préparation du véhicule, communication ;
- Démarrer : préparation d’un futur chauffeur ;
- Entreprise : organisation, indicateurs, exploitation et investissement.

Les intentions initiales de quatre lead magnets, pages merci dédiées, DOI natif, attributs CRM CAP_*, UTM persistants et règles d’envoi conditionnel ne sont pas toutes implémentées. Les liens UTM existent dans les emails, mais aucune attribution UTM persistante n’est déclarée.

## 7. Paiement Square : fonctionnement à préserver

Prestataire courant : Square API en production, sans modification des taxes globales Square.

Webhook exact :

```text
https://neomoov.net/wp-json/neomoov-academy/v1/square-api
```

Événements : `payment.created`, `payment.updated`, `refund.created`, `refund.updated`.

Application de production connue : `sq0idp-dBCk589ULLjaIgPP-KiMJw`.
Emplacement connu : `L7F5673XP5SKQ`.
Application sandbox connue séparément : `sandbox-sq0idb-ie9Ad1rCmSpdAQmfJyxZCQ`.

Ne pas copier un jeton ou une clé dans Git, dans un rapport ou dans une réponse. Les valeurs sont stockées localement dans `site/SQUARE_NEOMOOV_VTC.env` et dans les réglages privés de WordPress. Le fichier `site/.env` contient encore des variables Square vides ou appartenant à une autre application : ne pas le prendre comme source de vérité sans correction explicite.

Le module envoie les appels HTTPS à `connect.squareup.com` en production et `connect.squareupsandbox.com` en sandbox, avec version Square `2026-09-16` et timeout de 25 secondes. Il vérifie l’établissement `ACTIVE`, pays CA, devise CAD et capacité de traitement carte.

La commande est ad hoc, quantité 1 :

```text
CAP CHAUFFEUR — 99,00 CAD
TPS 4,95 CAD
TVQ 9,88 CAD
Total 113,83 CAD
```

`auto_apply_taxes=false`, pas de remise, pourboire, coupon, catalogue ou fidélité. Le payload avec clé d’idempotence est persisté avant la requête et réutilisé après un timeout.

États principaux : `creating`, `pending`, `billing_review`, `paid`, `sandbox_paid`, `refunded`. `sandbox_paid` ne doit jamais ouvrir un accès réel.

Le retour vers `/academy/membre/?squareapi=retour` ne donne jamais l’accès. Le bouton de vérification relit Square côté serveur. Un paiement de production doit être `COMPLETED`, associé à la bonne commande et au bon membre, en CAD, avec source `CARD` ou `WALLET`. L’exception `EXTERNAL / Developer Control Panel` est strictement sandbox.

La signature webhook est `base64(HMAC-SHA256(URL exacte + corps brut, clé privée))`, dans `x-square-hmacsha256-signature`. Corps maximum 1 Mo. Une signature invalide reçoit 403. Les événements valides sont mis en file WP-Cron ; le worker relit Square et ne fait pas confiance aux montants fournis dans la notification.

Attention : WP-Cron dépend du trafic. Prévoir un cron système ou une surveillance de file pour une exploitation fiable.

Un remboursement total donne un état terminal `refunded` et ne doit pas réactiver l’accès lorsqu’un ancien webhook arrive. Les remboursements partiels demandent une décision humaine. Le code ne déclenche pas lui-même les remboursements Square.

## 8. Contrat, emails transactionnels et conservation

`contract-delivery.php` capture la page publiée des conditions avant paiement, avec titre, date de modification, HTML nettoyé et SHA-256. Le snapshot est conservé avec l’identité de l’acheteur, le vendeur, l’offre, les taxes, la référence et le paiement.

Le contrat est créé après paiement de production vérifié. L’activation n’est envoyée qu’après `paid` et `nma_paid=yes`. Les alertes de revue de facturation sont distinctes. Un email WordPress accepté par `wp_mail()` signifie accepté par le transport, pas livré dans la boîte du destinataire.

Les documents sont stockés dans les métadonnées utilisateur et téléchargeables par le propriétaire connecté ou un administrateur avec nonce. Ils restent disponibles après expiration ou remboursement, selon la politique de conservation à finaliser.

Les files d’email ont des verrous, statuts et reprises. Une panne après acceptation du transport peut produire `mail_result_unknown`; l’équipe doit vérifier avant renvoi.

## 9. Brevo : état et fonctionnement

Connexion privée WordPress/Brevo active. Domaine `neomoov.net` authentifié ; `contact@neomoov.net` vérifié. Quatre listes :

| Parcours | Liste | ID |
|---|---|---:|
| rentabilite | CAP CHAUFFEUR — Rentabilité | 3 |
| service | CAP CHAUFFEUR — Qualité de service | 4 |
| demarrer | CAP CHAUFFEUR — Démarrer | 5 |
| entreprise | CAP CHAUFFEUR — Entreprise | 6 |

28 modèles sont importés avec `Neomoov Academy <contact@neomoov.net>` et réponse à `contact@neomoov.net`. Les quatre scénarios existent mais restent **INACTIFS** : Rentabilité #1, Service #3, Démarrer #4, Entreprise #2. Délais enregistrés : 1, 2, 2, 3, 3, 4 jours.

Une adresse n’est synchronisée qu’après consentement marketing explicite et première connexion. Une seule liste correspondant au parcours est utilisée. Retrait du consentement : retrait des listes Academy ; un désabonnement Brevo n’est jamais annulé automatiquement. Un achat confirmé ou un remboursement exclut les relances.

Ne pas activer les scénarios avant d’avoir testé avec un compte ordinaire neuf : inscription → consentement → définition du mot de passe → première connexion → bonne liste → retrait → arrêt après achat. Le test Brevo effectué précédemment n’a pas fourni de confirmation de réception ; aucun renvoi ne doit être considéré acquis.

La clé Brevo ne doit figurer ni dans le dépôt ni dans ce document. Dans l’environnement local, `site/SQUARE_NEOMOOV_VTC.env` contient une variable `HUBSPOT_ACCESS_TOKEN` et les variables Square ; vérifier le stockage réel de la clé Brevo côté WordPress privé plutôt que de recopier une clé.

## 10. HubSpot et autres services

Un service key HubSpot a été créé pour le portail `343738989`, avec scopes contacts lecture/écriture. La variable locale `HUBSPOT_ACCESS_TOKEN` est présente dans `site/SQUARE_NEOMOOV_VTC.env` sous forme secrète. Aucune synchronisation métier CAP CHAUFFEUR n’est décrite comme déployée dans WordPress : vérifier avant d’annoncer une intégration CRM.

Stripe est conservé dans le code historique mais n’est pas le prestataire actif. Ne pas basculer vers Stripe sans nouvelle vérification prix, taxes, webhooks, contrats et états.

## 11. Variables d’environnement et sécurité

Fichiers locaux repérés :

- `site/SQUARE_NEOMOOV_VTC.env` : valeurs configurées pour Square VTC et HubSpot ; ne pas committer ; ne jamais imprimer les valeurs ;
- `site/.env` : environnement de développement incomplet, avec jetons Square vides et identifiants d’une autre application ; ne pas l’utiliser en production ;
- réglages WordPress privés `nma_settings` : source opérationnelle de l’extrait WordPress pour Square/Brevo.

Noms attendus :

```text
SQUARE_ACCESS_TOKEN
SQUARE_SANDBOX_ACCESS_TOKEN
SQUARE_LOCATION_ID
SQUARE_APPLICATION_ID
SQUARE_WEBHOOK_SIGNATURE_KEY
HUBSPOT_ACCESS_TOKEN
```

Le fichier `SQUARE_NEOMOOV_VTC.env` contient également `SQUARE_SANDBOX_APPLICATION_ID`. Si le développeur change de compte ou d’application, recréer les identifiants et le webhook ; ne pas réutiliser des identifiants d’un autre compte.

Règles obligatoires :

- `.env` dans `.gitignore` ;
- rotation immédiate si une clé a été exposée ;
- secrets transmis hors dépôt, idéalement gestionnaire de secrets ou réglage privé chiffré au niveau serveur ;
- aucun secret dans captures, rapports, tickets ou logs ;
- journaliser seulement nom de variable, présence, longueur ou préfixe non sensible ;
- séparer production et sandbox ;
- tester les signatures avec un faux secret, jamais avec le secret réel dans une fixture publique.

## 12. Marketing et réseaux sociaux

Livrables :

- `livraison/marketing/CAP_CHAUFFEUR_dossier_marketing.html` ;
- `01_tunnels_et_pilotage.md` ;
- `02_sequences_email.md` ;
- `03_publications.md` ;
- `emails_html/preouverture/` et `emails_html/vente/` ;
- `reseaux_sociaux/lancement_neomoov_20260930/` ;
- `RAPPORT_PUBLICATIONS.html` et `publications.json`.

La cadence demandée est deux publications par jour, à 08:00 et 20:00, heure de Montréal. Aucune automatisation sociale autonome n’est implémentée dans le produit. Les comptes et droits doivent être vérifiés directement dans chaque interface.

La première campagne de présentation a été publiée et vérifiée sur Facebook, LinkedIn, Instagram, TikTok, YouTube, Telegram, WhatsApp, X et le blog. Snapchat a été bloqué par `Organization not spend ready`; un visuel final est conservé, mais l’envoi web n’a pas été confirmé.

Liens connus :

- Facebook : `https://www.facebook.com/neomoov1`
- Instagram : `https://www.instagram.com/neomoov`
- LinkedIn : profil Neo Moov fourni par le propriétaire
- X : `https://x.com/NeoMoov`
- YouTube : `https://youtube.com/@neomoov`
- TikTok : `https://www.tiktok.com/@neo.moov`
- Telegram : `https://t.me/neomoov`
- WhatsApp contact : `https://wa.me/13677639063`
- Snapchat : `https://www.snapchat.com/add/neomoov`
- Blog : `https://neomoov.net`

Ne pas attribuer un compte sur le seul nom, ne pas inventer de témoignage, ne pas promettre un revenu, ne pas présenter les scripts comme des vidéos, ne pas envoyer de message privé aux prospects et ne pas lancer de publicité payante sans instruction distincte.

## 13. Performances du site à reprendre

Le problème initial signalé concerne des pages lourdes : environ 0,6 à 1,2 Mo de HTML, jusqu’à 2,6 Mo pour certains formulaires, et des temps LWS de 1,8 à 2,2 secondes sur Affiliation/Contact/Chauffeurs/Entreprises et 6 à 12 secondes sur des formulaires.

État documenté : thème Astra, extensions SureForms, Spectra, SureCookie et LWS Optimize ; cache fichier et RUM actifs ; Memcached inactif. Aucune correction complète de performance n’est déclarée appliquée.

Plan de mesure :

1. capturer TTFB, poids HTML, nombre de requêtes, CSS/JS, images et Core Web Vitals sans cache ;
2. refaire avec cache LWS et depuis plusieurs régions ;
3. identifier les shortcodes/formulaires qui produisent le HTML lourd ;
4. réduire le DOM, différer les scripts non essentiels, compresser/redimensionner les images ;
5. exclure uniquement les routes nécessitant session du cache ;
6. activer un cache objet seulement après mesure de compatibilité ;
7. vérifier que `/academy/` conserve `DONOTCACHEPAGE` et les en-têtes sans cache ;
8. refaire un test mobile réel et une recette de soumission.

Ne pas optimiser en supprimant les nonces, les contrôles de permission, les signatures webhook ou les données contractuelles.

## 14. Plan de révision technique obligatoire

### Phase A — sauvegarde et inventaire

- exporter la base WordPress, les Code Snippets, les médias, les réglages et les DNS ;
- récupérer la version exacte de PHP, WordPress, thème et extensions ;
- vérifier les URL, fuseau WordPress (`America/Toronto` recommandé), cron et cache ;
- vérifier l’empreinte des fichiers fournis ;
- exclure secrets et comptes réels des sauvegardes partagées.

### Phase B — staging

- cloner vers un staging HTTPS ;
- utiliser des clés Square sandbox et un webhook sandbox distinct ;
- utiliser un compte WordPress test neuf ;
- désactiver les scénarios Brevo ;
- interdire indexation et transactions réelles ;
- consigner l’URL et la date de chaque recette.

### Phase C — code et assemblage

- lire `neomoov-academy.php` avant toute modification ;
- ne garder qu’un extrait actif ;
- régénérer avec `build-export.cjs` ;
- contrôler syntaxe PHP, JSON et CSS ;
- centraliser ensuite l’offre (prix, taxes, durée) au lieu de modifier des valeurs codées à plusieurs endroits ;
- paramétrer l’ID de page CGV, le vendeur et les médias ;
- conserver les protections nonce, capability, idempotence et signature.

### Phase D — comptes et accès

Tester avec un compte ordinaire :

- inscription gratuite ;
- email de définition du mot de passe ;
- première connexion ;
- consentement accepté puis retiré ;
- accès ressources ;
- blocage formation avant paiement ;
- expiration ;
- récupération du mot de passe ;
- logout ;
- compte administrateur séparé.

### Phase E — paiement sandbox

- créer un checkout unique ;
- contrôler 99 + taxes = 113,83 CAD ;
- vérifier idempotence double clic et timeout ;
- modifier les champs côté navigateur pour confirmer le refus serveur ;
- confirmer qu’un retour navigateur ne donne rien ;
- tester signature webhook fausse, corps trop grand et événement inconnu ;
- envoyer les quatre webhooks sandbox ;
- vérifier `sandbox_paid` sans accès réel ;
- tester revue de facturation et réconciliation.

### Phase F — contrat et emails

- vérifier snapshot des conditions avant paiement ;
- modifier les conditions après création et confirmer le blocage de reprise ;
- contrôler contrat, activation, alerte, nonce et téléchargement propriétaire ;
- simuler `wp_mail` accepté, erreur, timeout et état inconnu ;
- vérifier qu’aucun contrat n’est envoyé pour sandbox ;
- vérifier que les données sensibles ne sont pas dans les logs.

### Phase G — Brevo

- vérifier liste 3/4/5/6 ;
- tester une synchronisation avec adresse contrôlée ;
- confirmer absence des autres listes ;
- retirer consentement ;
- vérifier suppression après achat ;
- confirmer désabonnement et arrêt ;
- envoyer un seul test autorisé et documenter réception ;
- garder les quatre scénarios inactifs jusqu’à validation.

### Phase H — performance, mobile et accessibilité

- tester 390 px et vrais appareils ;
- clavier, focus, contraste, libellés, messages d’erreur ;
- formulaires longs ;
- pages publiques cacheables vs espace membre non cacheable ;
- TTFB et poids HTML avant/après.

### Phase I — production

- utiliser les clés production déjà validées seulement après audit ;
- vérifier le webhook exact, la signature et la location ;
- effectuer au plus un paiement réel autorisé avec un compte client neuf ;
- confirmer attribution, contrat, activation, email et date d’échéance ;
- tester le remboursement selon autorisation financière ;
- surveiller les files WP-Cron, erreurs Square et emails ;
- documenter le rollback et la rotation des clés.

## 15. Matrice d’acceptation minimale

| Domaine | Pass si… | Non validé actuellement |
|---|---|---|
| Pages publiques | routes 200, contenu cohérent, aucune erreur PHP | revue complète sur vrais appareils |
| Inscription | compte ordinaire + email reçu + première connexion | parcours client réel complet |
| Accès gratuit | ressources et bilans accessibles, paywall actif | tests utilisateurs élargis |
| Square sandbox | commande, taxes, webhook et réconciliation corrects | paiement de production |
| Square production | paiement réel associé au bon membre | non exécuté |
| Contrat | snapshot, contrat, activation et téléchargement corrects | remise après achat réel |
| Remboursement | accès retiré après remboursement total | remboursement réel |
| Brevo | bonne liste, consentement, retrait, arrêt | parcours réel et réception confirmée |
| Marketing | scénarios configurés et inactifs | activation commerciale |
| Performance | mesures comparables avant/après | corrections complètes |
| Social | compte/droit/publication vérifiés dans l’interface | automatisation autonome |

## 16. Prompts prêts à remettre à un autre agent IA

### Audit initial

> Tu reprends un projet WordPress/LWS appelé Neomoov Academy / CAP CHAUFFEUR. Lis d’abord `LIVRE_DE_REPRISE_CAP_CHAUFFEUR.md`, `livraison/DEMARRAGE_ET_ETAT.md`, `cahier_architecture_notes.txt` et `cahier_parcours_notes.txt`. Ne modifie rien. Produis un inventaire des composants, des routes, des états de paiement, des secrets attendus et des écarts entre code, configuration et recette. N’affiche aucun secret.

### Reprise Square

> En staging uniquement, vérifie le module Square API. Reproduis la commande 99 CAD + TPS + TVQ = 113,83 CAD, l’idempotence, la vérification serveur, la signature du webhook, les quatre événements, la séparation sandbox/production, la revue de facturation et le retrait après remboursement. Utilise des clés sandbox et un compte WordPress test. Fournis des résultats observables et les preuves ; n’exécute aucun paiement production sans autorisation séparée.

### Reprise Brevo

> Vérifie la synchronisation WordPress/Brevo sans envoyer de campagne. Teste consentement explicite, première connexion, une seule liste parmi 3/4/5/6, retrait, exclusion après achat et absence de réentrée. Garde les quatre scénarios inactifs. N’affiche ni ne copie la clé API.

### Reprise pédagogique

> Compare `livraison/formation/data.json`, le guide HTML/Markdown et les références éditoriales. Signale les écarts de titres, les affirmations réglementaires ou financières non justifiées et les contenus promis mais absents. Ne transforme pas les scripts vidéo en vidéos disponibles et ne présente pas le compagnon photo comme un diagnostic mécanique.

### Reprise performance

> Mesure le poids HTML, TTFB, DOM, CSS, JavaScript, images et Core Web Vitals des pages publiques et des formulaires avant toute modification. Propose des corrections réversibles et vérifie séparément cache public, sessions membres, nonces et webhook. Documente avant/après.

## 17. Points bloquants ou décisions à prendre

1. Tester ou non un premier paiement de production avec un compte client neuf.
2. Finaliser la procédure de remboursement réel et sa preuve.
3. Décider si le prix 99 CAD reste codé comme édition de lancement ou devient une offre versionnée 99/199.
4. Décider si le nouveau développeur conserve WordPress ou migre vers `site/`.
5. Produire réellement les vidéos avant de les annoncer.
6. Décider si les scénarios Brevo doivent être activés après un test réel documenté.
7. Remesurer et corriger les pages lourdes LWS.
8. Finaliser la méthode de publication sociale : manuelle contrôlée, outil tiers autorisé ou intégration officielle ; Snapchat reste soumis au statut Business.
9. Définir la conservation, l’export et la suppression des données utilisateurs.
10. Vérifier indépendamment les numéros TPS/TVQ avant facture ou page légale définitive.

## 18. Règle de livraison au prochain développeur

Le développeur doit remettre :

- une copie versionnée des sources et du Code Snippet actif ;
- un fichier `.env.example` sans secrets ;
- une table de configuration indiquant où chaque secret est réellement lu ;
- une matrice de tests passés/non passés ;
- une preuve de staging ;
- une procédure de déploiement et rollback ;
- une procédure de rotation des clés ;
- un journal des paiements et webhooks sans données de carte ;
- une liste explicite des fonctionnalités non livrées ;
- un procès-verbal de production séparant test réel, simulation et simple contrôle en lecture.

Aucune livraison n’est considérée complète si elle se contente de dire « connecté » ou « testé » sans distinguer code, configuration, observation d’interface et test de bout en bout.
