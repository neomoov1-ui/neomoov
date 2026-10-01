# CRM HubSpot : mise en place et fonctionnement (étape 25)

Guide pour le fondateur, 1er octobre 2026. Décision du 30 septembre 2026 : **HubSpot, formule gratuite pour commencer** (étude 06 ; Zoho écarté). La plateforme pousse elle-même, sans ressaisie, les prospects, les comptes d'affaires et les organisations clientes dans HubSpot, avec le consentement de la personne, et jamais un trajet, une adresse personnelle ni un paiement. Compte : au nom de GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., avec une adresse `@neomoov.net`. Aucune clé ne transite par un message : tout va dans le fichier `.env` (voir `docs/cles-comptes-externes.md`, section 0).

Durée totale pour toi : environ 45 minutes, en six étapes. Ensuite une seule phrase me suffit : « le jeton HubSpot est dans le .env ».

## État au 1er octobre 2026 : ce qu'il reste à faire (10 minutes)

Le compte et le jeton existent, et `crm:setup` a été lancé une fois contre le vrai compte. Constats (lectures seulement, aucun contact créé) :

| Point | Constat | À faire |
|---|---|---|
| Compte | Numéro 343738989, formule gratuite | Rien |
| Emplacement des données | `na3` (adresse `app-na3.hubspot.com`), que les pages publiques de HubSpot sur ses centres de données désignent comme le centre de **Montréal** | Confirmer dans Paramètres (étape 2) et garder la capture pour l'EFVP |
| Fuseau horaire | Heure de l'Est (identique à Montréal) | Rien |
| Devise du compte | **USD** | Passer en **CAD** (étape 1, point 4) avant la première transaction avec un montant |
| Jeton | Lit et écrit les contacts, lit les propriétés des contacts ; **rien** sur les entreprises ni les transactions, et ne peut pas créer de propriétés | Ajouter les 9 portées ci-dessous |
| `crm:setup` | Rien créé : la création du groupe « Neomoov » est refusée faute de portée | Relancer après l'ajout des portées |

Portées à ajouter à l'application (ou à la clé de service) qui porte le jeton, en plus de celles déjà accordées :

- `crm.schemas.contacts.write`
- `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.schemas.companies.read`, `crm.schemas.companies.write`
- `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.deals.read`, `crm.schemas.deals.write`

Ensuite : si HubSpot affiche un nouveau jeton, le remplacer dans `.env` (même variable) ; puis me dire « portées HubSpot ajoutées » (ou lancer l'étape 5 toi-même). Tant que `crm:setup` ne se termine pas sans « portée manquante », garder `CRM_PROVIDER=mock` (ou vide) : avec le jeton actuel, les contacts partiraient mais les transactions échoueraient et s'accumuleraient en reprise.

---

## 1. Créer le compte gratuit (10 minutes)

1. Depuis Montréal, **sans RPV (VPN)** : HubSpot place le compte selon l'adresse IP à l'inscription. Ouvrir https://www.hubspot.com/fr et choisir « Commencer gratuitement » (CRM gratuit), pas un essai d'une formule payante.
2. S'inscrire avec une adresse `@neomoov.net` (par exemple `contact@neomoov.net`), nom de l'entreprise « Neomoov (Groupe NSK) », site `neomoov.net`, secteur « Transport », 1 à 5 employés.
3. Dans les premiers écrans, répondre « gérer mes contacts et mes ventes » ; refuser l'installation du traceur sur le site (l'extension WordPress de HubSpot n'est jamais installée : elle poserait des témoins sans consentement et aspirerait les formulaires de réservation, ce que l'étude 04 interdit).
4. Réglages du compte (roue dentée en haut à droite, puis « Paramètres par défaut du compte ») : langue **Français**, fuseau horaire **(UTC-05:00) Heure de l'Est, Montréal**, devise **CAD**. Enregistrer.

## 2. Vérifier l'emplacement des données (5 minutes)

