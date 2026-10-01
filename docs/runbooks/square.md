# Square : encaisser en attendant Stripe (étape 26)

Manuel pour brancher, vérifier, basculer et dépanner l'encaissement par Square. Aucun secret ici : les valeurs vont dans `/opt/neomoov/.env` (serveur) et dans `C:\Users\PC\code\neomoov\.env` (poste), jamais dans le dépôt ni dans une conversation. Fonctionnement détaillé : `docs/paiements.md`, section « Square en attendant Stripe ».

## 1. Clés à fournir (tableau de bord des développeurs Square)

Sur developer.squareup.com, « Applications », l'application Neomoov (compte Square canadien, encaissement en CAD) :

| Valeur | Où la trouver | Variable | Forme attendue |
|---|---|---|---|
| Jeton d'accès de production | Application, « Credentials », onglet Production, « Production Access token » | `SQUARE_ACCESS_TOKEN` | `EAAA…` |
| Identifiant d'application de production | Même page, « Production Application ID » | `SQUARE_APPLICATION_ID` | `sq0idp-…` |
| Emplacement qui encaisse | « Locations », onglet Production (ou Square Dashboard, Comptes et paramètres, Emplacements) | `SQUARE_LOCATION_ID` | majuscules et chiffres, souvent `L…` |
| Jeton d'accès du bac à sable | « Credentials », onglet Sandbox, « Sandbox Access token » (et non l'identifiant d'application) | `SQUARE_SANDBOX_ACCESS_TOKEN` | `EAAA…` |
| Identifiant d'application du bac à sable | Même page, « Sandbox Application ID » | `SQUARE_SANDBOX_APPLICATION_ID` | `sandbox-sq0idb-…` |
| Emplacement du bac à sable | « Locations », onglet Sandbox | `SQUARE_SANDBOX_LOCATION_ID` | majuscules et chiffres |
| Clé de signature du webhook | « Webhooks », « Subscriptions », l'abonnement créé à la section 2, « Signature key » | `SQUARE_WEBHOOK_SIGNATURE_KEY` | texte |
| Adresse du webhook | Celle saisie à la section 2, au caractère près | `SQUARE_WEBHOOK_URL` | `https://api.neomoov.net/v1/webhooks/square` |
| Environnement | | `SQUARE_ENVIRONMENT` | `production` sur le serveur ; vide ou `sandbox` sur le poste |

Contrôle sans afficher de valeur : `pnpm env:check` (section « Paiements (Square) ») dit si chaque variable est renseignée et signale une valeur qui n'a pas la forme attendue (par exemple l'identifiant d'application du bac à sable collé à la place de son jeton d'accès).

## 2. Déclarer le webhook chez Square

