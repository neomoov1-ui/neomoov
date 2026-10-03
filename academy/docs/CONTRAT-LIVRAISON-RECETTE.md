# Contrat durable et confirmation d’accès — Square API

État après déploiement et recette du **29 septembre 2026** : la vérification Square Sandbox et la revue de facturation fictive ont abouti à `sandbox_paid`, sans document de production ni email. L’aperçu fictif du contrat a été généré via le POST administrateur : **11 sections, identifiants du vendeur et montants fiscaux corrects, aucune erreur PHP**. Ces observations ont été rapportées par l’agent principal qui a réalisé la recette.

Les ventes ont été **refermées en fin de recette (`sales=false`)**. L’accord demandé au propriétaire pour les clés de production et pour un test email au seul administrateur est encore en attente à cet état de référence. Aucun email de test, paiement de production, remboursement ou contrat réel remis après achat n’est déclaré testé.

## Périmètre et comportement

Les assembleurs incluent `contract-delivery.php` avant `square-checkout-api.php`. Le module concerne uniquement les nouvelles commandes Square API. Les paiements Square Dashboard/facture avec attribution manuelle et les paiements Stripe ne déclenchent pas ces nouveaux emails : remettre leur contrat et leur confirmation manuellement.

Avant toute création d’un nouveau lien API, le système :

- lit exclusivement la page WordPress publiée **1909** avec `get_post`, sans requête vers une URL arbitraire et sans exécuter ses shortcodes ;
- vérifie que son URL canonique correspond aux CGV configurées, assainit et borne son contenu, puis calcule une empreinte SHA-256 ;
- vérifie que l’empreinte acceptée dans le formulaire correspond encore à la page ; une modification intervenue entre affichage et validation bloque la création ;
- fige la copie des CGV, sa version, la date d’acceptation, l’identité du vendeur et les coordonnées déclarées de l’acheteur dans la commande avant l’appel Square.

Le formulaire demande le nom complet, l’adresse, la ville et le code postal ; le courriel retenu est celui du compte WordPress, affiché avant paiement. Cette déclaration ne remplace pas la vérification de facturation Square. Modifier une commande déjà créée nécessite une intervention du support ; le système ne remplace pas silencieusement sa version des CGV ou son identité. Une ancienne commande sans snapshot doit être examinée manuellement, sans fabriquer une acceptation passée.

En production, le comportement implémenté prévoit, après vérification serveur d’un paiement **COMPLETED**, de sa commande et du total **113,83 CAD** (99,00 + TPS 4,95 + TVQ 9,88), la préparation de la copie personnelle du contrat. Elle contient la référence/date de commande, le paiement, le vendeur, l’acheteur, les montants, le contenu acheté et toutes les conditions figées. Les seuls champs d’adresse utiles retournés par Square sont conservés séparément ; aucune donnée de carte ou clé API n’est enregistrée dans le contrat. Cette chaîne de production n’a pas encore été validée de bout en bout.

Une revue de facturation ne retarde pas la préparation du contrat : un email distinct avertit **contact@neomoov.net** de l’intervention nécessaire. Le délai contractuel de **24 heures après confirmation du paiement** continue à courir pendant cette revue. Le module ne résout pas lui-même les adresses incompatibles et ne prolonge pas ce délai.

L’email d’activation est préparé seulement après l’attribution effective de l’accès. Il donne les dates de début et fin en heure de Montréal et la durée de douze mois calendaires. Une confirmation encore en attente d’envoi est annulée si l’accès a entre-temps été remboursé, retiré ou expiré. Le contrat historique reste conservé.

## Identité du vendeur

GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC., marque Neomoov / Neomoov Academy. NEQ : **1181499600**. Adresse : **204 rue du Saint-Sacrement, bureau 300, Montréal (Québec) H2Y 1W8, Canada**. Courriel : **contact@neomoov.net**. Téléphone : **+1 438 900 4990**.

TPS/TVH : **755212438 RT0001**. TVQ : **1233281863 TQ0001**. Ces numéros fiscaux ont été fournis par le propriétaire ; cette sous-tâche ne les a pas vérifiés auprès de Revenu Québec. Ils sont les valeurs par défaut du module ; les options privées `seller_gst` et `seller_qst`, si renseignées ultérieurement, les remplacent pour les nouvelles commandes. Les commandes existantes conservent leur identité figée.

## Emails et copie téléchargeable

