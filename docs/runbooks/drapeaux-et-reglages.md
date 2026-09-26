# Désactiver un drapeau ou changer un réglage

Étape 16. Trois leviers, du plus rapide au plus lourd. Tous sont tracés (journal d'audit pour les réglages, historique du serveur pour `.env`). Aucun secret ici.

| Levier | Où | Délai d'effet | Qui |
|---|---|---|---|
| Réglage d'exploitation (table `settings`) | My Hub, Administration, **Paramètres** | Une minute au plus (cache de 60 s par processus) | Administrateur |
| Mode d'un agent IA | My Hub, Pilotage, **Agents IA**, **Régler** | Immédiat | Administrateur |
| Drapeau `FEATURE_*` et interrupteurs d'environnement (`DISPATCH_MODE`, `AGENT_TRIGGERS`, `CARD_PAYMENTS`…) | `/opt/neomoov/.env` sur le serveur, puis recréation de l'API et du worker | 1 à 2 minutes, avec une coupure de 30 à 60 s ; les applications mobiles le voient à leur prochaine ouverture (`GET /v1/config`) | Administrateur, par SSH |

## 1. Réglages d'exploitation (My Hub, Paramètres)

1. **Paramètres**, filtrer par la clé (par exemple `rides.min_lead`).
2. Modifier la valeur : elle est en JSON et doit garder le même type (nombre, texte entre guillemets, vrai ou faux, liste). Une valeur d'un autre type est refusée.
3. Enregistrer. L'effet arrive en moins d'une minute sur toutes les instances.

Réglages utiles en exploitation :

| Clé | Valeur de départ | Pour |
|---|---|---|
| `rides.min_lead_seconds` | 7200 | Préavis minimal des réservations (D32) |
| `drivers.require_active_pack` | `false` | Exiger un pack actif pour recevoir des offres |
| `drivers.require_payout_account` | `false` | Exiger le compte de versement Stripe pour passer en ligne (à activer avec Stripe réel) |
| `drivers.require_training` | `true` | Exiger la formation Neomoov pour passer en ligne |
| `alerts.founder_phone` | vide | Numéro appelé par l'agent vocal lors d'un SOS (avec `voice.sos_assistant_id`) |
| `voice.transfer_number` | numéro fictif de départ | Humain de garde vers qui l'agent vocal transfère : **à remplacer avant la mise en service** |
| `agents.daily_budget_micros` | 20 000 000 (20 $ US) | Plafond de dépense quotidien de tous les agents |
| `agents.report_recipients` | liste vide (administrateurs) | Destinataires des rapports de l'agent d'analyse |
| `notifications.quiet_hours` | 22 h à 7 h | Heures silencieuses, hors course en cours |
| `watchdog.*` | 30, 90, 240, 15, 20 minutes | Seuils des courses figées |
| `company.gst_number`, `company.qst_number` | vides | Numéros de taxes de Neomoov sur les factures : **à remplir avant la première facture réelle** |
| `company.legal_name`, `company.address` | « Neomoov », « Montréal (Québec) » | Dénomination et adresse sur les factures : **à remplacer avant la première facture réelle** (dénomination légale fixée par D25 : « GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. », à confirmer avec le comptable) |
| `support.phone`, `support.email` | vides | Coordonnées de l'écran Assistance des applications et recours de la page de suppression de compte ; vides : masquées. **À remplir avant la bêta** |
| `settlement.unpaid_grace_days`, `settlement.negative_balance_threshold_cents` | 7 jours, 15 000 (150 $) | Suspension pour solde négatif ; voir `releves.md`, « Limite connue : solde négatif » |

Ne jamais changer un réglage de tarification (`pricing.*`) pour corriger une course : corriger la course (remboursement, crédit) ; les tarifs changent par une ligne datée dans **Tarifs**.

## 2. Agents IA (My Hub, Agents IA)

**Régler** sur l'agent : mode `manual` (plus rien d'automatique, les demandes vont à l'équipe), `approval` (chaque action attend une approbation), `auto` ; case « Agent actif » ; plafond quotidien propre. L'agent recrutement reste en validation humaine obligatoire en V1 (mode `auto` refusé). Couper tous les déclencheurs d'un coup : `AGENT_TRIGGERS=off` (section 3).

## 3. Drapeaux et interrupteurs d'environnement

Sur le serveur (`redemarrer-un-service.md`, section 0 pour la connexion) :

```
nano /opt/neomoov/.env
```

Modifier la ligne (`on` ou `off`), enregistrer (`Ctrl+O`, Entrée, `Ctrl+X`), puis :

```
docker compose -f infra/compose.prod.yml up -d --force-recreate api worker
curl -s https://api.neomoov.net/v1/config
```

La réponse de `/v1/config` montre les drapeaux vus par les applications (`features`).

### Drapeaux `FEATURE_*` (tous `off` par défaut)

| Drapeau | Effet quand il est `on` | État en V1 |
|---|---|---|
| `FEATURE_IMMEDIATE_RIDES` | Courses immédiates, préavis ramené à `rides.scheduled_min_lead_seconds` | `off` (D32 : préavis de 2 heures) |
| `FEATURE_NEGOTIATION` | Négociation encadrée (5.5) ; `off` : routes en 404 `FEATURE_DISABLED` | `off` jusqu'à l'avis juridique (V1.1) |
| `FEATURE_NEGOTIATION_ABOVE_MAX` | Contre-offre du chauffeur au-dessus du prix affiché | `off`, avis juridique en attente |
| `FEATURE_FACE_CHECK` | Vérification faciale en début de quart | `off` : donnée biométrique, EFVP propre et déclaration à la CAI avant toute activation |
| `FEATURE_INSTALLMENTS` | Annonce le paiement échelonné aux applications | Ne pas activer : aucun fournisseur de paiement échelonné n'est branché |
| `FEATURE_RIDE_SERIES` | Lots de courses récurrentes | Ne pas activer : fonction non livrée (V1.1) |
| `FEATURE_SCHEDULED_FLIGHT_TRACKING` | Suivi de vol | Sans effet : aucun code ne le lit en V1 |

### Interrupteurs d'urgence

| Variable | Valeur d'urgence | Effet |
|---|---|---|
| `DISPATCH_MODE` | `manual` | Plus aucune recherche automatique pour les nouvelles demandes : les attributions se font dans My Hub (`reattribution.md`). Les recherches déjà ouvertes vont à leur terme, et **Réattribuer** relance toujours une recherche. Utile si la répartition envoie des offres erronées |
| `AGENT_TRIGGERS` | `off` | Plus aucun agent déclenché par un message, un document ou un relevé ; le worker ne traite plus du tout la file `agents`, donc les rapports planifiés s'arrêtent aussi |
| `LLM_SERVER_FALLBACK` | `off` | Retire le repli côté serveur de l'API Claude si l'API le refuse (décision du 26 septembre) |
| `CARD_PAYMENTS` | `off` | Plus aucun paiement par carte proposé (devis sans carte, Apple Pay ni Google Pay ; réservation prépayée refusée en 409 `CARD_PAYMENTS_UNAVAILABLE`) ; le paiement au chauffeur reste possible. Les applications le lisent dans `GET /v1/config` (`features.cardPayments`) |

### Interrupteurs de configuration

| Variable | Valeur en V1 | Règle |
|---|---|---|
| `CARD_PAYMENTS` | Vide (défaut) : carte proposée seulement si `PAYMENT_PROVIDER=real` en production | **Jamais `on`** tant que les applications n'ont pas la feuille de paiement Stripe (écran d'ajout de carte, décision du 26 septembre 2026). Dès le passage à Stripe réel, poser `off` explicitement : sinon la carte est proposée et le prépaiement échoue (« Aucune carte enregistrée ») |
| `ALLOW_MOCK_PROVIDERS` | Bêta proposée : `payment,sev,whatsapp,voice` | En production, tout fournisseur laissé `mock` sans figurer dans cette liste empêche l'API de démarrer (`docs/operations/acces-a-fournir.md`, « Démarrage de l'API en production ») |
| `REVIEW_PHONES`, `REVIEW_OTP_CODE` | Posés pendant l'examen des magasins | Numéros d'examen qui reçoivent toujours le code fixe, sans texto ; vider les deux après la publication (`docs/beta/comptes-de-test.md`, section 3) |
| `SEED_DEMO` | Absente | Ne concerne que le chargement des données de départ ; ne jamais la poser sur le serveur de production (`base-de-donnees.md`, section 4) |
| `COMPOSE_PROFILES` | `antivirus` quand l'antivirus est en service | Lu par `infra/deploy.sh` ; un changement demande un déploiement (`infra/deploy.sh build`), pas une simple recréation |

