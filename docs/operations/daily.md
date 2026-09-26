# Journée type d'exploitation du fondateur

Étape 16 (prompt 16, tâche 6). Ce que le fondateur regarde, ce qu'il valide, où, dans quel ordre, et combien de temps cela prend, pendant la bêta et au lancement. Toutes les heures sont celles de Montréal. My Hub : `https://hub.neomoov.net/hub` (connexion avec second facteur, `docs/runbooks/personnel-my-hub.md`).

## Ce qui tourne la nuit, sans personne

| Heure | Passe | Résultat visible le matin |
|---|---|---|
| Toute la nuit | Répartition, rappels des réservations (J-1), alertes des planifiées non confirmées, notifications, reprises des paiements et du SEV | Tableau de bord, Incidents, Files de tâches |
| 3 h | Conservation Loi 25 (purges), seulement si une sauvegarde a été confirmée depuis moins de 26 heures | Conformité et conservation, « Dernières tâches » |
| 3 h 30 | Sauvegarde chiffrée de la base (tâche planifiée du serveur) | Journal de la sauvegarde |
| 4 h | Agent qualité : mesures et propositions de sanctions | Agents IA, file d'approbation ; Qualité des chauffeurs |
| La nuit | Conformité : échéances, rappels J-30, J-7, J-1, suspensions au lendemain de l'échéance, levées | Conformité et conservation |
| 7 h | Rapport quotidien de l'agent d'analyse (hebdomadaire le lundi), envoyé par courriel | Agents IA, « Rapports de l'agent d'analyse » |
| Vendredi, dès 6 h | Relevés de la semaine précédente : génération, émission, règlement | Relevés |

## Alertes : ce qui prévient le fondateur, et ce qui ne le fait pas encore

| Événement | Comment il arrive |
|---|---|
| SOS d'un client ou d'un chauffeur | Texto à chaque administrateur et opérateur, alerte en direct dans My Hub, appel de l'agent vocal au numéro `alerts.founder_phone` s'il est réglé |
| Aucun chauffeur, planifiée non confirmée, incident | Alerte en direct dans My Hub (onglet ouvert seulement) |
| Course figée, relevé en échec | Notification push au personnel : **le personnel n'ayant pas d'appareil enregistré, elle n'arrive nulle part** ; seule la vérification du matin les rattrape |
| API ou site injoignable | **Rien pour l'instant** : la surveillance externe (Better Stack) et Sentry ne sont pas branchés |

Conséquence : pendant les heures d'exploitation, garder un onglet My Hub ouvert sur le **Tableau de bord** (pastille « Temps réel actif »).

## Le matin (40 à 50 minutes pendant la bêta)

Dans cet ordre : la sécurité des personnes d'abord, l'argent ensuite, le reste après.

