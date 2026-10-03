# Revue du 3 octobre 2026, agent Q3 : lot D (Academy WordPress et Loi 25)

Branche `revue-q3-academy` depuis `origin/main` (`ec9ba36`). Mission : `neomoov-outils/agents/Q3-academy-lot-d.md` et règles communes `COMMUN-2026-10-03.md`. Sources : rapport `revue-2026-10-02/05-academy-et-loi-25.md` et section « Lot D » de `00-synthese.md`. Périmètre : le PHP de l'Academy (`academy/livraison/wordpress/*.php`), aucune table ni route de la plateforme. **Rien n'est déployé** : la session principale déploie après relecture. Tâche ajoutée en cours de route par la session principale (décision du fondateur du 3 octobre) : retrait du numéro +1 367 763-9063.

## Ce qui est fait

| Demande | Résultat |
|---|---|
| 1. Double consentement (inscription gratuite et infolettre) | Fait. Nouveau module `confidentialite.php` (préfixe `nmp_`), ajouté à `build-export.cjs`. L'inscription n'envoie plus qu'un courriel de confirmation : lien signé (HMAC avec le sel `auth` de WordPress), valable 48 heures, à usage unique (la demande est effacée par la requête qui confirme). Le lien ouvre une page qui demande un clic : un logiciel de messagerie qui ouvre les liens ne confirme rien. Compte WordPress, courriel de mot de passe, package gratuit, contact Brevo (`nmb_email_confirmed`, file `nma_brevo_queue`) et séquence J0 à J7 (`nms_schedule`) naissent seulement à ce clic. Même mécanisme depuis l'espace membre (« Recevoir les conseils et offres ») ; un réabonnement ne renvoie pas la séquence ; un changement d'adresse se revalide par ce même lien. |
| Consentement daté et version du texte | Fait. `nmp_consent_log` (20 dernières traces) : version et empreinte SHA-256 du texte, dates de demande et de confirmation, source (inscription ou espace), empreinte salée de l'adresse IP à la demande et à la confirmation, navigateur tronqué à 160 caractères ; retrait journalisé aussi. `nma_consent_version` et `nma_consent_date` tenus à jour, `nmp_optin` sur le compte (dates, version de la page « Vos données »). |
| Inscriptions existantes non touchées | Oui : aucune migration ; les comptes antérieurs gardent leur état, leur séquence en cours et la confirmation par première connexion (`wp_login` de `brevo-sync.php`, conservé). |
| 2. Secrets WordPress hors de la base | Fait. `nma_secret()` lit la constante de `wp-config.php`, puis le réglage `nma_settings` en repli. Inventaire : token Square, clé de signature du webhook Square, clé Brevo, clé Anthropic (constantes déjà lues, désormais centralisées), clé secrète et secret du webhook Stripe (nouvelles constantes ; mode inactif). Écran : « Fourni par wp-config.php (NMA_…), jamais affiché », champ de saisie masqué quand la constante existe, avertissement en tête tant qu'une copie reste dans la base, case « Effacer la valeur enregistrée dans la base » pour chacune. Aucune valeur n'est jamais affichée. |
| 3. Constats restants Élevé ou Moyen sans décision | Voir le tableau suivant. |
| Numéro public | Fait. +1 367 763-9063 remplacé par +1 438 900 4990 (et `https://wa.me/14389004990`) dans `contract-delivery.php` (coordonnées du vendeur : contrat, reçu), `CONDITIONS_CAP_CHAUFFEUR_PUBLICATION.md`, `CONTRAT-LIVRAISON-RECETTE.md`, `LIVRE_DE_REPRISE_CAP_CHAUFFEUR.md`, `CONDITIONS_CAP_CHAUFFEUR_NOTES_INTERNES.md`. Recherche `367[^0-9]{0,3}763[^0-9]{0,3}9063|13677639063` sur `academy/` (texte et binaires) : aucun résultat hors de l'export reconstruit. `academy/livraison/formation/*` ne le contenait pas. La page publique « conditions-cap-chauffeur » du site n'est pas touchée (autre agent). |
| 4. Ne rien déployer | Respecté : aucun appel au site, au serveur LWS ni à un compte externe. |

## Constats du rapport 05 (Élevé et Moyen)

