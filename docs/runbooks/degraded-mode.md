# Mode dégradé : ce qui continue quand un fournisseur tombe

Prompt 15, tâche 4. Pour chaque panne, ce que la plateforme fait seule, ce que voit l'exploitation et ce qu'elle peut faire. L'état des fournisseurs se lit dans `GET /v1/health` : `status` passe à `degraded` et `circuits` montre les disjoncteurs ouverts ; les files en échec se lisent dans My Hub (`GET /v1/admin/queues`).

| Panne | La plateforme | L'exploitation voit | L'exploitation fait |
|---|---|---|---|
| Google Routes (itinéraires) | Devis en mode estimé (distance à vol d'oiseau majorée de 30 %, 30 km/h), marqués `estimated` ; après 5 échecs consécutifs, disjoncteur ouvert 30 s : plus d'attente du délai de Routes | `circuits` : `maps.routes` ouvert ; devis estimés dans les courses | Rien d'urgent ; si la panne dure, vérifier la clé et le quota Google |
| Stripe (paiements) | Autorisation refusée : le client choisit une autre carte ou le paiement au chauffeur ; capture ratée : nouvelle tentative, puis solde dû et incident ; webhooks repris toutes les 5 minutes ; règlements du vendredi en échec repris le lundi | Incidents `payment_failed`, relevés en échec, file `payments` | Proposer le paiement au chauffeur ; relancer les tâches en échec (My Hub, Files) quand Stripe revient |
| Twilio (textos) | Chaque texto raté est réessayé deux fois par la reprise (30 s), puis marqué en erreur ; le push reste le canal principal | Notifications en erreur (`sms_…`), connexions par code impossibles pour les nouveaux clients | Joindre les clients par l'application ou le courriel ; activer un autre numéro Twilio |
| Expo (push) | Événements critiques (attribution, arrivée, approche, SOS) envoyés par texto à la place ; les autres restent en erreur | Notifications `push_refused` | Rien ; vérifier les reçus quand Expo revient |
| Resend (courriels) | Trois essais, puis erreur ; les factures et relevés restent dans l'application | Notifications en erreur sur le canal courriel | Renvoyer plus tard si besoin |
| Modèles de langage (agents) | Agent en échec : action escaladée à un humain, jamais exécutée seule ; au-delà du plafond de dépense quotidien, agent en mode manuel | File d'approbation, exécutions en échec | Traiter les demandes à la main |
| Vapi (voix) | Appels non pris par l'assistant | Journal des appels vide | Renvoyer le numéro vers un humain (réglage `voice.transfer_number`) |
| SEV (facturation) | Factures générées quand même, transmission différée avec reprises (tolérance du fournisseur) | Factures `pending` ou `error` dans My Hub | Relancer la transmission (My Hub, Factures) |
| Redis | Files et temps réel arrêtés côté worker ; l'API répond, santé `degraded` | `checks.redis` en erreur | Redémarrer Redis (`redemarrer-un-service.md`, section 5) ; les tâches à identifiant stable ne se dupliquent pas à la reprise |
| Base de données | L'API répond 503 sur la santé, les écritures échouent ; les instances de l'API passent `unhealthy` et sont relancées toutes les 5 minutes sans effet | Santé `GET /v1/health` en 503 ; sonde de disponibilité en alerte une fois les moniteurs Better Stack créés (aucune aujourd'hui, `observabilite.md`, section 5) | Voir `sauvegardes.md` (restauration) et Supabase ; ne pas redémarrer les services |
| Stockage objet (Supabase Storage) | Documents des chauffeurs, PDF des factures et des relevés, exports (registres, géolocalisation, Loi 25) en échec ; les courses ne dépendent pas du stockage | Erreurs dans les journaux de l'API et du worker, tâches en échec dans My Hub, **Files de tâches** | Vérifier le statut de Supabase ; relancer les tâches en échec au retour |

Tests qui le vérifient (fournisseurs simulés en panne) : `circuit-breaker.e2e` (Routes), `degraded.e2e` (Stripe à la réservation : 502 `PAYMENT_PROVIDER_ERROR`, aucune course créée, paiement au chauffeur possible ; modèle de langage : accusé de réception, exécution en échec, conversation confiée à l'équipe), `notifications.e2e` (textos : reprise puis erreur ; push : repli texto des événements critiques), `queue-resilience.e2e` (worker arrêté en plein envoi : ni perte ni doublon).

## Redémarrage du worker

Les tâches BullMQ ont des identifiants stables (une tâche ajoutée deux fois n'existe qu'une fois) et chaque traitement est rejouable : paiements et remboursements par clé d'idempotence Stripe, factures et registres une seule fois par course, relevés une seule fois par semaine, notifications réservées une à une. Une notification réservée par un worker arrêté est reprise 10 minutes après sa réservation (et non après sa création) ; un envoi en cours ailleurs n'est jamais doublé. Redémarrer le worker (`docker compose -f infra/compose.prod.yml restart worker`) est donc sans risque ; vérifier ensuite My Hub, Files de tâches.

Principe : aucune panne d'un fournisseur ne bloque une course déjà attribuée ; aucune action financière n'est rejouée deux fois (clés d'idempotence) ; tout ce qui a échoué est visible et relançable.