| # | Quoi | Où | Ce qu'on valide ou fait | Temps |
|---|---|---|---|---|
| 1 | Santé de la plateforme | Navigateur : `https://api.neomoov.net/v1/health` | `"status":"ok"` ; sinon `docs/runbooks/redemarrer-un-service.md`, section 1 | 1 min |
| 2 | Sauvegarde de la nuit | PowerShell : `ssh root@<adresse IP du VPS> "tail -n 3 /var/log/neomoov-backup.log"` | La ligne « Sauvegarde vérifiée : N tables » porte la date du jour ; sinon `docs/runbooks/sauvegardes.md` | 2 min |
| 3 | Confirmer la sauvegarde | Sécurité et conformité, **Conformité et conservation**, « Confirmer la sauvegarde vérifiée » (administrateur) | Note : « Journal du AAAA-MM-JJ lu ». Sans cette confirmation, la conservation de la nuit suivante se bloque. Vérifier aussi « Dernières tâches » : aucune ligne `blocked_no_backup` | 1 min |
| 4 | Alertes et incidents | **Tableau de bord**, bloc « Alertes SOS et incidents » ; puis **Incidents** (ouverts d'abord, par gravité) | Chaque SOS et plainte de sécurité : décider de lever ou maintenir le blocage préventif du chauffeur ; garanties modèle : valider ou refuser ; paiements en échec : contacter le client si besoin | 5 à 10 min |
| 5 | Courses du jour | **Tableau de bord** (en recherche, planifiées non confirmées) ; **Courses**, vues « Répartition » et « Planifiées » | Toute planifiée du jour confirmée par un chauffeur ; une course qui cherche depuis longtemps ou semble figée : `docs/runbooks/reattribution.md`. La liste des courses figées n'a pas d'écran : la parcourir du regard | 5 min |
| 6 | Files de tâches | Administration, **Files de tâches** | Colonne « En échec » à zéro ; sinon lire le motif, **Relancer** si le fournisseur est revenu (`docs/runbooks/degraded-mode.md`) | 2 min |
| 7 | File d'approbation des agents | Pilotage, **Agents IA**, « File d'approbation » | Remboursements et crédits proposés par l'agent relation client, décisions de documents de l'agent recrutement, sanctions de l'agent qualité, anomalies de l'agent comptabilité : approuver (exécuté une seule fois) ou refuser avec motif | 5 à 10 min |
| 8 | Conversations escaladées | **Agents IA**, « Conversations de l'assistance » | Répondre aux clients que l'agent a confiés à l'équipe | 5 min |
| 9 | Dépense des agents | **Agents IA** : « Dépense du jour » et plafond | Un agent passé en mode manuel faute de budget : le remettre en service ou le laisser en manuel (`docs/runbooks/drapeaux-et-reglages.md`) | 1 min |
| 10 | Rapport de l'agent d'analyse | **Agents IA**, « Rapports de l'agent d'analyse » (ou le courriel de 7 h) | Lire ; noter les tendances (annulations, sans chauffeur) | 3 min |
| 11 | Dossiers des chauffeurs | **Tableau de bord** (« Chauffeurs à valider », « Documents à vérifier ») ; **Documents** ; **Véhicules** ; **Chauffeurs** | Valider ou refuser chaque document (l'agent recrutement propose, l'humain décide), statut des véhicules, **Activer** un chauffeur complet | 5 min |
| 12 | Qualité | Sécurité et conformité, **Qualité des chauffeurs** (filtre « Seulement les chauffeurs à suivre ») | Comprendre les propositions de la nuit avant de les approuver à l'étape 7 ; la radiation reste une décision sur la fiche du chauffeur | 2 min |
| 13 | Conformité | **Conformité et conservation**, échéances filtrées « Dépassée » puis « À venir » | Suspensions de la nuit comprises ; prévenir les chauffeurs dont l'échéance approche ; inspections trimestrielles dues (**Inspection**) | 3 min |
| 14 | Demandes de droits (Loi 25) | Sécurité et conformité, **Demandes de droits** | Aucune demande « En retard » (délai légal de 30 jours). Exports et suppressions sont automatiques ; une rectification se traite à la main (aucun bouton pour la marquer traitée : manque signalé) | 2 min |
| 15 | Factures | Finances, **Factures**, bloc « Transmission au SEV » | Aucune erreur récente ; sinon **Reprendre** (SEV simulé en V1) | 1 min |
| 16 | Retours de la bêta | App Store Connect (TestFlight, Commentaires) ; boîte `beta@neomoov.net` | Reporter au tableau `docs/beta/suivi-des-retours.md` ; qualifier tout « Bloquant » tout de suite | 5 à 10 min |

## Pendant la journée

- Onglet **Tableau de bord** ouvert : réagir aux alertes (SOS en priorité absolue).
- Courses par téléphone : **Nouvelle course** (préavis de 2 heures, paiement au chauffeur), puis attribution si besoin.
- Prospects (**Prospects**) : chauffeurs préinscrits sur le site, à rappeler.

## Le soir (5 minutes)

- **Courses**, vue « Planifiées » : les courses du lendemain matin ont un chauffeur confirmé ; sinon joindre les chauffeurs.
- **Tableau de bord** : aucune alerte ouverte avant la nuit.

## Chaque semaine

| Quand | Quoi | Où | Temps |
|---|---|---|---|
| Lundi | Rapport hebdomadaire de l'agent d'analyse ; nouveaux essais des règlements en échec ; soldes des chauffeurs | Agents IA ; Relevés, « Soldes des chauffeurs » | 15 min |
| Mardi et vendredi | Revue de tri des retours de bêta | `docs/beta/procedure.md` | 30 min |
| Vendredi | Relevés : tous émis et réglés, anomalies de l'agent comptabilité, suspensions pour solde | `docs/runbooks/releves.md`, « Contrôle du vendredi » | 20 min |
| Vendredi | Rapports de la semaine : annulations, sans chauffeur, note moyenne | **Rapports** (export CSV possible) | 10 min |

## Chaque mois

| Quand | Quoi | Où |
|---|---|---|
| Début du mois | Export de géolocalisation du mois écoulé produit (automatique dès le 1er) | Finances, **Registres et exports** |
| Début du mois | Redevance du mois terminé : contrôler, remettre, marquer « remise » avec la référence | **Registres et exports** |
| Fin de trimestre | Registres des taxes (trimestre `AAAA-Tn`) pour les déclarations, rapports trimestriels des chauffeurs | **Registres et exports** |
| Une fois par mois | Restauration d'essai de la dernière sauvegarde, résultat noté | `docs/runbooks/sauvegardes.md` |
| Une fois par mois | Revue des accès : membres du personnel (**Équipe**), clés de service, clés SSH du serveur | `docs/runbooks/secrets-et-cles.md` |
| Une fois par mois | Mises à jour du serveur appliquées (automatiques) ; redémarrage si le noyau l'exige | `docs/runbooks/redemarrer-un-service.md`, section 8 |

## Ce que seul un humain valide

| Décision | Où |
|---|---|
| Activation d'un chauffeur, validation d'un document, statut d'un véhicule | Chauffeurs, Documents, Véhicules |
| Levée ou maintien d'un blocage préventif après un incident de sécurité | Incidents |
| Garantie modèle (remboursement intégral, faute du chauffeur) | Incidents, « Garantie modèle » |
| Remboursements et crédits au-delà du mode automatique des agents | Agents IA, file d'approbation ; ou fiche de course, **Rembourser** |
| Sanctions proposées par l'agent qualité, radiation | File d'approbation ; fiche du chauffeur |
| Ajustement d'un relevé | Relevés (finances ou administrateur) |
| Confirmation de la sauvegarde vérifiée | Conformité et conservation (administrateur) |
| Tout changement de tarif, de réglage ou de drapeau | Tarifs, Paramètres, serveur |
| Incident de confidentialité et avis à la CAI | `docs/runbooks/incident-confidentialite.md` |

## Temps estimé

| Période | Pendant la bêta | Au lancement (volume plus élevé) |
|---|---|---|
| Chaque jour | 50 à 60 minutes (matin et soir) plus les alertes | 1 h 30 à 2 h, dont une grande part de validations de documents et d'approbations ; à déléguer à un opérateur |
| Chaque semaine | 1 h 30 de plus | 2 h de plus |
| Chaque mois | 2 h | 3 h |

Estimations à corriger après deux semaines de bêta réelle.

## Registre d'exploitation

Chaque geste qui change l'état de la plateforme (redémarrage, drapeau, réglage, rotation de secret, restauration, déploiement, version mobile) est noté dans un registre simple : date et heure, geste, raison, résultat, qui. Le registre peut citer des numéros de course ou de chauffeur : il vit hors du dépôt (document privé de l'entreprise). Les actions faites dans My Hub sont déjà au journal d'audit ; le registre sert surtout aux gestes faits sur le serveur et chez les fournisseurs.