1. Paramètres, « Paramètres par défaut du compte », onglet « Général » : la ligne **« Emplacement d'hébergement des données »** (ou « Data hosting location ») indique le centre de données.
2. Ce qu'il faut savoir avec la formule gratuite : le centre de Montréal est garanti pour les comptes payants (migration gratuite depuis les paramètres) ; un compte gratuit est placé selon l'adresse IP d'inscription, et peut se retrouver aux États-Unis. Deux cas :
   - **Canada** : rien à faire. Garder une capture d'écran de cette ligne pour le dossier d'évaluation des facteurs relatifs à la vie privée (EFVP).
   - **États-Unis** : c'est permis par la Loi 25 à condition de l'évaluer et de le dire. Soit on reste gratuit et la politique de confidentialité mentionne HubSpot comme sous-traitant hébergé aux États-Unis (je prépare le texte), soit on passe à Starter (environ 20 $ US par place et par mois, ou 7 $ US avec l'offre de bienvenue si elle est affichée) et on demande la migration vers Montréal dans ce même écran. Ma recommandation : rester gratuit pour la mise en route, décider à 90 jours.
3. Paramètres, « Confidentialité et consentement » : activer les fonctions de confidentialité des données (consentement, suppression sur demande). Paramètres, « IA » : désactiver les fonctions d'IA qui lisent les fiches, tant que l'EFVP n'est pas signée.

## 3. Créer l'application privée et son jeton (10 minutes)

Le jeton d'application privée est la clé avec laquelle la plateforme écrit dans HubSpot. Variable : `HUBSPOT_ACCESS_TOKEN` (décision tranchée le 1er octobre 2026 ; `HUBSPOT_SERVICE_KEY` n'est pas utilisée).

1. Paramètres (roue dentée), menu de gauche **« Intégrations »**, puis **« Applications privées »**, bouton **« Créer une application privée »**.
2. Onglet « Informations de base » : nom **« Plateforme Neomoov »**, description « Synchronisation des prospects, comptes d'affaires et organisations depuis la plateforme Neomoov ».
3. Onglet **« Portées »** (scopes) : cocher exactement ces douze portées, dans la catégorie CRM, et rien d'autre :

   | Objet | Lecture | Écriture |
   |---|---|---|
   | Contacts | `crm.objects.contacts.read` | `crm.objects.contacts.write` |
   | Entreprises | `crm.objects.companies.read` | `crm.objects.companies.write` |
   | Transactions | `crm.objects.deals.read` | `crm.objects.deals.write` |
   | Propriétés des contacts | `crm.schemas.contacts.read` | `crm.schemas.contacts.write` |
   | Propriétés des entreprises | `crm.schemas.companies.read` | `crm.schemas.companies.write` |
   | Propriétés des transactions | `crm.schemas.deals.read` | `crm.schemas.deals.write` |

   Les portées « objects » servent aux fiches et aux notes ; les portées « schemas » servent au script de mise en place (propriétés personnalisées). Si HubSpot propose une portée distincte pour les notes (« engagements » ou `crm.objects.notes`), la cocher aussi. Aucune portée marketing, formulaires, fichiers ni paramètres.
4. Bouton « Créer l'application », puis « Continuer la création ». HubSpot affiche le jeton **une seule fois** (il commence par `pat-na1-`) : bouton « Afficher le jeton », puis « Copier ». Ne pas le coller ailleurs que dans le fichier `.env` (étape 4) ; pas dans Bitwarden en clair non plus, il peut toujours être régénéré depuis cette page (« Faire pivoter »).
5. Noter aussi le **numéro de compte** (Hub ID) : il est affiché dans le menu du compte en haut à droite (« ID du compte »), ou dans l'adresse de la page (`app.hubspot.com/contacts/12345678/...`). Il n'est pas secret.

