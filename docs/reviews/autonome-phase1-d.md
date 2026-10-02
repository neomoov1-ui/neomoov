# Phase 1 « entreprise autonome », agent D : boîte de réception unifiée (courriel, messages sociaux, appels manqués)

Branche `autonome-d-boite` (copie `neomoov-wt20b`), créée depuis `main` (`7415616`). Mission : `neomoov-outils/agents/L-autonome-d-boite-unifiee.md` (plan du 2 octobre 2026, section 4.4). Migration provisoire `0032_inbox-channels` (appliquée sur la base de développement sous le verrou `autonome-d`, inverse dans `down/`). Dépendance ajoutée à l'API : `imapflow` 2.2.1 (lecture IMAP de repli). Manuel : `docs/runbooks/boite-unifiee.md`.

## Critères d'acceptation

| Livrable | Fait | Vérifié par |
|---|---|---|
| 1. Canaux `email` et `social` (domaine, contrainte, migration), `ConversationsService` et `NotificationsOutbox` répondant par courriel (contact@, fil `In-Reply-To` / `References`) et par le réseau d'origine | Oui : `CONVERSATION_CHANNELS`, `NOTIFICATION_CHANNELS` (+ `social`), migration 0032 ; `send()` queue un avis `email` (objet « Re: », expéditeur `inbox.email_from`, en-têtes) ou `social` (connecteur) ; relais pour les réseaux sans connecteur | `autonome-d-boite.e2e` (en-têtes et expéditeur du courriel simulé, réponses Messenger et commentaire par le connecteur simulé) |
| 2. Courriel entrant : `POST /v1/webhooks/email` (Brevo, secret `EMAIL_INBOUND_SECRET`), lecture IMAP (`MailboxProvider` réel `imapflow`, simulé en test, variables `MAILBOX_*`), `conversation.inbound` canal `email`, `Message-ID` dédoublonné, pièces jointes listées jamais transmises, 4 000 caractères, citations et signatures coupées, courriels automatiques classés sans réponse, `.env.example` | Oui | `inbox.test` (domaine : nettoyage, automatiques, identifiants), `inbox-units.test` (MIME, Brevo), `autonome-d-boite.e2e` (relais, IMAP simulé, doublon, automatiques, pièce jointe absente des requêtes au modèle) |
| 3. `SocialProvider` (Meta Graph réel : Messenger, Instagram, commentaires Facebook et Instagram ; même jeton et même secret que WhatsApp ; `/v1/webhooks/meta` et objets `page` / `instagram` sur `/v1/webhooks/whatsapp`), simulé en test ; autres réseaux en relais (My Hub) ; commentaire négatif ou plainte → conversation `social` escaladée | Oui : relais par `POST /v1/admin/inbox/relay` et `relay_status` du message (pas de table `social_relay`) | `inbox-units.test` (lecteur Meta, échos ignorés, simulateur), `autonome-d-boite.e2e` (DM, commentaire négatif escaladé avec réponse publique neutre et alerte, relais marqué relayé, réponse de l'équipe à relayer) |
| 4. Appels manqués : rapport Vapi → appel sans réservation ni transfert → conversation `voice`, texto « nous vous rappelons », tâche de rappel (BullMQ différée faute de `followups`) | Oui (`voice.call_ended`, `MissedCallsService`, file `inbox`, `alert.callback_due`) | `inbox.test` (`callOutcome`), `autonome-d-boite.e2e` (conversation escaladée, texto, tâche différée vérifiée, rapport rejoué, rappel puis clôture) |
| 5. My Hub « Boîte de réception » : filtres par canal, état, réseau ; réponse manuelle ; relais ; i18n FR et EN | Oui : `/hub/boite-de-reception` (menu Pilotage), routes `GET /v1/admin/inbox`, `/summary`, `/:id`, `POST /relay`, `POST /messages/:id/relayed` (`agents.read`, `conversations.reply`), OpenAPI régénérée (348 chemins), client d'API compilé | `autonome-d-boite.e2e` (liste et filtres, résumé, détail, droits 403) ; `pnpm --filter @neomoov/web typecheck` vert ; écran non parcouru au navigateur (pas de serveur de développement lancé) |
| 6. Réglages `inbox.first_reply_seconds` (5), `inbox.escalation_sms` (vrai), `inbox.quiet_hours` (22 h à 7 h), seedés | Oui, plus `inbox.email_from`, `inbox.callback_reminder_minutes`, `inbox.mailbox_poll_seconds` (`packages/db/src/seed/data.ts`) ; `db:seed` non relancé sur la base partagée (valeurs de repli identiques dans le code) | `autonome-d-boite.e2e` (heures silencieuses : accusé seul, tâche différée, reprise ; résumé `firstReplySeconds`) |
| 7. `apps/api/test/autonome-d-boite.e2e.test.ts` | Oui, 6 tests | Voir ci-dessous |
| 8. `docs/decisions.md`, cette note, `docs/runbooks/boite-unifiee.md` | Oui ; prompt `docs/agents/customer-relations.v2.md` ajouté (à activer en base, voir décisions) | |

## Tests lancés (2 octobre 2026)

| Commande | Résultat |
|---|---|
| `pnpm --filter @neomoov/domain test` (couverture) | 39 fichiers, 521 tests verts, couverture 100 % (lignes, branches, fonctions) ; nouveau dossier `src/inbox` couvert à 100 % |
| `vitest run test/inbox-units.test.ts` (API, sans base) | 7 tests verts |
| `autonome-d-boite.e2e.test.ts` (base de développement, sous verrou `autonome-d`) | 6 sur 6 verts (87 s), après trois corrections : corrélation des sous-requêtes de la boîte (drizzle rend une colonne sans préfixe de table dans les champs d'un `select`), attente des avis mis en file, attente de la tâche différée |
| `pnpm --filter @neomoov/api typecheck`, `@neomoov/worker typecheck`, `@neomoov/db typecheck`, `@neomoov/web typecheck` | Verts (lancés un par un) |
| `packages/db` `journal.test.ts` | 2 tests verts (journal monotone, 0032 datée après 0031) |
| `pnpm openapi` puis `pnpm --filter @neomoov/api-client build` et `test` | Document régénéré (348 chemins), client compilé, 6 fichiers, 30 tests verts |
| Lot ciblé sous verrou : `voice`, `messaging`, `support`, `agents` (`.e2e.test.ts`) | Voir le rapport final (lancé après cette note) |

## Points vérifiés

- Aucune nouvelle table : `conversations` et `conversation_messages` gardent leurs politiques `org_isolation` ; la liste des tables de la plateforme est inchangée.
- Le modèle ne reçoit jamais une pièce jointe ni une adresse : seules les listes de noms sont gardées en métadonnées ; le contexte transmis dit le canal et la nature (courriel, commentaire public).
- Les webhooks sont vérifiés (secret en temps constant pour Brevo, signature HMAC Meta par le même secret que WhatsApp) et idempotents (`Message-ID`, identifiants de message et de commentaire, identifiant d'appel).
- Les simulateurs refusent les signatures de test en production (`acceptTestSignatures: false`), comme les autres fournisseurs.
- Le fondateur est prévenu de toute escalade (courriel au personnel, texto si `inbox.escalation_sms` et `alerts.founder_phone`), une seule fois par conversation.

## Reste à faire

- Parcourir l'écran Boîte de réception au navigateur (non fait : pas de serveur de développement lancé pendant la mission) ; ajouter un test Playwright si l'équipe le souhaite.
- Activer le prompt v2 de l'agent relation client en base (commande dans `docs/decisions.md`) et relancer `db:seed` pour les réglages `inbox.*`.
- Connecteur Meta réel non exercé contre l'API Graph (aucune clé) : à valider avec la page de test de l'application Meta ; lecture IMAP réelle non exercée (aucune boîte) : à valider sur contact@.
- Fenêtre de 24 heures de Meta : une réponse refusée reste en erreur dans la file des notifications ; un gabarit « message hors fenêtre » n'existe pas pour Messenger (contrairement à WhatsApp).
- Table `followups` (agent F) : y inscrire la tâche de rappel d'un appel manqué quand elle existera (aujourd'hui tâche BullMQ différée, perdue en mode mémoire au redémarrage de l'API ; persistante avec Redis).
- Tidio (discussion du site) : non branché à la boîte (hors périmètre de la mission ; export par webhook Tidio à prévoir).
- Indicateurs « temps de première réponse par canal » : disponibles ligne par ligne et dans le résumé ; agrégat par canal à ajouter au rapport quotidien de l'agent d'analyse.

## Pièges

- Dans les champs d'un `select()` de drizzle, une colonne insérée dans un fragment `sql` est rendue sans son nom de table (`"id"`) : une sous-requête corrélée doit nommer la table en clair (`conversations.id`).
- Les abonnés aux événements de domaine et la file en mémoire sont asynchrones : un test qui relit la conversation juste après l'événement doit attendre aussi les avis mis en file et les tâches différées (`until`).
- `QueueService.add` en mode mémoire honore désormais `delay` (minuteur sans persistance) : espionner `add` dans un test et laisser passer les appels sans `delay`, sinon l'événement entrant lui-même est perdu.
- `imapflow` est en ESM pur ; ses types sont dans `dist/cjs/*.d.ts` ; la partie texte se lit par `bodyParts` (contenu encodé en transfert, décodé par `adapters/real/mime.ts`).
- Les fichiers écrits par l'outil `Write` sont en LF dans une copie en CRLF ; Git normalise à la validation (`text=auto`), aucun changement de fin de ligne n'est à craindre dans le dépôt.
