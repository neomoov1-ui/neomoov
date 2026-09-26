# Procédure de la bêta fermée

Étape 16 (prompt 16, tâches 6 et 8). Préparer, inviter, collecter les retours, trier, publier les corrections. Aucune donnée personnelle dans ce document : les testeurs sont désignés par leur code (`C01` à `C30`, `D01` à `D10`), la correspondance avec les noms vit hors du dépôt.

## 1. Préparer (avant toute invitation)

| # | Condition | Où la vérifier |
|---|---|---|
| 1 | API en ligne et saine : `curl -s https://api.neomoov.net/v1/health` renvoie `"status":"ok"` | `docs/runbooks/redemarrer-un-service.md` |
| 2 | My Hub accessible avec second facteur pour le fondateur et au moins un opérateur | `docs/runbooks/personnel-my-hub.md` |
| 3 | Sauvegarde quotidienne en place et vérifiée | `docs/runbooks/sauvegardes.md` |
| 4 | Fournisseurs réels branchés pour ce que la bêta utilise : textos (Twilio), courriels (Resend), notifications push (Expo), cartes (Google), stockage des documents (Supabase Storage), antivirus | `docs/operations/acces-a-fournir.md` |
| 5 | Coordonnées d'assistance visibles dans les applications : réglages `support.phone` et `support.email`. Ils ne sont pas créés par les données de départ et My Hub ne modifie qu'un réglage existant : les créer une fois dans Supabase, « SQL Editor » (valeurs de l'entreprise, pas celles d'une personne), puis les modifier ensuite dans My Hub | Requête ci-dessous |
| 6 | Numéro de transfert de l'agent vocal (`voice.transfer_number`) et numéro d'alerte SOS (`alerts.founder_phone`) remplacés dans My Hub, Paramètres | `docs/runbooks/drapeaux-et-reglages.md` |
| 7 | Politique de confidentialité et conditions d'utilisation publiées sur neomoov.net et à jour (version `legal.*` des réglages) | neomoov.net |
| 8 | Builds `production` des deux applications disponibles dans TestFlight et en test interne Google Play | `docs/runbooks/publication-mobile.md` |
| 9 | Comptes de test créés | `comptes-de-test.md` |
| 10 | Point juridique sur les courses rémunérées réglé | `README.md` de ce dossier |
| 11 | Paiement : pendant la bêta, **paiement au chauffeur** (espèces ou terminal) seulement. Le prépaiement par carte dans l'application n'est pas encore branché (feuille de paiement Stripe à ajouter) et Stripe est en mode test | Consigne aux testeurs (section 3) |

Création des réglages d'assistance (à adapter, une seule fois) :

```
INSERT INTO settings (key, scope, value, description) VALUES
  ('support.phone', 'global', '"+1XXXXXXXXXX"'::jsonb, 'Téléphone de l''assistance affiché dans les applications'),
  ('support.email', 'global', '"assistance@neomoov.net"'::jsonb, 'Courriel de l''assistance affiché dans les applications')
ON CONFLICT DO NOTHING;
```

## 2. Vagues d'invitation (proposition)

| Vague | Qui | Durée | Objectif |
|---|---|---|---|
| 0 | Fondateur (chauffeur et client), un opérateur | 2 à 3 jours | Courses réelles de bout en bout, journée d'exploitation dans My Hub |
| 1 | 3 chauffeurs (`D01` à `D03`) et 5 clients de confiance (`C01` à `C05`) | Une semaine | Premiers retours, stabilité, relevé du premier vendredi |
| 2 | Tous : 10 chauffeurs, 30 clients | Deux semaines au moins | Volume, critères de sortie (`README.md`) |

Passer à la vague suivante seulement si aucun retour « Bloquant » n'est ouvert.

## 3. Inviter

### Chauffeurs

1. Le chauffeur reçoit l'invitation de la plateforme de son téléphone (ci-dessous), installe « Neomoov Chauffeur », crée son compte par code SMS, remplit son dossier : profil, véhicule, documents, formation Neomoov.
2. Le fondateur vérifie le dossier dans My Hub : **Documents** (valider ou refuser chaque pièce, l'agent recrutement propose une décision dans la file d'approbation), **Véhicules** (statut), puis **Chauffeurs**, fiche, **Activer**.
3. Le chauffeur passe en ligne ; l'application explique ce qui manque s'il ne le peut pas.

### Clients

Installation de « Neomoov », compte par code SMS, consentements, première réservation (préavis de 2 heures) avec le choix « payer le chauffeur après ».

### iPhone : TestFlight

App Store Connect, l'application, **TestFlight** :

