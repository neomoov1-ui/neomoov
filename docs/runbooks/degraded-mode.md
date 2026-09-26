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
| Redis | Files et temps réel arrêtés côté worker ; l'API répond, santé `degraded` | `checks.redis` en erreur | Redémarrer Redis (`docs/runbooks/deploiement-lws.md`) ; les tâches à identifiant stable ne se dupliquent pas à la reprise |
| Base de données | L'API répond 503 sur la santé, les écritures échouent | Sonde de disponibilité en alerte | Voir `sauvegardes.md` (restauration) et Supabase |

Principe : aucune panne d'un fournisseur ne bloque une course déjà attribuée ; aucune action financière n'est rejouée deux fois (clés d'idempotence) ; tout ce qui a échoué est visible et relançable.
