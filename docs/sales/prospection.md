# Prospection B2B automatisée : règles légales, sources, fonctionnement

Phase 1 « Neomoov entreprise autonome » (2 octobre 2026), direction commerciale : agents `b2b_prospecting`, `outbound_calls` et `followups`, tables `prospects`, `prospect_touches`, `followups`, `outbound_calls` (réservées à la plateforme, `docs/isolation.md`), page « Ventes » de My Hub, file BullMQ `sales`.

## Règles légales (Loi anti-pourriel, Loi 25)

- **Prospection B2B seulement.** Un prospect est une organisation (hôtel, entreprise, agence, salle d'événements, clinique, école). Une adresse d'une messagerie grand public (`gmail.com`, `hotmail.*`, `videotron.ca`, etc. : liste `FREE_MAIL_DOMAINS` du domaine) est refusée à la validation (`businessEmail`), à l'import comme dans les outils des agents. Jamais un particulier.
- **Base légale journalisée** (`prospects.consent_basis`, `consent_at`, `consent_source`) : `published_address` (coordonnées professionnelles publiées sans mention de refus : consentement tacite de la Loi anti-pourriel), `form` (formulaire du site avec case cochée, date gardée depuis `leads.consent_at`), `existing_relationship`, `referral`, `none` (prospect connu mais jamais démarché). Rien ne part vers HubSpot sans base (`none`) ni après un retrait.
- **Mention de retrait dans chaque envoi** (gabarit `sales.message`, `sales.quote`, `sales.meeting_confirmation` : constante `SALES_OPT_OUT`) : réponse « STOP » ou courriel à contact@neomoov.net. Le retrait est définitif (`do_not_contact`, `unsubscribed_at`) et respecté sans exception : séquences, relances, appels, devis et ouverture de compte sont refusés ; un réimport de la même adresse est ignoré avec le motif `do_not_contact`.
- **Repos après un refus** : un prospect perdu n'est pas relancé avant `sales.lost_cooldown_days` (180 jours).
- **Appels** : heures de bureau seulement (`sales.call_hours`, jours ouvrables de 9 h à 17 h, heure de Montréal) ; rendez-vous proposés avec M. Yves Christopher, responsable de la relation client et superviseur (`sales.meeting_host`), du lundi au samedi de 9 h à 17 h (`sales.meeting_hours`), décision du fondateur du 3 octobre 2026 ; enregistrement seulement si `sales.record_calls` est vrai, annoncé par l'assistant (métadonnée `recording: announced`), consentement journalisé (`outbound_calls.recording_consent`).
- **Données minimisées** : fil des contacts en résumés de 500 caractères, résumé d'appel de 2 000 caractères, jamais de transcription ni d'enregistrement en base ; My Hub affiche les coordonnées masquées. HubSpot reçoit l'organisation, le contact professionnel, l'étape et des notes courtes (`docs/crm.md`).

## Sources (réglage `sales.sources`)

| Source | Fonctionnement | Base légale |
|---|---|---|
| Google Places (`places.categories` × `places.zones`) | Adaptateur `PlacesProvider` : Google Places (`places:searchText`, clé `GOOGLE_MAPS_SERVER_KEY`, choisi par `MAPS_PROVIDER=real`), sinon simulateur. Établissements fermés exclus ; lieux déjà connus exclus (`source_ref`) ; plafond `sales.daily_new_prospects` (20 par jour) | `published_address` |
| Fichier CSV importé par My Hub (`csv`) | Page Ventes, « Importer » : colonnes organisation, segment, contact, rôle, courriel, téléphone, WhatsApp, site, ville, langue, base légale ; chaque ligne validée ; refus motivés | déclarée à l'import (`published_address` par défaut) |
| Formulaires du site (`webLeads`) | Demandes d'entreprises et de partenaires reçues dans `leads` avec consentement ; le modèle lit le nom de l'organisation dans le message | `form` |

## Passe de prospection (agent `b2b_prospecting`, enchaînement fixe)

Du lundi au vendredi (`sales.prospecting_days`) à partir de 9 h (`sales.prospecting_hour`), une exécution par jour (référence = date), outils déclarés : `searchProspects`, `listLeadProspects`, `createProspect`, `qualifyProspect`, `startSequence`, `markDoNotContact`.

1. Sources ouvertes jusqu'au plafond quotidien.
2. Qualification par le modèle (sortie structurée `prospect_qualification`, lots de 20) des prospects « nouveaux » et des demandes du site : segment, taille, intérêt, retenu ou écarté, motif ; score recalculé (`prospectScore`).
3. Séquence approuvée (`docs/sales/sequences.md`) par le canal professionnel : en mode approbation (défaut), proposition dans la file d'approbation de My Hub ; en mode automatique, envoi par la file des notifications, étape `contacted`, relance J+3 planifiée, fiche HubSpot (file `crm`).

## Appels sortants (agent `outbound_calls`)

- Planification par l'outil `scheduleCall` (approbation selon le mode) ou le bouton « Appeler maintenant » de My Hub ; lancement par la passe de la file `sales` (toutes les 5 minutes, `sales.max_calls_per_tick` appels) aux heures de bureau, via `VoiceProvider.startOutboundCall` (Vapi `POST /call`, `assistantId` = `VAPI_SALES_ASSISTANT_ID`, `phoneNumberId` = `VAPI_SALES_PHONE_NUMBER_ID`, métadonnées : identifiant d'appel, prospect, script, langue, enregistrement).
- Rapport de fin d'appel reçu par le webhook Vapi existant (`/v1/webhooks/vapi`), reconnu par l'identifiant d'appel ou l'assistant commercial : résultat (`meeting`, `callback`, `not_interested`, `voicemail`, `no_answer`, `do_not_contact`, `failed`) lu dans les données structurées de l'assistant, sinon déduit de la raison de fin, sinon classé par le modèle (`call_outcome`) ; résumé et coût dans `outbound_calls`, fil du prospect, note HubSpot.
- Suites par les outils : rendez-vous → `scheduleMeeting` (événement dans l'agenda du fondateur par `CalendarProvider` : Google Calendar si `CALENDAR_PROVIDER=real`, sinon simulé ; courriel de confirmation ; alerte au personnel) ; rappel → `scheduleCall` ; retrait → `markDoNotContact` ; messagerie ou sans réponse → nouvelle tentative le jour ouvrable suivant (`sales.call_retries`).
- Script et configuration de l'assistant : `docs/voice-agent.md`, section « Assistant commercial ».

## Relances (agent `followups`)

Chaque matin à partir de `sales.followups_hour` (8 h) : découverte des cibles sans chaîne (devis envoyés sans réponse, candidatures de chauffeurs au statut « à valider » avec documents manquants depuis `sales.candidate_followup_after_days`), puis relances échues (J+3, J+10, J+30 : `sales.followup_days`) par le canal d'origine, texte rédigé par le modèle à partir du gabarit approuvé et du fil (`followup_message`), envoi par l'outil `sendFollowup` (approbation selon le mode), clôture après la dernière relance. Les réservations web abandonnées ne sont pas relancées : les devis anonymes du site (`quotes.session_key`) ne portent aucune coordonnée, il n'existe donc aucune trace légitime à relancer ; à revoir si le formulaire de réservation web demande un jour un courriel avec consentement.

## Exécution des demandes

- `createBusinessQuote` : grille `sales.business_grid` (paliers de remise par volume mensuel, remise maximale, délai de paiement, validité) ; dans la grille, exécuté en mode automatique ; hors grille (remise ou délai au-delà, volume sous le minimum) ou en mode approbation, file d'approbation. Devis gardé sur la fiche (`last_quote`), courriel `sales.quote`, relance « devis » planifiée.
- `openBusinessAccount` : organisation cliente de type `business` sous la racine Neomoov (services des organisations, au nom d'un administrateur de la plateforme), invitation du propriétaire par courriel (rôle `org_owner`, 14 jours), prospect `won`. HubSpot : organisation synchronisée par l'événement `organization.created`.
- `proposeSalesDecision` : tarif négocié ou contrat particulier soumis à une personne.
- `scheduleMeeting`, `markDoNotContact` : exécutés dans tous les modes (le rendez-vous est visible dans l'agenda et annulable ; le retrait protège la personne).

## My Hub, page « Ventes »

Liste des prospects (filtres par étape, source, segment, score minimal, recherche), fiche (fil des contacts, appels, relances, devis), boutons « Appeler maintenant », « Relancer », « Devis », « Ouvrir le compte », « Ne plus contacter », import CSV, passes à la demande. Permissions `sales.read` (lecture commune du personnel) et `sales.manage` (administrateur, opérateur).

## Comptes et clés à fournir

| Besoin | Variables | État |
|---|---|---|
| Assistant commercial Vapi et numéro sortant | `VAPI_SALES_ASSISTANT_ID` (créé par `vapi:setup`), `VAPI_SALES_PHONE_NUMBER_ID` facultatif (sinon numéro de l'accueil `VAPI_PHONE_NUMBER_ID`) | assistant créé par le script ; numéro dédié facultatif |
| Google Places | `GOOGLE_MAPS_SERVER_KEY` avec l'API Places (New) activée, `MAPS_PROVIDER=real` | clé des cartes existante, API à activer |
| Agenda du fondateur | `CALENDAR_PROVIDER=real`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | à créer : client OAuth « application de bureau » dans la console Google Cloud (API Calendar activée), jeton de rafraîchissement obtenu une fois par le flux OAuth avec la portée `https://www.googleapis.com/auth/calendar.events` |
| HubSpot | `CRM_PROVIDER=real`, `HUBSPOT_ACCESS_TOKEN` | portées à compléter (`docs/crm.md`) ; options `b2b` et `prospect` ajoutées au modèle, relancer `crm:setup` |
| Courriels et WhatsApp des séquences | Resend (`EMAIL_PROVIDER=real`), Meta (`WHATSAPP_PROVIDER=real`) | comptes existants |

En production, un fournisseur laissé simulé doit être déclaré dans `ALLOW_MOCK_PROVIDERS` (`calendar` ajouté aux alias).
