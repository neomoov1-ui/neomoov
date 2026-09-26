# Accès à fournir pour la mise en ligne

Étape 16. Liste exacte, par service, de ce que le fondateur doit ouvrir, créer ou fournir pour mettre la V1 en ligne (bêta puis lancement). Construite à partir de `.env.example`, du schéma de configuration de l'API (`apps/api/src/config/env.ts`), de `docs/comptes-externes.md` et de `docs/cles-comptes-externes.md` (qui disent où cliquer, compte par compte). Aucune valeur ici.

## Où déposer une valeur

- **Clés de production** : uniquement dans `/opt/neomoov/.env` sur le serveur (`nano /opt/neomoov/.env`, une ligne `NOM=valeur`), puis `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker` (`docs/runbooks/redemarrer-un-service.md`, section 7). Jamais dans le dépôt, un message ou un courriel. Copie des secrets irremplaçables dans Bitwarden.
- **Clés de test et de développement** : `C:\Users\PC\code\neomoov\.env` sur le poste ; bilan sans affichage par `pnpm env:check`.
- **Fichiers** (Apple `.p8`, JSON Google Play) : `C:\Users\PC\cles-neomoov\`.
- **Réglages non secrets** (numéros d'assistance, numéros de taxes) : My Hub, **Paramètres**.
- Chaque fournisseur réel s'active par `<SERVICE>_PROVIDER=real` sur le serveur : sans la clé correspondante, l'API refuse de démarrer.

État : « au 25 septembre » renvoie au bilan de `docs/cles-comptes-externes.md` ; tout est à revérifier au moment de la mise en ligne.

## 1. Serveur et domaine (LWS)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Accès SSH au VPS par clé (clé de Claude déposée) | Panel LWS, puis `/root/.ssh/authorized_keys` | Serveur | Tout déploiement | Clé déposée le 25 septembre ; exécution du déploiement par Claude refusée ce jour-là, commandes remises au fondateur |
| Enregistrements DNS `api`, `hub`, `reserver` vers l'IP du VPS | Panel LWS, `neomoov.net`, Zone DNS | Zone DNS | Certificats TLS, toute connexion aux applications et à My Hub | Posés le 25 septembre ; vérifier `nslookup api.neomoov.net` |
| Préparation du serveur (`infra/server-setup.sh`) et `.env` de production | Serveur | `/opt/neomoov/.env` (secrets internes générés par le script) | Démarrage de l'API | À confirmer |
| Adresses `assistance@neomoov.net`, `comptes@neomoov.net`, `beta@neomoov.net` (boîtes ou redirections) | Panel LWS, Emails | | Expéditeur des courriels, canal des retours de bêta, courriel affiché dans les applications | `assistance@` et `comptes@` à faire au 25 septembre ; `beta@` nouvelle |

## 2. Base de données et stockage (Supabase, Canada central)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Projet de **production** (plan Pro), région Canada (Central) | supabase.com, New project | `DATABASE_URL` (adresse « Session pooler ») | L'API ne démarre pas | À créer (seul `neomoov-dev` existe) |
| Projet de **staging** | Idem | `DATABASE_URL` du serveur de staging ; `TEST_DATABASE_URL` sur le poste si les tests doivent quitter la base de développement | Répétitions, tests de charge, restauration d'essai | À créer |
| Bucket privé `documents` dans le projet de production | Storage, New bucket (ou `pnpm --filter @neomoov/db db:storage`) | `S3_BUCKET` | Documents des chauffeurs, PDF, exports | Existe dans `neomoov-dev` seulement |
| Clés d'accès S3 du projet de production | Storage, Settings, S3 Access Keys | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `STORAGE_PROVIDER=real` | Voir l'alerte ci-dessous | À faire |
| Option de restauration à un instant donné (PITR, 7 jours) | Projet de production, Add-ons | | Objectif de 1 heure de perte au plus avant le lancement commercial (section 2.1) | Décision du fondateur (coût : `migration-canada.md`, section 7) |

**Alerte (manque dans le code)** : l'adaptateur réel du stockage n'est pas écrit ; `STORAGE_PROVIDER=real` refuse tout appel. Avec `mock`, les fichiers restent dans la mémoire de chaque processus : ils disparaissent au redémarrage et ne sont pas partagés entre les deux instances de l'API et le worker. Tant que l'adaptateur n'existe pas, documents des chauffeurs, PDF des factures et des relevés et exports Loi 25 ne fonctionnent pas de façon fiable en production. Les clés S3 seront nécessaires dès qu'il sera livré.

## 3. Secrets internes (générés, pas créés chez un fournisseur)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque |
|---|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | Générés par `infra/server-setup.sh` | `/opt/neomoov/.env` ; copie de `ENCRYPTION_KEY` dans Bitwarden | L'API refuse de démarrer en production |
| `BACKUP_PASSPHRASE` | `openssl rand -base64 30` sur le serveur | `/opt/neomoov/.env` et Bitwarden | Sauvegarde logique, donc purges de conservation (bloquées sans sauvegarde vérifiée) |
| `BACKUP_REMOTE` (facultatif) | `rclone config` vers un seau de stockage au Canada | `/opt/neomoov/.env` | Copie des sauvegardes hors du serveur |
| `BACKUP_KEEP_DAYS=35` | | `/opt/neomoov/.env` | Conservation de 35 jours du cahier des charges (défaut du script : 14) |
| `VAPI_WEBHOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN` | `openssl rand -hex 16`, puis saisis chez Vapi et Meta | `/opt/neomoov/.env` | Agent vocal, abonnement WhatsApp |
| Clé de service publique `NEOMOOV_PUBLIC_API_KEY` (portée `public:write`) | `POST /v1/admin/api-keys` après le premier déploiement | `/opt/neomoov/.env` (lue par le web) et réglage du site WordPress | Devis et adresses de la réservation web, préinscription des chauffeurs |

## 4. Textos et voix (Twilio, D50)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Compte mis à niveau (hors essai), numéro canadien SMS et voix | console.twilio.com | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_PROVIDER=real` | **Toute connexion** : clients et chauffeurs se connectent par code SMS ; en production, sans Twilio réel, aucun code n'est remis | À faire |
| Webhooks du numéro : statut des textos `https://api.neomoov.net/v1/webhooks/twilio/status` et textos entrants `https://api.neomoov.net/v1/webhooks/twilio/inbound` | Twilio, numéro, Messaging | | Suivi de livraison, relais des réponses des clients sans application | Après déploiement |
| Second numéro, réservé à WhatsApp | Idem | `C:\Users\PC\cles-neomoov\twilio.txt` | WhatsApp | À faire |