| Constat | Traitement |
|---|---|
| 1 Élevé, export Loi 25 d'un chauffeur | Déjà corrigé le 2 octobre (lot A, plateforme). |
| 2 Élevé, EFVP et communications hors Québec | Partie Academy et documentation : page « Vos données » avec fournisseurs, rôle, renseignements et lieu ; lignes LWS (France), Brevo, Square, HubSpot, Anthropic ajoutées à `docs/privacy/efvp.md` avec l'évaluation « À compléter ». L'évaluation, la signature et la décision D48 restent au fondateur. |
| 3 Élevé, `.env` sous OneDrive et mot de passe d'application | Non traitable par le code (et `.env` jamais lu) : à faire avec le fondateur (révoquer, recréer sur un compte dédié avec second facteur, sortir le `.env` de OneDrive). |
| 4 Moyen, secrets en clair dans `wp_options` | Fait (demande 2). |
| 5 Moyen, verrous sans expiration, relances sans plafond | Verrous avec expiration faits le 2 octobre. Ajouté : relances des notifications Square plafonnées à 36 essais (délai de 5 minutes de plus à chaque essai, une heure au plus, environ 30 heures), puis abandon, alerte unique à contact@neomoov.net, liste dans l'administration ; une nouvelle notification signée redonne un plein crédit. Pas de bouton « libérer le verrou » : l'expiration de 10 minutes suffit. |
| 6 Moyen, durcissement de la connexion WordPress | Décision attendue (question 9 du rapport : second facteur, limitation, XML-RPC). Non codé : l'extrait est global au site et pourrait gêner d'autres outils. |
| 7 Moyen, consentement géolocalisation des chauffeurs | Hors Academy (application chauffeur de la plateforme) : l'Academy ne lit aucune position (alertes à zones fixes). |
| 8 Moyen, consultations du personnel | Partie Academy faite (constat 19) : `nmp_staff_log` journalise la consultation d'un dossier de membre (journal Square manuel, dossier Square API, dossier Brevo, téléchargement d'un document d'un autre membre, synthèse des sondages, réinitialisation d'examen, séquence planifiée), une entrée par administrateur, action et membre toutes les 10 minutes au plus, 5 000 entrées au plus, 12 mois ; affichage des 50 dernières. Plateforme (`@AuditRead`) : hors périmètre. |
| 9 Moyen, suppression de compte complète | Partie Academy faite : effaceur WordPress (données Academy, messages de la communauté et marques laissées chez les autres, retrait des listes Brevo avant effacement, arrêt de la séquence, événements WP-Cron) ; à la suppression d'un compte (`delete_user`), pièces d'achat archivées (`nmp_archive_<id>`) jusqu'à 7 ans après l'achat, reste nettoyé (verrous, événements, messages). Plateforme (conversations, prospects, HubSpot, véhicules) : hors périmètre. |
| 10 Moyen, durées de conservation | Partie Academy faite avec le 13 : purge quotidienne `nmp_retention_daily` (voir « Choix »). Plateforme : hors périmètre. |
| 11 Moyen, purges suspendues à la sauvegarde | Plateforme, hors périmètre. |
| 12 Moyen, responsable non désigné | Champs nom, fonction et courriel dans les réglages ; affiché sur la page publique seulement s'ils sont remplis ; sinon repère dans l'administration et seulement contact@neomoov.net en public. Aucun nom inventé. |
| 13 Moyen, conservation, export et suppression Academy | Fait : exportateur WordPress (groupes compte, formation, Neomoov Booster, communauté, achat ; sans la requête technique Square ni la copie HTML des documents), effaceur, boutons « Demander une copie de mes données » et « Demander la suppression de mon compte » (demandes WordPress standard confirmées par courriel, 30 jours), purge. |
| 14 Moyen, inscription derrière le cache LWS et courriels à n'importe quelle adresse | Fait : double consentement, plafond global (60 courriels de confirmation par heure) et par adresse (3 par jour), adresse IP réelle lue seulement derrière un mandataire déclaré (`NMA_TRUSTED_PROXIES`), même réponse qu'un compte existe ou non. Turnstile non ajouté (clé et décision attendues). |
| 15 Faible, consentement non vérifié et sans version | Fait (demande 1). |
| Points mineurs | `nma_square_checkout_notice` en `update_user_meta` (plus de croissance sans borne) ; en-tête `stripe-signature` absent sans avertissement PHP 8. |

