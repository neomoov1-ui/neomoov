# Brevo — état actualisé le 30 septembre 2026

La connexion privée entre WordPress et Brevo est enregistrée et la synchronisation est activée. Les quatre listes ont été retrouvées par un contrôle API en lecture seule depuis WordPress. Aucun contact de test ni campagne n’a été envoyé par cette vérification.

| Orientation | Liste réelle | ID Brevo |
|---|---|---|
| rentabilite | CAP CHAUFFEUR — Rentabilité | 3 |
| service | CAP CHAUFFEUR — Qualité de service | 4 |
| demarrer | CAP CHAUFFEUR — Démarrer | 5 |
| entreprise | CAP CHAUFFEUR — Entreprise | 6 |

**Migration Brevo confirmée : 28 / 28 modèles inactifs utilisent Neomoov Academy <contact@neomoov.net>, avec réponse à contact@neomoov.net.** Le nouvel export est déployé dans l’extrait WordPress 6 actif. La migration n’a déclenché aucun envoi. Preuve : [28 modèles professionnels](<C:/Users/PC/OneDrive/Documents/ChatGPT/Neomoov Academy/livraison/brevo-28-modeles-professionnels.png>).

Le domaine neomoov.net est authentifié après les trois ajouts DNS autorisés ; contact@neomoov.net est vérifié. Preuve : `../brevo-expediteur-professionnel-verifie.png`.

**Les quatre scénarios sont entièrement configurés et restent INACTIFS : Rentabilité #1 / liste 3 / R01–R07 ; Qualité de service #3 / liste 4 / S01–S07 ; Démarrer #4 / liste 5 / D01–D07 ; Entreprise #2 / liste 6 / E01–E07.** Les 28 actions ont été enregistrées avec l’expéditeur professionnel ; les anciens expéditeurs Gmail de E01–E05 ont été corrigés. Délais : 1, 2, 2, 3, 3, 4 jours. Réentrée désactivée sur les quatre scénarios ; sorties enregistrées sur désinscription de tous les emails et retrait immédiat de la liste propre au scénario. Cette configuration vérifiée dans l’interface ne constitue pas une recette d’envoi.

## Fonctionnement publié

- Une adresse est synchronisée seulement après consentement marketing explicite et première connexion authentifiée au compte WordPress. La seule création d’un compte ne suffit pas.
- Une seule des quatre listes correspond au parcours choisi. Les autres listes du compte Brevo sont préservées.
- Le retrait du consentement retire des listes Academy. Un désabonnement déjà enregistré dans Brevo n’est jamais annulé automatiquement.
- Un paiement réel confirmé exclut des relances, même si la vérification de facturation reste en cours. Un paiement Sandbox ne constitue pas un achat réel. Un remboursement ne réinscrit pas aux relances.
- Les tâches sont mises en file WordPress avec reprises limitées. Leur exécution dépend du cron WordPress ; aucune heure exacte de synchronisation n’est garantie.
- Les emails de compte, paiement et contrat WordPress restent distincts du marketing Brevo.

## Contrôles réalisés

- Compte et téléphone Brevo vérifiés ; offre gratuite affichée à 300 emails/jour.
- Clé privée enregistrée sur WordPress avec autorisation explicite, sans copie dans les livrables. Expiration configurée le 29 septembre 2027 ; Brevo peut aussi expirer une clé après 90 jours sans utilisation.
- Lecture API des quatre listes réussie depuis WordPress, noms et IDs concordants.
- Import confirmé à 28 / 28 modèles. Import par lots, protection contre doublons et écrasements, état inactif imposé. Aucun destinataire ni appel d’envoi dans cet importeur.
- 73 contrôles locaux réussis sous PHP 8.4 WASM avec interfaces WordPress/HTTP simulées, dont 29 cas de migration : expéditeur actif, inventaire complet, noms/objets/états exacts, exclusion des IDs 29+, deux PUT maximum, idempotence, autorisations et verrou. Les 44 cas précédents couvrent synchronisation et import. Aucun appel Brevo réel dans ces tests ; ils ne remplacent pas un parcours réel.
- Assemblage PHP contrôlé syntaxiquement avant publication dans l’extrait WordPress 6 actif.

## Restant avant envois commerciaux