Si le menu « Applications privées » n'existe pas (HubSpot remplace progressivement les applications privées par les « Clés de service » et les applications de projet) : Paramètres, « Intégrations », **« Clés de service »**, « Créer une clé », mêmes portées, même usage. La clé obtenue va dans la même variable `HUBSPOT_ACCESS_TOKEN`. Le jeton actuel (1er octobre 2026) n'est pas reconnu par l'API d'information des applications privées : il vient probablement d'une clé de service ; c'est sans effet pour la plateforme, qui l'utilise de la même façon.

## 4. Déposer le jeton dans le fichier `.env` (5 minutes)

1. Ouvrir `C:\Users\PC\code\neomoov\.env` (VS Code : `code C:\Users\PC\code\neomoov\.env`). Les trois lignes existent déjà dans `.env.example` ; les ajouter si elles manquent, sans guillemets ni espace :

   ```
   CRM_PROVIDER=real
   HUBSPOT_ACCESS_TOKEN=pat-na1-...
   HUBSPOT_PORTAL_ID=12345678
   ```

2. Enregistrer, puis vérifier sans rien afficher : dans PowerShell, `cd C:\Users\PC\code\neomoov` puis `pnpm env:check`. Les trois lignes doivent être marquées `OK`.
3. Sur le serveur de production, les mêmes variables vont dans l'environnement de l'API et du worker (voir `docs/runbooks/`). Tant que le jeton n'y est pas, `CRM_PROVIDER` reste `mock` et `ALLOW_MOCK_PROVIDERS` contient `crm` : rien ne quitte la plateforme (la passe de reprise rattrape les prospects et les comptes d'affaires des 48 dernières heures dès que le CRM réel est branché ; au-delà, rien n'est poussé automatiquement).

## 5. Lancer la mise en place du modèle de données (5 minutes)

Le script crée dans HubSpot le groupe de propriétés « Neomoov », les propriétés personnalisées des contacts, des entreprises et des transactions (étude 06, étape 5), et les deux pipelines de transactions avec leurs étapes. Il est **rejouable** : ce qui existe est laissé ou complété, jamais détruit ; les options ajoutées à la main dans HubSpot sont conservées.

1. D'abord en simulation (rien n'est écrit) : `pnpm --filter @neomoov/api crm:setup -- --dry-run`. Chaque ligne annonce `[à faire]` ou `[déjà en place]`.
2. Puis pour de vrai : `pnpm --filter @neomoov/api crm:setup`. Résultat attendu la première fois : 3 groupes créés, 25 propriétés créées, puis les pipelines.
3. Le script n'affiche jamais le jeton. Une portée manquante n'arrête pas tout : la section concernée (propriétés des contacts, des entreprises, des transactions, ou pipelines) est marquée `[ignoré] section … (portée manquante : …)` avec le nom exact de la portée à cocher, les autres sections avancent, et le script se termine avec le code 3 et la liste des portées à ajouter. S'il répond « Jeton refusé » (401), revoir le collage dans `.env`.
4. Avec le fichier `.env` du dépôt principal, depuis une autre copie : `node C:/Users/PC/code/neomoov-outils/with-env.cjs <copie>/apps/api pnpm crm:setup --dry-run` (même chose sans `--dry-run` pour appliquer).

**Un seul pipeline en formule gratuite.** HubSpot gratuit ne permet qu'un pipeline de transactions (deux en Starter, quinze en Professional). Le script s'en aperçoit (HubSpot refuse la création), renomme le pipeline existant **« Neomoov »** et y range les étapes des deux parcours à la suite : « Nouveau prospect », « Contact établi », « Proposition envoyée », « Essai en cours », « Client actif », « Perdu » (ventes B2B), puis « Candidature reçue », « Préinscrit à la formation », « Formation payée », « Formation en cours », « Certifié », « Abandon » (Formation chauffeurs). La propriété de transaction **« Parcours Neomoov »** (`b2b` ou `training`) permet de filtrer deux vues. Après un passage à Starter, relancer `crm:setup` : il crée alors les deux pipelines « Ventes B2B » et « Formation chauffeurs », et les nouvelles transactions y vont (les anciennes restent dans « Neomoov », à déplacer à la main si on y tient).

