# Publication multiréseau de My Hub (agent S2, 3 octobre 2026)

Branche `publication-multireseau` (copie `C:\Users\PC\code\neomoov-wt25`), créée depuis `origin/main`, fusionnée deux fois avec `origin/main` en cours de route (connecteurs de Q4, puis espace Réseaux sociaux de S1), poussée sur `origin`. Mission : `neomoov-outils/agents/S2-publication-multireseau.md`, avec les consignes du coordinateur (aucun agrégateur, relais manuel très simple et vue « À relayer », refus `SOCIAL_MANUAL_RELAY` et `SOCIAL_APPROVAL_PENDING` présentés comme des tâches, mention des vidéos privées). Fonctionnement détaillé : `docs/marketing/publication-multireseau.md`.

## Ce qui est fait

1. **Format du lot** (poussé en premier, `c95fea2`, 30 minutes après le départ) : `docs/marketing/lancement-50-publications.schema.json` et un exemple. Miroir exécutable `publicationsImportSchema` (zod) ; un essai vérifie que le schéma JSON et le schéma exécutable ont les mêmes champs. Le lot réel de S3 (`lancement-50-publications.json`, 50 publications, 257 Ko) est valide.
2. **Espaces** : `telegram` et `whatsapp_channel` ajoutés à `CONTENT_SPACES`, `SPACE_RULES`, `DEFAULT_SLOTS`, à la contrainte de la base (migration `0038`) et aux libellés de My Hub ; `telegram` au réseau de la boîte unifiée (même ajout que Q4, sans doublon après fusion).
3. **Tailles exactes** : table unique `VISUAL_SIZES` du domaine (tailles du fondateur, plus miniature YouTube et vidéo longue), `visualDimensions` de l'API la lit ; essai par réseau et par format.
4. **Une image différente par réseau** : `planVariants` (6 gabarits, 4 accents de la marque, 3 positions du titre, recadrage et agrandissement, photo réelle classée par mots puis différente par réseau, texte de l'image et mention du réseau) ; gabarits HTML à la taille exacte (`visual-templates.ts`), rendus en PNG par `VisualsService.prepareVariant`, empreinte SHA-256 gardée ; vidéo courte par la chaîne existante avec la variante en couverture ; miniature YouTube.
5. **Composer** (My Hub, menu Pilotage, « Publier (réseaux) », `/hub/marketing/publier`) : texte de base, version courte, texte de l'image, mots-clics, appel à l'action, photos ; un, plusieurs ou tous les réseaux ; texte par réseau adapté automatiquement et modifiable, contrôle en direct des longueurs et des règles, rédaction par l'agent de contenu à la demande ; diffusion en brouillons (aperçu des images d'abord), maintenant, à une heure, ou aux prochains créneaux ; état par réseau (brouillon, bloqué, programmé, publié avec lien, en échec avec raison, à relayer, mention du réseau).
6. **Import en lot et « Approuver et programmer »** : import par tranches de 90 Ko depuis My Hub (rejouable, clé campagne et référence), brouillons groupés, règles appliquées, visuels mis en production ; programmation sur N jours selon `marketing.slots` (jours du lot gardés ou ramenés proportionnellement), contenus bloqués ou sensibles laissés à l'approbation un par un.
7. **Relais manuel** : vue « À relayer » du jour (retards compris) : visuel, texte à copier, fichier à la bonne taille, miniature YouTube, lien direct vers le réseau (X : fenêtre de publication préremplie), « Marquer comme publié » avec lien facultatif. Reconnaît aussi les refus des connecteurs de Q4 (`failed` avec `SOCIAL_MANUAL_RELAY` ou `SOCIAL_APPROVAL_PENDING`), jamais comptés comme échecs. Un réseau sans connecteur utilisable au moment de la diffusion passe en relais manuel au lieu d'échouer. Récapitulatif quotidien au personnel (`marketing.relay_digest_hour`, 8 h).
8. **Commentaires et messages** : compteurs par réseau (non lus, remis à l'humain, réponses à relayer), fil par réseau, réponse de l'équipe, envoi d'une réponse en attente par le connecteur du réseau quand il existe, sinon copie puis « Marquer relayée ».
9. **Mention du connecteur** (vidéo YouTube ou TikTok privée) gardée sur le contenu (`publish_notice`) et affichée.

API (`/v1/admin/marketing`) : `GET|POST publications`, `GET publications/:id`, `POST publications/:id/publish`, `POST publications/import`, `POST publications/schedule`, `POST publications/adapt`, `GET relay`, `POST content/:id/relayed`, `GET content/:id/download`, `GET social/summary`, `POST social/messages/:id/send`. Migration `0038_publication-multireseau` (table `content_groups` réservée à la plateforme, colonnes `group_id`, `delivery`, `visual`, `relayed_at`, `relayed_by_user_id`, `publish_notice`, espaces Telegram et chaîne WhatsApp), rejouable, retour arrière dans `down/`, journal après `0037_social-accounts` (`when` plus grand), instantané chaîné sur celui de S1. OpenAPI régénérée (427 chemins), client d'API reconstruit.

## Essais

- Domaine : `publications.test.ts` (tailles, variantes toutes différentes, adaptation des textes, relais manuel reconnu, format du lot, répartition de 50 publications sur 10 jours) ; suite complète du domaine **609 essais verts**.
- Sous verrou de la base (`db-lock.cjs`, nom `s2-e2e`) : `publication-multireseau.e2e` **6/6 vert** (composer vers Facebook, X et la chaîne WhatsApp, images différentes aux bonnes tailles, publication par les connecteurs simulés, publication directe d'un contenu manuel refusée, récapitulatif ; vue « À relayer », téléchargement, marqué publié ; refus `SOCIAL_APPROVAL_PENDING` présenté en tâche et mention gardée ; dix réseaux, dix empreintes différentes, miniature YouTube, diffusion après aperçu ; import de 3 publications rejouable avec un contenu bloqué et un sensible, programmation en lot sur trois jours ; **lot réel des 50 publications importé par tranches, 559 contenus, programmés sur 10 jours** ; droits et compteurs par réseau). `autonome-e-marketing.e2e` 7/7 (passé à treize espaces), `marketing-adapters` vert, `isolation-coverage` vert après fusion de S1.
- Types sans erreur : API, web, worker, application chauffeur, application client.
- Migration appliquée à la base de développement par ses instructions SQL (rejouables), sans l'inscrire au journal des migrations : `pnpm db:migrate` la rejouera sans effet.

## Limites et points à savoir

- Dans les essais, aucun navigateur n'est configuré : les visuels sont des gabarits HTML (état `html`) ; l'empreinte porte alors sur le HTML. Le rendu PNG réel se vérifie sur le serveur (`BROWSER_BIN` de l'image Docker). Instagram, TikTok, Snapchat et YouTube exigent un visuel rendu pour les connecteurs réels.
- Le contrôle en direct du composer utilise les adresses d'appel à l'action et les prix des lignes éditoriales v1.1 (indicatif) ; l'API revérifie avec les réglages.
- Liens directs du relais manuel (Snapchat `my.snapchat.com`, TikTok Studio, Business Suite de Meta) tirés de la documentation publique : à confirmer au premier usage.
- Le récapitulatif quotidien est dédoublonné en mémoire : un redémarrage après l'heure réglée peut en renvoyer un.
- Mode `slots` du composer et programmation en lot : un réseau sans créneau le jour choisi prend l'heure de son premier créneau ; plusieurs publications d'un même réseau le même jour sont espacées de 30 minutes.

## Décisions demandées au fondateur

- Lot du lancement : 3 contenus bloqués (P01 et P39 sur le blogue, P12 sur Facebook) parce qu'ils citent le numéro +1 438 805-7974, absent des numéros publics admis (`marketing.allowed_phones`). L'ajouter au réglage s'il est public, ou retirer le numéro du texte.
- Rythme : le lot prévoit 28 jours ; « Approuver et programmer » sur moins de jours les resserre proportionnellement. Choisir le nombre de jours (le fondateur parlait de tout publier aujourd'hui : possible avec 1 jour, mais chaque réseau recevrait alors une publication toutes les 30 minutes).
- Snapchat et chaîne WhatsApp : relais manuel quotidien attendu (73 tâches pour le lot réel sur 10 jours).

## Refus

Aucune action refusée par le système de permissions. Aucun `.env` lu (base de développement atteinte seulement par `with-env.cjs` et `db-query.cjs` de neomoov-outils), aucun déploiement, aucune base de production, aucun compte externe réel.
