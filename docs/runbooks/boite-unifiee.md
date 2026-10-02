# Boîte de réception unifiée : brancher Brevo (courriel entrant), Meta (Messenger, Facebook, Instagram) et le relais humain

Phase 1 « entreprise autonome » (2 octobre 2026). La boîte unifiée reçoit tout ce par quoi une personne contacte Neomoov : application, réservation web, WhatsApp, texto, appels (déjà en place), et désormais le courriel de contact@, les messages privés et commentaires des réseaux Meta, les appels manqués du centre vocal, et les réseaux sans connecteur par relais humain. L'agent relation client répond partout avec les mêmes règles ; My Hub, **Pilotage, Boîte de réception**, montre tout.

Aucun secret dans ce manuel. Les clés se posent dans `/opt/neomoov/.env` (`docs/runbooks/secrets-et-cles.md`), puis `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker`.

## 1. Courriel entrant (contact@neomoov.net)

Deux voies ; la première suffit, la seconde est un repli.

### 1.1 Relais entrant Brevo (« inbound parsing »), recommandé

1. Choisir un secret : `openssl rand -hex 24`. Le poser dans `.env` : `EMAIL_INBOUND_SECRET=<secret>`. Recréer l'API.
2. Dans Brevo, **Transactionnel, Paramètres, Inbound parsing** (ou par l'API `POST /v3/inbound/webhooks`) : domaine ou adresse `contact@neomoov.net`, URL du webhook : `https://api.neomoov.net/v1/webhooks/email?secret=<secret>` (le secret dans l'adresse ; l'en-tête `x-inbound-secret` est aussi accepté si Brevo le permet un jour).
3. DNS du domaine : la boîte contact@ doit être reçue par Brevo : enregistrement MX de `neomoov.net` (ou d'un sous-domaine dédié, au choix) vers les serveurs indiqués par Brevo. Si contact@ est aujourd'hui une boîte LWS ou un relais ImprovMX, garder ce relais et ajouter Brevo en destination, ou passer par la voie 1.2.
4. Essai : envoyer un courriel à contact@ ; dans My Hub, Boîte de réception, filtre « Courriel », la conversation apparaît en quelques secondes avec l'accusé de réception puis la réponse de l'agent (mode approbation : la réponse part sans approbation, seules les actions financières attendent).
5. En cas de secret absent ou faux, l'API répond `400 WEBHOOK_SIGNATURE_INVALID` : vérifier l'adresse déclarée chez Brevo.

Ce qui est fait automatiquement : citations et signatures coupées, texte borné à 4 000 caractères, pièces jointes listées (nom, type, taille) mais jamais téléchargées ni transmises au modèle, courriels automatiques (rebonds, réponses d'absence, listes, expéditeurs sans réponse) classés **fermés** sans réponse (filtre « Fermées »), un même `Message-ID` jamais traité deux fois.

### 1.2 Lecture IMAP (repli)

Si le relais Brevo n'est pas possible, l'API lit la boîte par IMAP toutes les `inbox.mailbox_poll_seconds` secondes (120 par défaut) :

```
MAILBOX_PROVIDER=real
MAILBOX_HOST=<serveur IMAP, par exemple celui de LWS ou de Gmail>
MAILBOX_PORT=993
MAILBOX_USER=contact@neomoov.net
MAILBOX_PASSWORD=<mot de passe ou mot de passe d'application>
MAILBOX_FOLDER=INBOX
```

Les courriels non lus sont lus, traités, puis marqués lus. Les deux voies peuvent coexister : le `Message-ID` dédoublonne.

### 1.3 Réponses

Les réponses partent par le fournisseur de courriels de la plateforme (Resend, `EMAIL_PROVIDER=real`), au nom du réglage `inbox.email_from` (« Neomoov <contact@neomoov.net> » par défaut : le domaine doit être authentifié chez Resend), objet « Re: … », en-têtes `In-Reply-To` et `References` du courriel reçu (le fil reste groupé chez la personne), adresse de réponse contact@.

## 2. Réseaux Meta : Messenger, Facebook, Instagram

Même application Meta que WhatsApp (`docs/operations/acces-a-fournir.md`), mêmes `WHATSAPP_VERIFY_TOKEN` et `WHATSAPP_APP_SECRET`.

1. Dans l'application Meta : produits **Messenger** et **Instagram** ajoutés ; page Facebook Neomoov et compte Instagram professionnel reliés à la page ; jeton d'accès de la page (jeton longue durée, permissions `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`). Pour un usage au-delà des comptes de test, l'examen de l'application par Meta est requis pour ces permissions.
2. `.env` : `SOCIAL_PROVIDER=real`, `META_PAGE_ID=<identifiant de la page>`, `META_PAGE_TOKEN=<jeton de la page>`, `META_INSTAGRAM_ID=<identifiant du compte Instagram professionnel>` (facultatif sans Instagram). Recréer l'API et le worker.
3. Webhooks (application Meta, **Webhooks**) : objet **Page**, champs `messages` et `feed` ; objet **Instagram**, champs `messages` et `comments`. URL de rappel : `https://api.neomoov.net/v1/webhooks/meta`, jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`. (L'adresse WhatsApp `/v1/webhooks/whatsapp` accepte aussi ces objets, mais une adresse dédiée est plus lisible.) Abonner la page aux webhooks (`POST /{page-id}/subscribed_apps`).
4. Essai : un message privé à la page Facebook ; dans My Hub, filtre « Réseaux sociaux », la conversation apparaît, l'agent répond par Messenger. Un commentaire sous une publication : réponse publique courte ; un commentaire négatif ou une plainte est remis à l'humain (état « En attente de l'humain »), avec une réponse publique neutre qui renvoie au message privé.
5. Rattrapage : avec `SOCIAL_PROVIDER=real`, le worker interroge aussi l'API Graph à chaque passe de la file `inbox` (même période que l'IMAP) pour ce qu'un webhook aurait manqué.

Limites : fenêtre de 24 heures de Meta pour répondre à un message privé (au-delà, la réponse est refusée par Meta et l'avis passe en erreur dans la file des notifications : répondre à la main depuis la page) ; messages avec pièce jointe seulement notés « (pièce jointe sans texte) ».

## 3. Réseaux sans connecteur : relais humain

YouTube, TikTok, X, fiche Google, LinkedIn, Snapchat (lecture des messages non offerte par leur API, ou accès non ouvert) : My Hub, Boîte de réception, **Relais manuel**. Coller le message ou le commentaire reçu, le pseudonyme de la personne et, au besoin, le lien de la publication ; l'agent prépare la réponse en quelques secondes ; la copier, la coller sur le réseau, puis **Marquer relayée**. Les réponses en attente sont en tête de la boîte (état « Réponse à relayer »). Une réponse de l'équipe sur ces réseaux suit le même parcours.

## 4. Appels manqués et messages vocaux

À chaque rapport de fin d'appel du centre vocal (Vapi), un appel sans réservation ni transfert (raccroché avant d'avoir abouti, message vocal, panne, aucune suite) crée une conversation « Voix » (nature « Appel manqué » ou « Message vocal », résumé de l'appel), remise à l'humain : courriel au personnel, texto au fondateur si `inbox.escalation_sms` (numéro `alerts.founder_phone`), texto « nous vous rappelons » à la personne. Après `inbox.callback_reminder_minutes` (60), si la conversation est toujours ouverte, le personnel est rappelé (`alert.callback_due`). Rappeler la personne, puis répondre dans la conversation en cochant « Terminer ». Un appelant au numéro masqué n'est pas rappelable : rien n'est créé.

## 5. Réglages (My Hub, Paramètres)

| Clé | Valeur de départ | Rôle |
|---|---|---|
| `inbox.first_reply_seconds` | 5 | Délai visé de la première réponse ; au-delà, la conversation est signalée « en retard » dans la boîte |
| `inbox.escalation_sms` | `true` | Texto au fondateur (`alerts.founder_phone`) à chaque escalade et rappel |
| `inbox.quiet_hours` | `{ from: "22:00", to: "07:00", channels: ["email", "social"] }` | Heures silencieuses (heure de Montréal) : accusé seulement sur ces canaux, réponse de fond à la reprise ; retirer un canal ou vider la liste pour couper |
| `inbox.email_from` | `Neomoov <contact@neomoov.net>` | Expéditeur et adresse de réponse des courriels de la boîte |
| `inbox.callback_reminder_minutes` | 60 | Rappel au personnel d'un appel manqué toujours sans suite |
| `inbox.mailbox_poll_seconds` | 120 | Période de la file `inbox` (IMAP et rattrapage Meta) ; effet au redémarrage du worker |

Les deux fournisseurs restent simulés tant que `MAILBOX_PROVIDER` et `SOCIAL_PROVIDER` ne valent pas `real` : rien n'est lu par IMAP, les webhooks Meta sont refusés hors test, le relais humain et le courriel par Brevo fonctionnent quand même. Ils ne figurent pas dans la liste stricte d'`ALLOW_MOCK_PROVIDERS` (aucun envoi silencieusement perdu : sans connecteur, aucune conversation Meta n'existe).

## 6. Vérifier

- `GET /v1/admin/inbox/summary` (ou le bandeau « Par canal » de la page) : compteurs par canal, réponses à relayer.
- Journal des exécutions de l'agent relation client (Agents IA) : déclencheurs `conversation.email`, `conversation.social`.
- File `inbox` dans **Files de tâches** : passes et tâches de rappel en échec.
