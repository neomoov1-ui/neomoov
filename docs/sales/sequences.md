# Séquences approuvées de la prospection B2B

Phase 1 « Neomoov entreprise autonome » (2 octobre 2026), agent `b2b_prospecting` et agent `followups`. Les textes ci-dessous sont les gabarits en service (`apps/api/src/modules/sales/sequences.ts`) : une séquence par segment, un message d'introduction puis trois relances aux échéances du réglage `sales.followup_days` (J+3, J+10, J+30 après le premier contact), par le canal d'origine (courriel professionnel, ou WhatsApp sur un numéro d'affaires déclaré). Après la dernière relance, la chaîne est close ; une réponse, un rendez-vous, un devis ou un retrait l'annule.

Règles de rédaction (prompt `docs/agents/followups.v1.md`) : le modèle personnalise une relance à partir du gabarit et du fil, sans ajouter de prix, de remise, de promesse de revenu ni de donnée personnelle ; la mention de retrait est ajoutée par la plateforme à chaque envoi (gabarit de notification `sales.message`, constante `SALES_OPT_OUT`). Variables : `{{organizationName}}`, `{{contactGreeting}}` (nom du contact, sinon « Madame, Monsieur »), `{{senderName}}` (réglage `sales.sender_name`, « L'équipe Neomoov » par défaut).

Choix de la séquence : réglage `sales.sequence_by_segment` (`hotel` et `agency` → `b2b_hotel`, `event` → `b2b_event`, les autres segments → `b2b_standard`).

## Mention de retrait (dans chaque envoi, Loi anti-pourriel)

> Vous recevez ce message parce que les coordonnées professionnelles de votre organisation sont publiques ou que vous avez contacté Neomoov (Groupe NSK inc., Montréal). Pour ne plus recevoir nos messages, répondez « STOP » ou écrivez à contact@neomoov.net : votre demande est appliquée immédiatement.

Une réponse « STOP » ou une demande au téléphone passe par l'outil `markDoNotContact` (étape `do_not_contact`, relances et appels annulés, HubSpot prévenu) ; l'arrivée des réponses dans la boîte unifiée relève de l'agent D.

## `b2b_standard` : entreprises, cliniques, écoles, autres

**Introduction** (objet : « Déplacements professionnels à prix fixe pour {{organizationName}} »)

> Bonjour{{contactGreeting}},
>
> Neomoov est un service de voitures avec chauffeur à Montréal : prix fixe et tout compris connu avant la course, véhicules électriques, chauffeurs professionnels vérifiés, réservation à l'avance (au moins 2 heures) depuis l'application, le web ou par téléphone.
>
> Pour une organisation comme {{organizationName}}, nous ouvrons un compte entreprise : facturation mensuelle unique, centres de coûts, suivi des déplacements de vos équipes et de vos invités.
>
> Si vous le souhaitez, je vous propose un court appel de 15 minutes pour voir si cela correspond à vos besoins. Répondez simplement à ce courriel avec un créneau qui vous convient.

**Relance 1 (J+3)** : rappel du résumé (prix fixe, véhicules électriques, chauffeurs vérifiés, une facture par mois) et demande d'un créneau cette semaine.

**Relance 2 (J+10)** : les trois usages des clients entreprises (transferts aéroport, invités et clients, trajets d'équipes en soirée), proposition adaptée au volume.

**Relance 3 (J+30)** : dernier message, porte ouverte, remerciement.

## `b2b_hotel` : hôtels et agences

**Introduction** (objet : « Transferts aéroport à prix fixe pour les clients de {{organizationName}} ») : service pour les clients de l'établissement (transferts aéroport et courses en ville à prix fixe, réservation par la conciergerie, reçu clair, aucune surprise de prix), demande d'un appel de 15 minutes et mention du programme réservé aux établissements.

**Relances** : J+3, retour sur la proposition et offre d'une démonstration à la réception ; J+10, ce que la conciergerie y gagne (prix annoncé, suivi en temps réel, reçu automatique, aucune carte de l'établissement engagée) ; J+30, dernier message.

## `b2b_event` : salles et organisateurs d'événements

**Introduction** (objet : « Déplacements des invités de vos événements, à prix fixe ») : déplacements des invités, conférenciers et équipes, réservation pour un tiers, regroupement des courses d'un événement, facture unique ; demande d'un appel de 15 minutes.

**Relances** : J+3, préparation des courses d'une date qui approche ; J+10, comment un événement est préparé (liste d'invités, horaire, confirmation par texto, suivi, facture unique) ; J+30, dernier message.

## Devis entreprise (gabarit `sales.quote`)

Envoyé par l'outil `createBusinessQuote` (dans la grille `sales.business_grid` : exécuté en mode automatique ; hors grille : approbation humaine) ou par le bouton « Devis » de My Hub : remise sur le prix fixe affiché selon le volume mensuel, facture mensuelle payable à N jours, validité du devis, acceptation par simple réponse. Une relance « devis » suit les mêmes échéances (gabarit `QUOTE_FOLLOWUP`).

## Candidats chauffeurs (gabarit `sales.candidate_reminder`)

Relance d'un candidat au statut « à valider » dont des documents d'inscription manquent après `sales.candidate_followup_after_days` jours : liste des documents manquants, invitation à les déposer dans l'application chauffeur ; push et texto selon la matrice des notifications.

## Textes anglais

Chaque gabarit existe en anglais (langue du prospect) ; les textes sont dans le même fichier source. Toute modification d'un gabarit se fait dans `sequences.ts` et dans ce document, puis est validée par le fondateur avant déploiement.