## 5. Courriels (Resend)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Domaine `neomoov.net` vérifié (enregistrements DNS chez LWS) et clé d'envoi | resend.com, Domains, API Keys | `RESEND_API_KEY`, `EMAIL_FROM` (défaut : `Neomoov <notifications@neomoov.net>`), `EMAIL_PROVIDER=real` | Reçus, factures, relevés, liens d'export Loi 25, rapports des agents | À faire |

## 6. Notifications push et builds (Expo)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Jeton de l'organisation `neomoov` | expo.dev, organisation, Access tokens | `EXPO_TOKEN` (poste) | Builds par Claude | Fait au 25 septembre |
| Projets EAS des deux applications (`eas init`) | Commande dans `apps/mobile-client` et `apps/mobile-driver` | `extra.eas.projectId` de chaque `app.json` (identifiant public, commité) | Builds, notifications push (sans projet, l'enregistrement du téléphone est ignoré) | À faire |
| Variables d'environnement du projet : clés Google Maps iOS et Android | expo.dev, projet, Environment variables | `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` (visibilité « secret ») | Carte Google dans les builds Android | À faire |
| `PUSH_PROVIDER=real` ; `EXPO_PUSH_ACCESS_TOKEN` seulement si la « sécurité renforcée » des push est activée | Serveur | `/opt/neomoov/.env` | Toutes les notifications push | À faire |

## 7. Magasins

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Compte Apple Developer (organisation) validé | developer.apple.com | | Tout build iOS, TestFlight | En validation au 25 septembre |
| Identifiants d'application `com.neomoov.client`, `com.neomoov.driver` (Push, Sign in with Apple, Maps, Background Modes pour le chauffeur) | Certificates, Identifiers & Profiles | | Builds iOS | Après validation |
| Fiches des deux applications dans App Store Connect | App Store Connect, Apps | `ascAppId` dans `submit.production.ios` de chaque `eas.json`, avec `appleTeamId` (identifiants publics) | Soumission automatique | Après validation |
| Clé d'API App Store Connect (rôle Admin) | App Store Connect, Intégrations | `.p8` et `apple.txt` dans `C:\Users\PC\cles-neomoov\` | Soumission par Claude | Après validation |
| Services ID `net.neomoov.web` et `APPLE_CLIENT_IDS` | Identifiers, Services IDs | `/opt/neomoov/.env` | Connexion Apple (aucun écran ne la propose encore) | Après validation |
| Compte Google Play Console (organisation) validé, deux applications créées | play.google.com/console | | Tout envoi Android au magasin | En validation au 25 septembre |
| Compte de service de publication | Play Console, Accès à l'API | `C:\Users\PC\cles-neomoov\google-play-service-account.json` (chemin attendu par `eas.json`) | Soumission automatique ; le premier `.aab` s'envoie en général à la main | Après validation |
| Clients OAuth Android (empreinte SHA-1 donnée après le premier build) | Google Cloud, Clients | Ajoutés à `GOOGLE_CLIENT_IDS` | Connexion Google sur Android (aucun écran ne la propose encore) | Après le premier build |
| Vidéo de démonstration de la localisation en arrière-plan | Téléphone, puis YouTube non répertorié | Lien dans la déclaration Google Play | Revue Google de l'application chauffeur | À produire (`docs/store/driver.md`) |
| Adresse d'assistance, politique de confidentialité et page de suppression de compte en ligne | neomoov.net | Fiches des magasins | Revue des deux magasins | À vérifier (`docs/store/verification-soumission.md`) |

## 8. Paiements (Stripe)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clés de test | dashboard.stripe.com, mode test | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `PAYMENT_PROVIDER=real` (staging) | Essais réels du paiement par carte | À faire au 25 septembre |
| Connect Express configuré | Stripe, Connect | `STRIPE_CONNECT_CLIENT_ID` (facultatif) | Versements aux chauffeurs | À faire |
| Point de réception des webhooks `https://api.neomoov.net/v1/webhooks/stripe` | Stripe, Webhooks (fait par Claude après déploiement) | `STRIPE_WEBHOOK_SECRET` | Confirmation des paiements, remboursements, litiges | Après déploiement |
| Activation du compte en mode réel (NEQ, compte bancaire, pièce d'identité) puis clés réelles | Stripe, Activer le compte | Serveur de production seulement | Encaissements et versements réels ; d'ici là, bêta en paiement au chauffeur | Avant le lancement commercial |
| Identifiant marchand Apple Pay et domaine vérifié | Stripe, moyens de paiement ; réglage `payments.apple_pay_merchant_id` | My Hub, Paramètres | Apple Pay | Avec la feuille de paiement (non branchée dans les applications) |

## 9. Cartes (Google Maps Platform)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clé serveur restreinte à l'IP du VPS (Routes, Places, Geocoding) | Google Cloud, Identifiants | `GOOGLE_MAPS_SERVER_KEY`, `MAPS_PROVIDER=real` | Adresses et devis réels (en simulé, les adresses sont fictives) | Clé créée ; restriction IP à poser |
| Budget et alertes | Google Cloud, Budgets | | Protection contre une facture imprévue | À faire |
| Fournisseur de tuiles pour les cartes de My Hub et du suivi partagé | Au choix (Google Maps, déjà payé, ou un fournisseur de tuiles OpenStreetMap) | À intégrer au code | Les tuiles publiques d'OpenStreetMap utilisées aujourd'hui ne conviennent pas à un usage commercial soutenu (décision du 26 septembre) | Décision du fondateur |

## 10. Anti-robots des formulaires publics (Cloudflare Turnstile)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Site Turnstile pour `hub.neomoov.net` et `reserver.neomoov.net` : clé de site et clé secrète | dash.cloudflare.com, Turnstile (gratuit ; compte Cloudflare absent des 14 comptes) | `TURNSTILE_SECRET_KEY` (API) et `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web) | En production, sans clé secrète, **tout jeton est refusé** : la préinscription des chauffeurs (`/chauffeurs`) échoue | À créer |

Manque dans le code : `NEXT_PUBLIC_TURNSTILE_SITE_KEY` doit être figée à la construction de l'image du web, mais ni `apps/web/Dockerfile` ni `infra/compose.prod.yml` ne la transmettent (seule `NEXT_PUBLIC_API_BASE_URL` l'est). Même avec la clé dans `.env`, le widget restera vide en production tant que ce n'est pas corrigé.

## 11. Agents IA, voix et WhatsApp

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clé Anthropic et limite de dépense mensuelle | console.anthropic.com | `ANTHROPIC_API_KEY`, `LLM_PROVIDER=real` | Agents relation client, recrutement, comptabilité, analyse (sinon escalade à l'équipe) | Clé présente sur le poste au 25 septembre |
| Vapi : clé privée, numéro Twilio importé, assistant configuré | dashboard.vapi.ai (`docs/voice-agent.md`) | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VOICE_PROVIDER=real` | Réservation par téléphone, appel du fondateur sur SOS | À faire |
| Réglages `voice.transfer_number`, `alerts.founder_phone`, `voice.sos_assistant_id` | My Hub, Paramètres | Base | Transfert vers un humain (valeur de départ fictive), appel sur SOS | À faire |
| WhatsApp : entreprise vérifiée, numéro, jeton permanent, secret de l'application, moyen de paiement | business.facebook.com, developers.facebook.com | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PROVIDER=real` | Réservation et assistance par WhatsApp | Vérification en cours au 25 septembre |

## 12. Surveillance

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Sentry (projets `api`, `web`, `mobile`) | sentry.io | `SENTRY_DSN` | Suivi des erreurs | À faire ; **le code ne lit pas encore cette variable** (Sentry non branché) |
| Better Stack : source de journaux et moniteurs de disponibilité de `api`, `hub`, `reserver` avec alerte par texto | betterstack.com | `BETTERSTACK_TOKEN` pour les journaux ; les moniteurs se règlent chez Better Stack | Alerte quand le site tombe (aucune aujourd'hui) | À faire ; **les journaux ne sont pas encore envoyés par le code** ; les moniteurs de disponibilité, eux, ne demandent aucun code |

## 13. Contenu et réglages de l'entreprise

| Élément | Où | Bloqué tant qu'il manque |
|---|---|---|
| Numéros de TPS et TVQ de Neomoov, dénomination et adresse | My Hub, Paramètres (`company.gst_number`, `company.qst_number`, `company.legal_name`, `company.address`) | Mentions obligatoires des factures de frais de service |
| Téléphone et courriel d'assistance | Réglages `support.phone` et `support.email` : à créer une première fois dans Supabase (`docs/beta/procedure.md`, section 1), ils n'existent pas dans les données de départ | Écran Assistance des applications (vide), exigence des magasins |
| Politique de confidentialité et conditions d'utilisation (versions publiées) | neomoov.net ; versions dans `legal.privacy_policy_version` et `legal.terms_version` | Création des comptes (acceptation obligatoire), fiches des magasins |
| Responsable de la protection des renseignements personnels désigné et publié | Site, politique de confidentialité | Loi 25 (`docs/privacy/efvp.md`) |
| Destinataires des rapports des agents | My Hub, Paramètres, `agents.report_recipients` | Rien (défaut : les administrateurs) |

## 14. Hors technique (suivis par le fondateur)

Autorisations de la CTQ, SAAQ, Aéroports de Montréal, assurances, Revenu Québec et choix du SEV certifié, avis de l'avocat sur la résidence des données et sur les courses rémunérées de la bêta : `docs/compliance/checklist.md` et `docs/beta/README.md`.

## Ordre conseillé pour la bêta

1. Serveur, DNS, projet Supabase de production (sections 1 et 2).
2. Twilio (sans lui, personne ne se connecte), Resend, Expo (projets et push), clé serveur Google Maps.
3. Adaptateur de stockage (code) et clés S3 ; ClamAV dans la composition (code).
4. Apple et Google Play dès leur validation ; compte de démonstration à code fixe (code).
5. Turnstile (clés et correction du build du web), Better Stack (moniteurs), Anthropic, Vapi, WhatsApp.
6. Stripe réel et PITR de Supabase avant le lancement commercial.