## 6. Vérifier (5 minutes)

1. Paramètres, « Propriétés », filtrer par groupe **« Neomoov »** : « Identifiant Neomoov », « Entité NSK », « Source Neomoov », « Consentement (date) », « Consentement (origine) », et pour les contacts « Type de prospect », « Statut de candidature chauffeur », « Statut Formation chauffeurs », « Programme d'affiliation », « Langue Neomoov ».
2. Objets, « Transactions », « Pipelines » : le pipeline « Neomoov » (ou les deux pipelines en Starter) avec les étapes ci-dessus.
3. Essai de bout en bout : remplir le formulaire de préinscription chauffeur sur neomoov.net avec un vrai numéro à toi et la case de consentement cochée. En moins d'une minute, le contact apparaît dans HubSpot (type de prospect « Candidat chauffeur », consentement daté) avec une transaction « Candidature chauffeur : Prénom Nom » à l'étape « Candidature reçue », et le message du formulaire en note. Supprimer ensuite ce contact d'essai dans HubSpot.
4. Dans My Hub, « Prospects » : la même personne, avec son statut. La correspondance (identifiants HubSpot, état, dernière erreur) est dans la table `crm_records` de la base ; je peux la consulter sur demande.

---

## Ce que la plateforme envoie, et quand

| Événement dans la plateforme | Dans HubSpot | Parcours et étape |
|---|---|---|
| Prospect du site (candidature chauffeur, demande d'entreprise ou de partenaire, préinscription Formation) **avec consentement** | Contact (prénom, nom, courriel, téléphone, ville, langue, type de prospect, consentement daté) + transaction + note avec le message libre | Candidat chauffeur : « Formation chauffeurs / Candidature reçue » ; préinscription : « Préinscrit à la formation » ; entreprise ou partenaire : « Ventes B2B / Nouveau prospect » |
| Compte d'affaires créé (client entreprise sous contrat) | Entreprise (nom, raison sociale) + contact de facturation (courriel seulement) + transaction | « Ventes B2B / Client actif » |
| Organisation cliente créée (marque blanche, flotte, compagnie, Solo) | Entreprise (nom, raison sociale, type, formule) + transaction | « Essai en cours » en période d'essai, « Contact établi » sans formule, « Client actif » une fois abonnée |
| Organisation abonnée (étape 25, facturation) | Mise à jour de l'entreprise (formule) et de la transaction | « Ventes B2B / Client actif » |

La synchronisation est asynchrone (file `crm`, portée par le worker en production) : la plateforme répond au formulaire tout de suite, HubSpot est mis à jour quelques secondes plus tard. Une panne de HubSpot ne bloque rien : la tâche est relancée (cinq tentatives espacées), puis une passe toutes les dix minutes reprend les fiches en erreur (jusqu'à dix échecs, ensuite une personne regarde le journal) et rattrape les prospects et les comptes d'affaires des 48 dernières heures qui n'auraient jamais été présentés (aucune route ne crée encore de compte d'affaires : ceux saisis en base passent par ce rattrapage).

Une fiche est identifiée chez HubSpot par la propriété unique « Identifiant Neomoov » : rejouer une synchronisation met la fiche à jour sans la dupliquer. Si un contact porte déjà le même courriel (créé par Tidio ou à la main), il est mis à jour plutôt que recréé.

## Consentement et minimisation

- **Rien ne part sans consentement.** Pour un prospect, c'est la case cochée sur le formulaire (date gardée) ; un prospect sans date de consentement (import, relais sans case) ou écarté dans My Hub n'est jamais envoyé. Pour un compte d'affaires ou une organisation, le fondement est le contrat (la fiche porte « Consentement (origine) : Contrat » et la date d'ouverture). Les adaptateurs eux-mêmes refusent tout envoi sans l'indicateur de consentement.
- **Jamais de trajet, d'adresse personnelle ni de paiement.** Les données qui partent sont limitées par construction (l'interface n'a pas ces champs) et une garde refuse toute propriété dont le nom évoque une adresse, un trajet, une position, une carte ou un paiement. La ville est transmise (utile pour le recrutement), jamais une adresse.
- Les passagers et leurs courses ne vont jamais dans le CRM. Ne pas brancher l'application « Stripe Data Sync » de HubSpot sur le compte Stripe de Neomoov : elle y copierait les clients et les paiements.
- Les contacts qui ne reçoivent pas de courriels marketing (candidats, partenaires, comptes d'affaires suivis à la main) sont à marquer « non marketing » dans HubSpot : ils ne comptent pas dans la limite des contacts marketing.

## Limites de la formule gratuite (et quand passer à Starter)

| Sujet | Gratuit | Starter |
|---|---|---|
| Pipelines de transactions | 1 (les deux parcours dans « Neomoov ») | 2 (« Ventes B2B » et « Formation chauffeurs ») |
| Appels d'API | 100 par 10 secondes, 250 000 par jour (la plateforme se lisse à 90 par 10 secondes et réessaie sur refus) | Identique |
| Contacts | 1 000 000 stockés ; courriels marketing limités à 2 000 envois par mois | 1 000 contacts marketing inclus, puis par tranche |
| Automatisations | Aucune séquence ni workflow (la plateforme fait ses relances elle-même) | Automatisation simple par formulaire |
| Hébergement | Selon l'inscription (vérifier, étape 2) | Montréal, migration gratuite |
| Applications privées, clés de service | Oui | Oui |

Passer à Starter quand : plus de 1 000 contacts marketing, besoin de relances conditionnelles faites par le CRM, hébergement à Montréal exigé par un client, ou équipe commerciale de trois personnes et plus. Idéalement par HubSpot for Startups après la levée (jusqu'à 90 % de remise la première année).

## Exploitation

- Variables : `CRM_PROVIDER` (`mock` ou `real`), `HUBSPOT_ACCESS_TOKEN` (secret), `HUBSPOT_PORTAL_ID` (facultatif). En production, un fournisseur simulé doit être déclaré dans `ALLOW_MOCK_PROVIDERS` (`crm`), sinon l'API refuse de démarrer.
- File `crm` : visible dans My Hub (files de tâches) ; les tâches en échec se relancent depuis là. Table `crm_records` : une ligne par objet HubSpot (contact, entreprise, transaction, note) avec l'identifiant externe, l'état (`synced`, `error`, `skipped`), le nombre d'échecs et la dernière erreur. Journal d'audit : une entrée `crm.synced` par synchronisation.
- Rotation du jeton : page de l'application privée, « Faire pivoter » ; remplacer la valeur dans `.env` et dans l'environnement du serveur, redémarrer l'API et le worker.
- Code : interface `CrmProvider` (`apps/api/src/adapters/types.ts`), simulateur `adapters/mock/crm.mock.ts`, adaptateur `adapters/real/hubspot.real.ts`, modèle `adapters/real/hubspot-model.ts`, synchronisation `modules/crm/`, script `scripts/crm-setup.ts`. Tests : `test/crm-adapters.test.ts` (sans réseau, faux HubSpot) et `test/crm.e2e.test.ts` (fournisseur simulé).

## Accès à fournir (récapitulatif)

1. Compte HubSpot gratuit créé depuis Montréal avec une adresse `@neomoov.net` (étape 1), emplacement des données vérifié (étape 2).
2. Jeton de l'application privée « Plateforme Neomoov » avec les douze portées (étape 3), déposé dans `.env` sous `HUBSPOT_ACCESS_TOKEN`, avec `HUBSPOT_PORTAL_ID` et `CRM_PROVIDER=real` (étape 4).
3. Plus tard, seulement si l'on veut que HubSpot prévienne la plateforme en temps réel (changement d'étape fait à la main dans HubSpot) : une application de projet avec webhooks, hors périmètre pour l'instant.