## Choix

- **Aucun compte avant confirmation** (plutôt qu'un compte « en attente ») : rien n'est créé ni gardé pour une adresse que son titulaire n'a pas confirmée ; la demande vit dans une option non chargée d'office (`nmp_optin_<empreinte>`), indexée (`nmp_optin_index`) pour la purge. La base ne garde qu'une empreinte de l'identifiant : le lien ne peut pas être reconstitué à partir d'elle.
- **Confirmation par bouton** (GET qui vérifie sans consommer, POST qui confirme) : les filtres de messagerie (liens ouverts automatiquement) ne valent pas consentement.
- **Demandes de droits WordPress standard** (`wp_create_user_request`, Outils, données personnelles) plutôt qu'un effacement immédiat : confirmation par le titulaire, trace et décision humaine, délai légal de 30 jours.
- **Durées** (valeurs proposées par la revue, à confirmer) : demandes non confirmées 48 heures ; comptes gratuits Academy (abonnés avec un parcours, sans achat) inactifs 24 mois, dernière activité suivie par `nma_last_seen` (connexion ou passage sur une page Academy, au plus une écriture par jour), à défaut date d'inscription ; pièces d'achat 7 ans après l'achat, même après suppression du compte ; suivi des séquences 12 mois ; journal du personnel 12 mois ; autres données du compte tant qu'il existe. Rien ne peut être supprimé avant l'automne 2028 pour les comptes, 2033 pour les achats. Les comptes WordPress qui ne viennent pas de l'Academy (sans `nma_track`) ne sont jamais touchés.
- **Fournisseurs listés** : ceux de la consigne (Supabase au Canada, LWS en France, Square, Brevo, Anthropic, Meta, HubSpot, Twilio, Vapi, Resend), distingués « Academy » et « plateforme ». Lieux indiqués : Canada, France, Union européenne, États-Unis, sans plus de précision que l'établissement connu de chaque fournisseur.

## Bloc à coller dans `wp-config.php`

Avant la ligne `/* That's all, stop editing! */`, valeurs fictives à remplacer par les vraies (prises dans Square, Brevo et la console Anthropic ; jamais dans un dépôt, un courriel ou une conversation) :

```php
/* Neomoov Academy : secrets hors de la base de données. */
define('NMA_SQUARE_ACCESS_TOKEN', '…');
define('NMA_SQUARE_LOCATION_ID', '…');
define('NMA_SQUARE_ENVIRONMENT', 'production'); // 'sandbox' pour une recette
define('NMA_SQUARE_WEBHOOK_SIGNATURE_KEY', '…');
define('NMA_BREVO_API_KEY', '…');
define('NMA_ANTHROPIC_API_KEY', '…');
/* Mode Stripe (inactif) : seulement s'il est réactivé. */
// define('NMA_STRIPE_SECRET_KEY', '…');
// define('NMA_STRIPE_WEBHOOK_SECRET', '…');
/* Facultatif : adresse(s) du mandataire de LWS dont l'en-tête X-Forwarded-For est cru (séparées par des virgules). */
// define('NMA_TRUSTED_PROXIES', '…');
```

Puis, dans Outils, Neomoov Academy : vérifier « Fourni par wp-config.php » pour chaque secret, cocher « Effacer la valeur enregistrée dans la base » à côté de chacun, enregistrer, lancer « Contrôler la connexion Square » et « Contrôler la connexion Brevo ». Rotation recommandée (nouveau token Square, nouvelle clé Brevo, nouvelle clé Anthropic si elle a été saisie dans l'écran) puisque les anciennes ont séjourné en clair dans la base. Même texte dans `academy/docs/EXPLOITATION.md`.

## Essais

Banc hors WordPress copié de la session principale dans `neomoov-outils/academy/banc-q3/` (original intact), export construit copié en `nma.php`, `examen.json` copié ; PHP 8.3 par Docker Desktop en local (`php:8.3-cli`). Pour reproduire l'export de production, `media.json` (hors dépôt) a été copié depuis `C:\Users\PC\code\neomoov\academy\livraison\formation\`.

- Avant modification : `=== 0 échec(s)` (scénario d'origine, 389 lignes).
- Banc complété (`banc.php`) : `get_users` avec `meta_query` imbriquée et `date_query`, `get_posts` par auteur, `wp_delete_user` avec le crochet `delete_user`, demandes de droits WordPress, corps des courriels gardé (extraction du lien), mode `do=fn` (appel direct d'une fonction, avec `query`, `body` et constantes `defines` simulées par des valeurs fictives).
- Scénario (`scenario.sh`) : la section « Séquences automatiques » passe désormais par la confirmation ; nouvelles sections « double consentement », « offres et demandes de droits depuis l'espace membre », « page Vos données », « relances Square plafonnées », « secrets dans wp-config.php et administration » (provenance, effacement des copies, journal du personnel et déduplication, responsable), « exportateur, effaceur, suppression de compte et conservation » (comptes inactifs, compte actif et compte hors Academy gardés, pièces d'achat échues, archives, séquences, journal), « numéro de téléphone public » (nouveau numéro sur le reçu et dans les coordonnées du vendeur, ancien numéro absent de toutes les pages et sorties rendues).
- Résultat final : RESULTAT_BANC

## Reste à faire et décisions du fondateur

1. **Durées de conservation** : confirmer 24 mois (comptes gratuits inactifs), 7 ans (pièces d'achat), 12 mois (séquences, journal du personnel) ; un avis par courriel avant la suppression d'un compte inactif peut être ajouté.
2. **Responsable de la protection des renseignements personnels** : nom, fonction et courriel dédié à saisir dans les réglages (la page publique l'affichera alors), et sur le site.
3. **Fournisseurs et lieux** : confirmer la liste et les lieux par les accords de traitement (Brevo, Square, HubSpot, Twilio, Vapi, Resend, Meta, Anthropic, LWS) ; l'EFVP mentionne aussi Stripe, Expo et Google Maps, absents de la liste de la consigne ; décision D48 (hébergement) et signature de l'EFVP.
4. **Politique du site** (`/politique-de-confidentialite/`, contenu WordPress hors dépôt) : l'aligner sur la page « Vos données » de l'Academy (fournisseurs, lieux, témoins, durées, responsable) ; non modifiée ici.
5. **Connexion WordPress** (constat 6) : second facteur pour les administrateurs, limitation des tentatives, XML-RPC, revue des comptes.
6. **Mot de passe d'application et `.env` sous OneDrive** (constat 3) : rotation à faire ensemble.
7. **Turnstile** sur l'inscription : clé et décision attendues.
8. **Messagerie du site** : la confirmation conditionne désormais toute inscription ; tester le « test email » de l'administration avant le déploiement (SPF, DKIM). Un échec de transport est compté et signalé dans l'administration.
9. **Documents déjà émis** : les contrats et reçus figés avant le 3 octobre gardent l'ancien numéro (copies conservées, non modifiables) ; les nouveaux portent +1 438 900 4990.

## Déploiement (session principale)

`node livraison/wordpress/build-export.cjs` depuis `academy/` (avec `media.json`), relecture, déploiement de l'extrait comme d'habitude, vidage du cache LWS, puis bloc `wp-config.php` et effacement des copies. L'export `neomoov-academy-ready.php` reste exclu du dépôt par `academy/.gitignore` (comme les livraisons précédentes) : il n'est pas commité.

## Refus du système de permissions

Aucun.

## Pièges

- Docker Desktop sous 6 Go partagés : le moteur peut cesser de démarrer des conteneurs (`docker info` bloqué, 300 Mo libres) ; attendre, arrêter les clients `docker` restés en attente, relancer une seule exécution du banc à la fois.
- Le banc lance un PHP par page : compter 10 à 15 minutes pour le scénario complet sur ce poste.
- Les commandes `node -e` passées dans Bash perdent des barres obliques inverses (`\\n` devient un vrai saut de ligne) : écrire les scripts dans un fichier, ou utiliser l'outil d'édition.
- `git add` d'un motif qui inclut `neomoov-academy-ready.php` (ignoré) échoue entièrement : nommer les fichiers.