1. Configuration des 28 actions terminée et vérifiée dans l’interface. Garder les quatre scénarios inactifs pendant la recette : la configuration ne prouve pas la réception des emails ni les sorties en situation réelle.
2. Vérifier le parcours réel consentement → première connexion → bonne liste, retrait et exclusion après achat ; ce parcours client réel reste non testé.
3. Une demande de test Brevo unique a été effectuée après autorisation. Attendre la confirmation de réception avant de conclure sur la livraison et de vérifier le rendu ; aucun renvoi. Les liens et le désabonnement personnalisé restent à vérifier. L’email technique WordPress reçu est distinct.
4. Contrôler avant activation les règles d’arrêt, l’absence de réentrée, le fuseau America/Toronto et le quota partagé. Les scénarios sont complets dans l’interface, mais leur exécution réelle n’est pas validée et ils restent inactifs.
5. Côté vente, premier achat réel Square, notification de production associée, attribution réelle, remise du contrat et remboursement réel restent non testés.

## Inscription : limites d’un contrôle sans envoi

Un nouveau compte valide déclenche `wp_new_user_notification(..., 'user')` : une inscription complète sur le site ne peut donc pas être qualifiée de test sans email. Sans effet distant, on peut lire les formulaires et simuler les fonctions WordPress/HTTP localement ; cela ne valide pas la réception. Le compte administrateur UID 1 ne remplace pas un client : il accède à un aperçu de formation et conserve son dossier Square Sandbox, incompatible avec une nouvelle commande de production sur ce même dossier. Pour une future recette réelle, utiliser un compte ordinaire neuf et une adresse contrôlée, en tenant compte de l’email WordPress et de la synchronisation Brevo après consentement et première connexion. Aucun de ces essais réels n’a été ajouté dans cette mise à jour.


Preuve de l’import et de la connexion : `../brevo-wordpress-28-modeles.png`. Aucun envoi marketing n’est déclaré opérationnel à cette étape.


## Point de passage — scénarios prêts, envois non activés

Preuves des configurations : `livraison/brevo-rentabilite-7-etapes.png`, `livraison/brevo-service-7-etapes.png`, `livraison/brevo-demarrer-7-etapes.png`, `livraison/brevo-entreprise-7-etapes.png` et `livraison/brevo-entreprise-conditions.png` (chemins depuis la racine du dossier livré).

**Prochaines vérifications :** autorisation reçue et demande de test Brevo unique effectuée ; livraison et réception non confirmées, aucun renvoi, aucune campagne commerciale ni ajout de contact. Parcours complet d’inscription client, premier paiement réel Square, remise du contrat client et remboursement réel toujours non vérifiés. Les URL des comptes sociaux n’ont pas été fournies ; aucune publication sociale effectuée.


## Dernière recette publique et mobile

**Dernier contrôle public, après déploiement : 30 septembre 2026 à 01:12:14 UTC.** Les douze routes contrôlées répondent en HTTP 200, sans erreur PHP visible ni ancien lien Square. Les cinq pages d’offre affichent le total cohérent de 113,83 $ CA ; membre et formation demandent toujours une connexion au visiteur anonyme. Contrôle en lecture seule : aucune inscription ni aucun paiement soumis. Le contrôle précédent des cinq offres à 21:19 UTC le 29 septembre était également sans régression.

**Accueil à 390 pixels CSS : structure contrôlée sans débordement.** Le contrôle DOM communiqué par le responsable de l’intégration mesure une largeur et une largeur défilable de 390 pixels CSS, sans débordement des en-têtes, titres, paragraphes, boutons/CTA et champs inspectés. L’image principale débute à 875 px, sous le CTA (bas à 737 px) et le texte (bas à 825 px) : aucun chevauchement mesuré. La découpe initiale provenait du zoom de l’outil ; une largeur demandée de 335 pixels physiques a produit les 390 pixels CSS mesurés. Captures : `livraison/academy-mobile-layout-controle.png` et `livraison/academy-mobile-390.png` (chemins depuis la racine). La capture recadrée conserve un artefact de zoom : aucune validation visuelle de toutes les routes mobiles n’est revendiquée. Une revue sur de vrais téléphones reste conseillée.

Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée.


## Test Brevo unique autorisé — résultat non confirmé

Après autorisation explicite, le bouton « Envoyer le test » a été cliqué une seule fois pour R01, message d’automatisation 29, de contact@neomoov.net vers le seul destinataire neomoov1@gmail.com. Le bouton s’est désactivé pendant le traitement puis est redevenu disponible. Aucun succès ni erreur explicite n’a été capturé ; les zones d’alerte et de statut étaient vides. La page Transactionnel / Logs affichait zéro journal pour le 23–30 septembre, mais elle peut ne pas couvrir ce test marketing : cela ne prouve pas un échec. La réception a été demandée à l’utilisateur et reste non confirmée. Aucun renvoi effectué. La capture `livraison/brevo-test-r01-envoi.png` montre seulement l’interface après la demande, pas une confirmation de livraison. Les quatre scénarios restent inactifs ; aucune campagne commerciale ni ajout de contact n’a été effectué.