1. « Testeurs externes », créer deux groupes : `Beta chauffeurs` (application chauffeur) et `Beta clients` (application client).
2. Ajouter le build au groupe (le premier build de chaque version passe la revue bêta d'Apple).
3. Ajouter les testeurs par courriel, ou activer un lien public limité au nombre de places voulu.
4. Renseigner « Informations sur le test » : description de ce qu'il faut tester, courriel de retour (`beta@neomoov.net`, à créer), lien de la politique de confidentialité, compte de démonstration pour la revue (`comptes-de-test.md`).

Le testeur installe l'application TestFlight, accepte l'invitation, puis installe Neomoov.

### Android : test interne Google Play

Play Console, l'application, **Tests**, **Test interne** :

1. « Testeurs », créer une liste de diffusion (adresses des comptes Google des testeurs, 100 au plus).
2. Publier le build sur la piste interne (automatique avec `eas submit`, piste `internal`).
3. Copier le lien de participation et l'envoyer.

Le testeur ouvre le lien avec le compte Google de son téléphone, accepte, puis installe depuis le Play Store.

### Message d'invitation (modèle)

> Bonjour, merci de tester Neomoov en avant-première. Installez l'application depuis le lien ci-dessous (TestFlight sur iPhone, Google Play sur Android). Pendant la bêta, les courses se réservent au moins 2 heures à l'avance et se paient au chauffeur. Pour tout problème ou toute idée : écrivez à beta@neomoov.net, avec une capture d'écran si possible. Vos données sont traitées selon notre politique de confidentialité (neomoov.net/politique-de-confidentialite). Vous pouvez quitter la bêta et supprimer votre compte à tout moment depuis le profil de l'application.

> Hello, thank you for trying Neomoov early. Install the app from the link below (TestFlight on iPhone, Google Play on Android). During the beta, rides must be booked at least 2 hours ahead and are paid to the driver. For any issue or idea, write to beta@neomoov.net, with a screenshot if possible. Your data is handled under our privacy policy (neomoov.net/politique-de-confidentialite). You can leave the beta and delete your account at any time from the app profile.

## 4. Collecter les retours

| Canal | Pour qui | Où le lire |
|---|---|---|
| « Envoyer un commentaire bêta » de TestFlight (capture d'écran annotée) | Testeurs iPhone | App Store Connect, TestFlight, Commentaires |
| Courriel `beta@neomoov.net` (redirection vers la boîte de Neomoov, à créer dans le panel LWS) | Tous, et seul canal écrit pour Android | Boîte de réception |
| Appel de 15 minutes chaque semaine avec les chauffeurs | Chauffeurs | Notes du fondateur, reportées au tableau |
| Incidents de course (SOS, plainte, objet perdu) | Tous | My Hub, **Incidents** : ils ne passent pas par le tableau de bêta |
| Plantages | Automatique | App Store Connect (TestFlight, Plantages), Play Console (Android vitals) |

Manque connu : le formulaire de retour intégré à l'écran Assistance des applications, prévu par le prompt 16, n'existe pas ; l'écran affiche seulement le téléphone et le courriel de l'assistance, et la conversation avec l'assistance (API `POST /v1/me/support/messages`) n'est pas encore reliée aux écrans.

Chaque retour est reporté dans `suivi-des-retours.md` le jour même, sans nom ni coordonnée : le code du testeur suffit.

## 5. Trier

| Gravité | Définition | Délai de décision | Suite habituelle |
|---|---|---|---|
| Bloquant | Sécurité des personnes, donnée personnelle exposée, montant faux, course impossible, application qui plante au démarrage | Le jour même | Correction immédiate ; suspension de la vague si nécessaire ; donnée exposée : `docs/runbooks/incident-confidentialite.md` |
| Majeur | Parcours gêné, un contournement existe | Dans la semaine | Version suivante |
| Mineur | Texte, affichage, confort | Revue suivante | Quand un build part de toute façon |
| Suggestion | Idée, demande de fonction | Revue suivante | Décision : V1.1, plus tard ou non retenue, avec la raison |

Statuts : `nouveau`, `qualifié` (reproduit ou compris), `en cours`, `corrigé` (avec la version), `vérifié` (le testeur confirme), `reporté`, `rejeté` (avec la raison), `doublon` (avec le numéro d'origine).

Règles : un retour qui touche un montant, une facture ou un relevé est toujours au moins « Majeur » ; un retour qui touche les règles métier (tarifs, préavis, frais) ne se corrige pas dans le code : il se décide, puis se règle dans My Hub (**Tarifs**, **Paramètres**).

## 6. Fréquence

| Quand | Quoi | Durée |
|---|---|---|
| Chaque jour | Lire les nouveaux retours, qualifier les « Bloquants » tout de suite (dans la routine de `docs/operations/daily.md`) | 10 minutes |
| Mardi et vendredi | Revue de tri avec Claude : gravité, statut, décision de chaque retour ouvert | 30 minutes |
| Chaque semaine (proposition : mercredi) | Build correctif si des corrections sont prêtes, notes de version aux testeurs | 1 heure |
| Chaque vendredi | Bilan : retours ouverts par gravité, testeurs actifs, plantages, courses faites ; relevés de la semaine contrôlés | 20 minutes |
| Fin de bêta | Critères de sortie (`README.md`) | |

## 7. Fin de la bêta

Informer les testeurs, garder ou non leurs comptes selon leur choix (suppression dans le profil de l'application), archiver le tableau de suivi, et noter dans `docs/decisions.md` la date et le bilan de sortie.