Le traitement commence à la fin de la requête WordPress, après libération du verrou d’accès. Une reprise WP-Cron est prévue. Chaque email possède une file persistante, un compteur de tentatives et un état ; les échecs de transport sont réessayés. Les pannes de stockage sont signalées dans le dossier membre administrateur et une reprise est prévue.

**`wp_mail` accepté ne signifie pas email reçu.** Le statut « accepté par le transport — réception non confirmée » ne prouve ni la livraison ni l’arrivée en boîte principale. Le transport WordPress doit être configuré et sa délivrabilité vérifiée. Une connexion Brevo seule ne valide pas ce test et ne crée pas de preuve de réception.

Le module ne fait aucun envoi pour une commande Sandbox et ne crée pas ses documents de production. Un test Square Sandbox ne permet donc pas à lui seul de valider les emails de production.

Cette séparation a été observée après passage en `sandbox_paid` puis réconciliation répétée : documents et files « Contrat », « Activation » et « Alerte de revue » **absents, zéro tentative**. L’aperçu fictif séparé a validé le rendu PHP des CGV assainies et des données d’exemple ; il n’a pas créé une copie contractuelle dans le dossier de ce membre.

La copie HTML figée et imprimable du contrat, puis la confirmation d’activation, sont disponibles dans l’espace membre. Leur téléchargement impose une session du propriétaire ou d’un administrateur et un nonce. L’accès à ces pièces n’exige pas un accès formation encore actif. Aucune URL publique ne permet de télécharger le contrat d’un autre membre.

## Contrôles avant ouverture

### Outils administrateur distincts

La page **Outils → Neomoov Academy** présente désormais la section **Outils de recette — administrateur uniquement**, sans nécessiter de choisir un membre.

**Aperçu fictif du contrat.** Le bouton « Ouvrir l’aperçu TEST du contrat — aucun achat ni envoi » utilise une requête POST, une capacité `manage_options` et un nonce. Il affiche dans un nouvel onglet le HTML produit par le vrai générateur avec les CGV actuelles de la page locale 1909. Le grand bandeau **TEST — AUCUN ACHAT — NI FACTURE** signale des coordonnées inventées (`example.invalid`), des références `TEST-APERÇU` et l’absence de transaction. L’environnement de cette fixture est `sandbox`. Aucun appel Square, email, écriture de membre, document persistant, file Cron ou accès n’est créé ; la commande Sandbox existante reste intacte. Les en-têtes interdisent script, formulaire et ressources externes. Cet aperçu permet de vérifier le rendu PHP et l’assainissement des CGV ; il ne valide pas la file email ni une transaction réelle.

**Email technique séparé.** Le bouton « Envoyer l’email TEST à mon compte » exige une requête POST, `manage_options`, un nonce et une case de confirmation dédiée. Le destinataire est exclusivement le courriel de l’administrateur actuellement connecté ; aucun destinataire modifiable ou fourni dans POST n’est accepté. Objet : **[TEST SANS ACHAT] Neomoov Academy**. Corps public en texte simple, sans contrat, facture, reçu ni données de commande ; Reply-To : `contact@neomoov.net`. Aucun compte, paiement ou accès n’est modifié. Ce test est indépendant de Square et de la file des contrats, donc peut être proposé même lorsque Square reste en Sandbox.

Ne déclencher cet envoi réel qu’après l’accord explicite du propriétaire. **L’accord est demandé et encore en attente ; le bouton n’a pas été exécuté à cet état de référence.** La préparation et la revue de ce bouton n’ont déclenché aucun email. Une tentative est limitée par un transient de 60 secondes, avec un résultat réservé à l’administrateur pendant cinq minutes ; ce mécanisme n’est pas un verrou atomique contre deux requêtes administrateur strictement simultanées. Le résultat distingue refus/échec et **acceptation par le transport, réception non prouvée**. Une exception n’en expose aucun détail. Vérifier ensuite effectivement la boîte de réception et les indésirables, puis consigner séparément la réception.

### Parcours de recette

Les observations réalisées sont indiquées au début et en fin de ce document. Les étapes ci-dessous restent le plan complet : ne pas assimiler l’aperçu ou la réussite Sandbox à la validation des emails, remboursements et contrats de production.

