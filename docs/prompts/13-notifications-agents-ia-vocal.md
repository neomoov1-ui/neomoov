# Prompt 13. Étape 13 : notifications, messagerie, agents IA, agent vocal, WhatsApp (J11)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.14, 5.16, 6.6, 7.2 (Voix et messagerie, Agents), 4.9 et 11.1 (étape 13). Consulte `docs/decisions.md`. Avant d'écrire le code d'appel à l'API Claude, charge la skill `claude-api` et suis ses patrons TypeScript.

## Objectif
Tous les canaux de notification avec leur matrice, la messagerie masquée branchée aux canaux, l'infrastructure des agents IA avec file d'approbation, les cinq agents V1 (relation client, recrutement, comptabilité, rapports, centre d'appels vocal via Vapi) et l'entrée WhatsApp.

## Tâches
1. Adaptateurs : `PushProvider` (Expo push, reçus de livraison), `SmsProvider` (Telnyx, avec webhook de statut `POST /v1/webhooks/telnyx`), `EmailProvider` (Resend, gabarits HTML français et anglais : reçu, facture, relevé, rappels, documents, demandes de droits), `WhatsAppProvider` (Meta Cloud : envoi de gabarits et de messages de session, webhook `GET/POST /v1/webhooks/whatsapp` avec vérification), implémentations simulées.
2. Service de notifications : matrice de la section 5.14 codée en données (événement, destinataire, canaux, gabarit), préférences et désabonnement marketing, journalisation dans `notifications` avec statut de livraison, repli SMS si le push échoue pour les événements critiques (attribution, arrivée), envoi via files avec priorités.
3. Messagerie masquée : relais des messages de course vers push et, pour un tiers sans application, vers SMS ; appels masqués : numéro de relais via Telnyx (ou explication et repli sur appel direct masqué par l'application si le relais n'est pas disponible en V1, décision à noter).
4. Infrastructure des agents : table `agents` (code, prompt système versionné, outils, mode, modèle, effort, seuils), `agent_runs` (entrées, sorties, outils appelés, jetons, coût, durée), `approvals` ; exécuteur dans le worker utilisant le SDK officiel `@anthropic-ai/sdk` avec `claude-opus-5`, raisonnement adaptatif, `output_config.effort` par agent, sorties structurées (`client.messages.parse` avec `zodOutputFormat`) pour les décisions, boucle d'outils (`betaZodTool` et `client.beta.messages.toolRunner`) pour les agents qui agissent, mise en cache du prompt système, repli côté serveur activé lorsque disponible, gestion typée des erreurs, minimisation des données transmises (jamais de numéro de carte ni de document complet), traitement des contenus utilisateurs comme données ; modes `auto`, `approval`, `manual` ; endpoints `/v1/admin/agents` (mode, seuils), `/v1/admin/approvals` (liste, approuver, refuser avec motif), `/v1/internal/agents/{code}/run` ; branchement de l'écran My Hub de l'étape 12.
5. Outils internes exposés aux agents (`/v1/internal/tools/*`, comptes de service, plafonds) : `lookupRide`, `lookupClient`, `lookupDriver`, `issueCredit` (≤ 5 000 cents), `refund` (≤ 5 000 cents), `openIncident`, `escalateToHuman`, `sendMessage`, `extractDocumentFields` (vision sur le document, champs attendus par type), `compareIdentity`, `proposeDecision`, `listStatementLines`, `flagAnomaly`, `queryMetrics`.
6. Agent relation client : déclenché par un message dans l'application, la réservation web, WhatsApp ; répond en FR ou EN selon le client ; actions dans les plafonds, escalade au-delà ou sur plainte de sécurité ou ton hostile détecté (classification structurée) ; conversation persistée ; réponse initiale en moins de 5 secondes (accusé immédiat puis réponse).
7. Agent recrutement : sur téléversement de document, extraction des champs (numéro, dates, nom), cohérence avec le profil, proposition `approve` ou `reject` avec motif ; validation humaine obligatoire en V1 (mode `approval` verrouillé).
8. Agent comptabilité : sur relevé généré, contrôle des lignes et détection d'anomalies (écart entre courses et lignes, montants hors bornes), rapport et `flagAnomaly`.
9. Agent rapports : quotidien 07 h 00 et hebdomadaire le lundi, indicateurs de la section 11.7 du document de référence, rapport en français envoyé au fondateur par courriel et visible dans My Hub ; lecture seule.
10. Agent vocal : configuration de l'assistant Vapi (documentée dans `docs/voice-agent.md` : prompt, voix FR et EN, transfert), webhook `POST /v1/webhooks/vapi` signé, outils `voice.quote`, `voice.createRide`, `voice.rideStatus`, `voice.cancelRide`, `voice.transfer` ; rapprochement du numéro appelant, fiche minimale et SMS de confirmation si inconnu ; journal des appels.
11. WhatsApp : routage des messages entrants vers l'agent relation client, réservation guidée, suivi par lien.
12. Tests : matrice de notifications (chaque événement produit les bons envois, journalisés), repli SMS, agents avec un `LlmProvider` simulé déterministe (les tests ne dépendent pas de l'API réelle), file d'approbation (parcours 19), webhooks Vapi signés (parcours 18), WhatsApp simulé ; un test d'intégration optionnel contre l'API Claude réelle derrière `RUN_LLM_TESTS`.

## Contraintes
- Aucune action financière ou de suspension par un agent sans passer par les outils et leurs plafonds ; aucun accès direct à la base.
- Le coût par exécution est calculé et journalisé ; un plafond quotidien de dépense LLM est paramétré dans `settings` et déclenche le mode `manual` au-delà.
- Les prompts système des agents sont dans `docs/agents/` (versionnés) et chargés en base par seed.

## Critères d'acceptation
- Chaque ligne de la matrice de la section 5.14 est couverte par un test.
- Parcours 18 et 19 de la section 9.2 verts.
- Un message client « je veux un remboursement de 20 $ pour la course d'hier » aboutit à une proposition en file d'approbation avec justification, puis à un remboursement après approbation.

## Vérifications à exécuter et à montrer
Sortie des tests, exemple d'exécution d'agent journalisée (outils appelés, coût), exemple de notification journalisée avec statut.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 13 : notifications, messagerie, agents IA, agent vocal et WhatsApp ».