Ne jamais passer un `*_PROVIDER` de `real` à `mock` en production pour « couper » un fournisseur : le mode simulé fabrique de faux paiements, de faux envois et accepte des jetons forgés (l'API refuse d'ailleurs de démarrer si ce fournisseur n'est pas ajouté à `ALLOW_MOCK_PROVIDERS`, ce qu'il ne faut pas faire dans l'urgence). Pour couper un canal, agir chez le fournisseur :

| Canal | Où le couper |
|---|---|
| WhatsApp | Application Meta `Neomoov`, WhatsApp, Configuration : retirer l'abonnement du webhook |
| Agent vocal | Vapi : détacher l'assistant du numéro, ou renvoyer le numéro vers `voice.transfer_number` |
| Textos | Aucun interrupteur propre : les codes de connexion en dépendent |

## 4. Table `feature_flags` : sans effet

La base contient une table `feature_flags` (négociation, vérification faciale, Offre Flex, option Priorité, paiement direct, WhatsApp, agent vocal…), remplie par les données de départ. **Aucun code ne la lit en V1** : la modifier ne change rien. Les drapeaux qui comptent sont ceux de `/opt/neomoov/.env`. Signalé comme manque au code (la table ou l'environnement doit devenir la seule source).

## 5. Après chaque changement

- Noter la date, le levier, l'ancienne et la nouvelle valeur, la raison, dans le registre d'exploitation (`docs/operations/daily.md`, section « Registre »).
- Vérifier l'effet réel (un devis, une course de test, `/v1/config`).