1. Application Neomoov, « Webhooks », « Subscriptions », onglet Production, « Add subscription ».
2. Nom : `Neomoov API`. Adresse : `https://api.neomoov.net/v1/webhooks/square`. Version d'API : la plus récente proposée.
3. Événements : `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `card.disabled`, `card.forgotten`, `dispute.created`.
4. Enregistrer, ouvrir l'abonnement, copier la « Signature key » dans `SQUARE_WEBHOOK_SIGNATURE_KEY` et l'adresse exacte dans `SQUARE_WEBHOOK_URL`.
5. Redémarrer l'API (`redemarrer-un-service.md`), puis « Send test event » : la réponse doit être `200` (un événement de test inconnu est enregistré puis ignoré). Un `400 WEBHOOK_SIGNATURE_INVALID` veut dire que la clé ou l'adresse diffère d'un caractère (barre finale, `http` au lieu de `https`, autre domaine) : la signature de Square couvre l'adresse.

Pour le bac à sable : même procédure dans l'onglet Sandbox, vers une adresse publique de développement si besoin.

## 3. Activer Square sur le serveur

1. Dans `/opt/neomoov/.env` : les variables de la section 1, puis `PAYMENT_PROVIDER=square` et `SQUARE_ENVIRONMENT=production`.
2. Retirer `payment` d'`ALLOW_MOCK_PROVIDERS` (le paiement n'est plus simulé ; laissé dans la liste, il est sans effet).
3. `CARD_PAYMENTS` vide : la carte est proposée (les applications ont l'écran « Moyens de paiement » et la page `/carte`). Le poser à `off` coupe le prépaiement par carte sans toucher au reste.
4. Redémarrer l'API et le worker. L'API refuse de démarrer, avec un message qui nomme les variables, s'il manque le jeton, l'identifiant d'application, l'emplacement, la clé de signature ou l'adresse du webhook.
5. Vérifier : un compte de test ajoute une carte dans l'application (Profil, Moyens de paiement), la carte apparaît avec sa marque et ses 4 derniers chiffres ; une course prépayée crée une empreinte visible dans Square Dashboard, Transactions (statut autorisé), capturée à la fin de la course.

Le serveur web n'a besoin d'aucune clé Square : la page `/carte` reçoit l'identifiant d'application et l'emplacement (valeurs publiques) de l'API.

## 4. Versements aux chauffeurs (hors plateforme)

Square n'a pas d'équivalent de Stripe Connect. Chaque semaine, après l'émission des relevés :

1. My Hub, Relevés, carte « Versements à faire hors plateforme » : liste des relevés positifs non réglés ; « Exporter les virements (CSV) » donne chauffeur, courriel Interac, montant en cents, référence et relevé.
2. Faire chaque virement (banque ou Interac) avec la référence `NM-AAAAMMJJ-<numéro du chauffeur>` en libellé.
3. Ouvrir le relevé, « Réglé hors plateforme », moyen (virement bancaire ou Interac) et la même référence : le relevé passe à « versé », le chauffeur est prévenu, il sort de la liste.

Les relevés négatifs restent prélevés sur la carte de prélèvement du chauffeur (enregistrée par la page de saisie, écran « Compte de versement » de l'application chauffeur), sinon réglés hors plateforme comme avant.

## 5. Revenir à Stripe

1. Poser les clés Stripe (`docs/paiements.md`, « Passer au vrai Stripe »), puis `PAYMENT_PROVIDER=stripe`, redémarrer.
2. Les cartes enregistrées chez Square ne sont plus proposées (chaque carte porte son fournisseur) : les clients ajoutent une carte chez Stripe. Le client Square de chaque utilisateur est remplacé par un client Stripe au premier besoin.
3. Un paiement encaissé par Square se rembourse dans Square Dashboard, ou en crédit sur le compte du client dans My Hub (l'API refuse un remboursement par carte avec `PAYMENT_PROVIDER_MISMATCH`).
4. Les relevés encore « à verser hors plateforme » restent dans la liste ; les suivants partent par Connect pour les chauffeurs inscrits.
5. Garder l'abonnement webhook Square actif quelques semaines (remboursements et litiges tardifs), puis le supprimer. Pendant ce temps, `/v1/webhooks/square` répond 404 quand Stripe est actif : les événements tardifs se consultent dans Square Dashboard.

## 6. Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| L'API ne démarre pas : « PAYMENT_PROVIDER=square … exige … » | Variable manquante pour l'environnement Square effectif | Compléter `.env` (section 1) |
| La page `/carte` affiche « Le formulaire de carte n'a pas pu se charger » | Identifiant d'application ou emplacement d'un autre environnement, ou contenu bloqué | Vérifier que `SQUARE_ENVIRONMENT` correspond aux identifiants ; console du navigateur (politique de sécurité du contenu) |
| « Cette page de saisie a expiré » | Session de 15 minutes dépassée | Relancer l'ajout de carte depuis l'application |
| Carte refusée à l'enregistrement | Refus de la banque ou vérification 3-D Secure non terminée | Autre carte ; le code de Square est dans le journal de l'API |
| Webhooks en `400` | Clé de signature ou adresse différente de celle déclarée | Section 2, étape 5 |
| Webhooks en `404` | Stripe est le fournisseur actif | Normal après la bascule (section 5) |
| Capture en échec, solde dû ouvert | Empreinte expirée (plus de 7 jours) ou annulée chez Square | Même traitement qu'avec Stripe : incident, solde dû, règlement par le client |

## 7. Rotation des secrets

- `SQUARE_ACCESS_TOKEN` : « Credentials », remplacer le jeton d'accès de production. Préparer la commande avant : dès que l'ancien jeton cesse de fonctionner, poser le nouveau dans `.env` et redémarrer l'API et le worker (quelques paiements peuvent échouer pendant la minute du changement ; le faire la nuit).
- `SQUARE_WEBHOOK_SIGNATURE_KEY` : abonnement du webhook, régénérer la clé de signature ; poser la nouvelle clé et redémarrer aussitôt (une notification refusée entre les deux est renvoyée par Square).

## 8. Essais contre le bac à sable

`RUN_SQUARE_TESTS=1` avec un vrai jeton d'accès du bac à sable dans `SQUARE_SANDBOX_ACCESS_TOKEN` :

```
RUN_SQUARE_TESTS=1 node C:/Users/PC/code/neomoov-outils/with-env.cjs C:/Users/PC/code/neomoov/apps/api pnpm exec vitest run test/square.live.test.ts
```

Sans la variable ou sans jeton de la forme `EAAA…`, le test est ignoré. Le test n'utilise jamais le jeton de production. Il crée un client et une carte de test (`cnon:card-nonce-ok`), une empreinte, une capture plafonnée, un pourboire, un remboursement partiel, une annulation, puis retire la carte.