1. Avec les ventes fermées et les clés absentes : accueil et pages Academy sans erreur PHP ; aucune possibilité publique de créer un paiement ; gestion des réglages et écran administrateur fonctionnels.
2. En Sandbox, uniquement pour la recette administrateur : total 113,83 CAD, quantité 1, lignes fiscales correctes ; changement de CGV ou identité invalide bloqué avant CreatePaymentLink ; aucun accès réel ni email.
3. Contrôler la persistance du snapshot et son SHA avant création du lien. Simuler une reprise de création : même clé d’idempotence, même commande et même copie acceptée ; ne pas créer un second paiement.
4. En environnement de test WordPress avec données fictives et transport intercepté : paiement vérifié → copie contractuelle ; `billing_review` → copie acheteur + alerte administrateur, sans activation ; attribution effective → confirmation datée. Une simple redirection de retour ne doit rien accorder.
5. Intercepter `wp_mail` pour simuler succès, échec et exception : succès marqué uniquement « accepté » ; échec mis en relance ; aucune attribution d’accès par l’email ; répétition de la réconciliation sans réécriture du contrat ni nouvel envoi déjà accepté.
6. Vérifier que le propriétaire peut télécharger sa copie, qu’un autre membre et une session anonyme ne le peuvent pas, et qu’un administrateur peut consulter le dossier. Modifier la page CGV après une commande : sa copie ancienne doit rester inchangée.
7. Tester une annulation/remboursement avant l’envoi différé de l’activation : ne pas annoncer un accès qui n’est plus actif. Contrôler aussi les reprises Cron lorsque les ventes sont fermées.
8. Avant vente réelle, contrôler le transport avec un destinataire de test autorisé et constater effectivement la réception. Garder la surveillance humaine du délai de 24 h et du support. Ne pas utiliser de paiement réel pour tester sans autorisation distincte.

## Procédure quotidienne et limites

Dans le dossier membre Square API, consulter « Contrat et emails transactionnels », le journal et les éventuels avertissements. Le bouton « Préparer / réessayer les envois non acceptés » relance uniquement ce qui n’est pas déjà accepté par le transport ; il ne vérifie pas un paiement à lui seul. Le bouton de réconciliation Square effectue cette vérification.

Pour une revue de facturation ou un échec de réception, intervenir assez tôt pour respecter les 24 h. Contrôler le paiement et l’identité, télécharger la copie figée puis la transmettre au bon destinataire par le canal transactionnel autorisé si nécessaire ; noter l’envoi et les échanges. Ne pas remplacer le document accepté par un simple lien vers les CGV actuelles. La copie du contrat et le reçu Square peuvent être distincts.

Les relances automatiques dépendent du fonctionnement de WP-Cron ; une absence de trafic, une panne de WordPress ou une panne de messagerie empêche de garantir seule le délai. Une panne après acceptation SMTP mais avant enregistrement de son résultat peut produire un doublon lors d’une reprise. L’état « résultat inconnu » exige un contrôle humain. Aucun de ces états email n’accorde ni ne retire un accès.

Les remboursements financiers et le support restent soumis à leur procédure opérationnelle. Une commande entièrement remboursée avant sa première réconciliation, sans confirmation déjà enregistrée, ou une ancienne commande sans snapshot nécessite un contrôle manuel des pièces : ne pas inventer une copie acceptée rétroactivement.

## Vérifications réalisées et réserves

Analyse syntaxique des trois sources PHP réussie avec `php-parser`, puis analyse de leur concaténation en mémoire. Aucun doublon de fonction ; tous les appels `nmcd_*` présents dans ces sources ont une définition. Revue indépendante des gardes Sandbox, de l’immuabilité, de la propriété des téléchargements et des reprises d’envoi effectuée. Les deux outils de recette ont aussi été relus : protections POST/capacité/nonce, fixture sans écriture et destinataire du test fixé au seul administrateur. La matrice de 26 cas de reconnaissance de source Square reste réussie après ces ajouts.

Après déploiement, l’agent principal a observé `pending` → `billing_review`, puis l’attestation fictive CA/QC journalisée et `sandbox_paid`. Une nouvelle réconciliation a conservé commande et paiement, sans email ni document de production. L’aperçu administrateur a généré le modèle fictif de 11 sections, sans erreur PHP et avec les bons identifiants/taxes. Les ventes ont été refermées.

Restent à vérifier : transport et réception du test email (accord en attente), production et accès réel, remise/persistance d’un contrat individuel après achat, contrôles de téléchargement entre comptes, reprises effectives WP-Cron, cas de panne et remboursements. L’absence d’envoi en Sandbox et le bon rendu de l’aperçu ne prouvent pas le parcours contractuel de production. Cette mise à jour documentaire ne modifie ni code, ni export, ni configuration du site.
