# Publier une nouvelle version des applications mobiles

Étape 16 (prompt 16, tâches 4 et 6). Deux applications Expo : client (`apps/mobile-client`, `com.neomoov.client`) et chauffeur (`apps/mobile-driver`, `com.neomoov.driver`), compilées et soumises par EAS (compte Expo de l'organisation `neomoov`). Fiches des magasins : `docs/store/`. Aucun secret ici.

## 1. État de la configuration (26 septembre 2026)

| Élément | État | Conséquence |
|---|---|---|
| Profils `development`, `preview`, `production` (`eas.json` de chaque application) | Présents ; canaux `development`, `preview`, `production` | |
| Numéros de build | Gérés par EAS (`appVersionSource: remote`), incrémentés à chaque build `production` (`autoIncrement`) | Rien à changer à la main |
| Projet EAS lié (`extra.eas.projectId`) | Lu dans la variable `EAS_PROJECT_ID` par `app.config.ts` de chaque application (un projet par application, aucune valeur dans le dépôt) ; **projets à créer** | Sans elle : pas de projet lié, pas de notifications push, pas de mises à jour à la volée (section 4, « Lier le projet EAS ») |
| Mises à jour à la volée (EAS Update) | Branchées le 26 septembre 2026 : `expo-updates` 57.0.23 (version d'Expo SDK 57), adresse `https://u.expo.dev/<EAS_PROJECT_ID>`, vérification au lancement, application au lancement suivant ; désactivées tant que `EAS_PROJECT_ID` est vide. Depuis le 3 octobre 2026, `runtimeVersion` à la politique `fingerprint` (empreinte de la partie native, section 3) | Les builds faits avant le 3 octobre 2026 (version d'exécution `0.1.0`) ne reçoivent plus de mise à jour : les remplacer par un nouveau build |
| Liens universels (`https://neomoov.net/c/<code>` client, `/d/<code>` chauffeur) | Déclarés dans `app.config.ts` (domaine associé iOS, filtre d'intention Android vérifié) ; fichiers d'association prêts dans `infra/well-known/`, **non publiés** (section 9) | Tant qu'ils ne sont pas publiés sur neomoov.net, un lien `https` ouvre le site, pas l'application ; `neomoov://c/<code>` et `neomoov-driver://c/<code>` fonctionnent |
| Notifications Android (Firebase, FCM) | `android.googleServicesFile` renseigné seulement si `google-services.json` existe (copie locale ignorée par Git, ou variable EAS de type fichier `GOOGLE_SERVICES_JSON` copiée par le script `eas-build-pre-install`) ; **fichiers et clé FCM à déposer** (section 9) | Sans fichier : aucun jeton de notification Android, rien d'autre ne change |
| Modes d'arrière-plan iOS du chauffeur | `location` (position en ligne) et `audio` (sonnerie d'une offre, ajouté par `expo-audio`) ; `fetch` et `remote-notification` retirés (inutilisés, `fetch` était ajouté d'office par `expo-task-manager`, retiré par un mod de `app.config.ts`) | Vérifier après chaque ajout de greffon : `npx expo config --type introspect` (ligne `UIBackgroundModes`) |
| Soumission iOS (`submit.production.ios`) | `appleTeamId` et `ascAppId` vides | À remplir après la validation du compte Apple et la création des fiches dans App Store Connect |
| Soumission Android | Compte de service attendu dans `C:\Users\PC\cles-neomoov\google-play-service-account.json`, piste `internal` | Google Play exige en général un premier envoi manuel du fichier `.aab` dans la console avant d'accepter les envois automatiques (à vérifier au premier envoi) |
| Clés Google Maps des applications | Lues au build (`GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY`), à déclarer dans les variables d'environnement du projet Expo | Sans clé Android, la carte n'apparaît pas dans un build autonome |
| Suivi des plantages (Sentry) | `@sentry/react-native` lié dans les deux applications ; actif seulement avec `EXPO_PUBLIC_SENTRY_DSN` (variables des projets EAS, et terminal pour une mise à jour à la volée). Greffon `@sentry/react-native/expo` et `metro.config.js` (identifiant de débogage dans chaque paquet) depuis le 3 octobre 2026 ; cartes de source envoyées par le build si `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` et `SENTRY_PROJECT` sont dans les variables du projet EAS (`SENTRY_ALLOW_FAILURE` dans `eas.json` : sans eux, le build passe sans envoi) | Sans DSN : aucun envoi. Dès qu'il est posé, déclarer « Diagnostics » dans les étiquettes des magasins (`docs/store/`) |
| Microphone (application chauffeur) | Retiré le 26 septembre 2026 : `expo-audio` déclaré avec `microphonePermission: false` et `recordAudioAndroid: false`, `RECORD_AUDIO` dans `blockedPermissions`, `expo-image-picker` avec `microphonePermission: false` | Vérifier après chaque ajout de greffon : `npx expo config --type introspect` ne doit montrer ni `NSMicrophoneUsageDescription` ni `RECORD_AUDIO` |
| Build automatique sur étiquette | `release.yml` : étiquette `v*` poussée, builds EAS des deux applications si le secret GitHub `EXPO_TOKEN` existe, soumission si la variable `EAS_AUTO_SUBMIT` vaut `oui` | Secrets et variables à créer : `docs/operations/acces-a-fournir.md`, section 4 |

## 2. Quel type de publication

| Changement | Publication |
|---|---|
| Texte, écran, logique en JavaScript ou TypeScript, image livrée avec le code | Mise à jour à la volée (section 6), sur les builds qui ont `expo-updates` et la même version affichée ; sinon nouveau build |
| Nouveau module natif, montée de version d'Expo, permission, greffon ou réglage de `app.json` (icône, écran de démarrage, identifiant), clé Google Maps, son de notification | **Nouveau build** et nouvelle soumission aux magasins |
| Changement qui modifie la nature de l'application | Nouveau build et revue des magasins (les règles d'Apple et de Google interdisent de le faire par mise à jour à la volée) |

## 3. Numéros de version

- **Version affichée** (`expo.version` dans `app.json`, aujourd'hui `0.1.0`) : à changer à la main pour chaque version publiée dans les magasins. Proposition : `1.0.0` pour la première version publique, `1.0.1` pour une correction, `1.1.0` pour une fonction nouvelle. Les deux applications peuvent avoir des numéros différents.
- **Numéro de build** (iOS `buildNumber`, Android `versionCode`) : géré par EAS. Consulter : `npx eas-cli build:version:get`. Le fixer (rare, par exemple après une erreur) : `npx eas-cli build:version:set`.
- **Version d'exécution** (`runtimeVersion`) : empreinte de la partie native (politique `fingerprint`, depuis le 3 octobre 2026, revue du 2 octobre, constat mobile 5). Elle change d'elle-même à tout changement natif (module, greffon, permission, réglage natif de `app.json`, `eas.json`) : une mise à jour à la volée ne s'installe que sur les builds de même empreinte, sans règle à retenir sur la version affichée. Réglages communs dans `packages/mobile-core/expo/fingerprint.cjs` (lu par le `fingerprint.config.js` de chaque application) : retours chariot ignorés (même empreinte sur le poste Windows, GitHub Actions et les serveurs d'EAS) ; hors empreinte : versions, projet EAS et réglages des mises à jour, clés Google Maps, fichiers Firebase, scripts de `package.json`, `.gitignore`. Lire l'empreinte d'une application : `pnpm exec expo-updates runtimeversion:resolve --platform android` (ou `ios`) dans son dossier ; la comparer à celle d'un build sur expo.dev avant de publier.

## 4. Construire et soumettre (depuis le poste)

Connexion au compte Expo, une fois par poste (interactif, jamais de jeton collé dans une commande) :

```
npx eas-cli@latest login
npx eas-cli@latest whoami
```

### Lier le projet EAS (une fois par application)

Chaque application a son propre projet EAS (`neomoov-client`, `neomoov-driver`). Son identifiant (UUID) n'est pas un secret, mais il n'est pas écrit dans le dépôt : `app.config.ts` le lit dans `EAS_PROJECT_ID`.

1. Créer le projet : dans `apps\mobile-client`, `npx eas-cli@latest init`. La configuration étant dynamique, EAS ne peut pas écrire l'identifiant lui-même : il l'affiche (ou le lire sur expo.dev, projet, « Project ID »).
2. Le déclarer dans les variables d'environnement du projet EAS, pour les builds faits sur les serveurs d'Expo (visibilité texte brut, les trois environnements) : `npx eas-cli@latest env:create --name EAS_PROJECT_ID --value <identifiant> --visibility plaintext --environment development --environment preview --environment production` (même commande dans `apps\mobile-driver` avec l'identifiant du projet chauffeur).
3. Le poser dans le terminal avant toute commande `eas` de cette application (PowerShell : `$env:EAS_PROJECT_ID = "<identifiant>"`) : EAS lit la configuration sur le poste avant d'envoyer le build.
4. GitHub (workflow `release.yml`) : variables du dépôt `EAS_PROJECT_ID_CLIENT` et `EAS_PROJECT_ID_DRIVER` (Settings, Secrets and variables, Actions, onglet Variables).
5. Contrôle : `npx expo config --type public` montre `updates.url` en `https://u.expo.dev/<identifiant>` et `extra.eas.projectId`.

### Construire et soumettre

Pour chaque application (exemple client ; même chose dans `apps\mobile-driver`), `EAS_PROJECT_ID` posé comme ci-dessus :

```
cd C:\Users\PC\code\neomoov\apps\mobile-client
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios --latest
npx eas-cli@latest submit --profile production --platform android --latest
```

Durées indicatives : 15 à 40 minutes de build par plateforme (file d'attente du forfait gratuit), puis 10 à 30 minutes de traitement chez Apple avant l'apparition dans TestFlight.

Build d'essai installable par lien (Android, fichier APK, sans magasin) :

```
npx eas-cli@latest build --profile preview --platform android
```

Le profil `preview` pointe vers `https://api.neomoov.net` comme `production`. Sur iPhone, un build `preview` n'est installable que sur des appareils enregistrés (`npx eas-cli@latest device:create`) ; pour la bêta, préférer TestFlight.

## 5. Distribution

| Étape | iOS | Android |
|---|---|---|
| Équipe interne | TestFlight, testeurs internes (membres de l'équipe App Store Connect, 100 au plus), disponible dès le traitement | Test interne (liste d'adresses, 100 au plus), disponible en quelques minutes |
| Bêta fermée | TestFlight, testeurs externes (jusqu'à 10 000, par lien ou courriel) ; le premier build de chaque version passe une revue bêta d'Apple (souvent moins de 48 heures) | Test fermé (liste ou groupe Google), revue de Google |
| Production | Soumission à la revue avec les notes de `docs/store/` ; publication progressive sur 7 jours conseillée | Déploiement progressif (par exemple 10 %, 50 %, 100 %) |

Procédure de bêta complète : `docs/beta/procedure.md`. Liste de vérification avant soumission : `docs/store/verification-soumission.md`.

## 6. Mise à jour à la volée (JavaScript seulement)

Pour une correction de JavaScript, de texte ou d'image, sur les builds de même version affichée faits avec `expo-updates` (section 1). Les canaux sont ceux des profils de `eas.json` : `preview` (APK et builds d'essai), `production` (magasins).

```
cd C:\Users\PC\code\neomoov\apps\mobile-client
$env:EAS_PROJECT_ID = "<identifiant du projet client>"
$env:EXPO_PUBLIC_API_BASE_URL = "https://api.neomoov.net"
npx eas-cli@latest update --channel preview --environment preview --message "Correction du libellé de l'écran de paiement"
```

Cartes de source pour Sentry (si le projet Sentry existe, section 9) : juste après la publication, dans le même dossier, `npx sentry-expo-upload-sourcemaps dist` avec `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` et `SENTRY_PROJECT` posés dans le terminal (le jeton n'est jamais écrit dans un fichier du dépôt).

Puis, une fois vérifiée sur un téléphone du canal `preview` (fermer et rouvrir l'application deux fois : la mise à jour est téléchargée au premier lancement, appliquée au suivant), la même commande avec `--channel production`. Si la version d'`eas-cli` le demande, ajouter `--environment preview` ou `--environment production`.

Les variables `env` des profils de `eas.json` ne servent qu'aux builds : pour une mise à jour, `EXPO_PUBLIC_API_BASE_URL` (et `EXPO_PUBLIC_SENTRY_DSN` s'il est utilisé) doivent être posées dans le terminal, sinon le JavaScript publié vise `http://localhost:4000`. Revenir à une mise à jour précédente : `npx eas-cli@latest update:republish` avec l'identifiant du groupe précédent (liste : `npx eas-cli@latest update:list`) ; revenir au JavaScript embarqué dans le build : `npx eas-cli@latest update:roll-back-to-embedded`.

Interdit par mise à jour à la volée : tout changement natif (le build ne l'a pas ; avec la politique `fingerprint`, la mise à jour ne trouverait d'ailleurs aucun build de même empreinte), et tout changement qui modifie la nature de l'application (règles d'Apple et de Google) : ces cas passent par un nouveau build et la revue.

## 7. Retour arrière

Un build publié dans un magasin ne se retire pas : on publie un build correctif avec un numéro plus élevé. Pendant un déploiement progressif, suspendre la diffusion (App Store Connect : « Suspendre la publication progressive » ; Play Console : « Interrompre le déploiement »).

## 8. Liste de chaque version

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` passent ; l'API déployée accepte la nouvelle version (compatibilité des routes).
2. Version affichée changée dans `app.json` si la version part dans les magasins ; commit.
3. Notes de version FR et EN (quelques lignes, sans jargon).
4. Build `preview` installé et essayé sur un iPhone et un Android réels (parcours principaux de `docs/testing/README.md`).
5. Build `production`, soumission, testeurs internes, puis bêta ou production.
6. Surveiller 48 heures : plantages dans App Store Connect (TestFlight, Plantages) et Play Console (Android vitals), retours des testeurs, et Sentry (projet `mobile`) : branché dans les deux applications, inactif tant que `EXPO_PUBLIC_SENTRY_DSN` n'est pas posé dans les variables des projets EAS (`observabilite.md`, section 2).
7. Noter la version, la date et les numéros de build au registre d'exploitation.

## 9. Ce que le fondateur dépose (aucune commande lancée par les agents)

Aucune de ces commandes n'a été exécutée par les agents ; aucun fichier de clés ne doit être commité (`google-services.json`, `GoogleService-Info.plist` et comptes de service sont ignorés par Git).

**Firebase (notifications Android)**, dans chaque application (`apps\mobile-client`, puis `apps\mobile-driver` avec son propre fichier) :

1. Console Firebase, projet Neomoov, application Android `com.neomoov.client` (puis `com.neomoov.driver`) : télécharger `google-services.json`.
2. Le déposer dans EAS comme variable de type fichier : `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value .\google-services.json --visibility sensitive --environment production --environment preview --environment development`. Une copie dans le dossier de l'application (ignorée par Git) sert aux builds faits sur le poste.
3. Clé FCM V1 (compte de service Firebase autorisé à envoyer les messages) : `npx eas-cli@latest credentials -p android`, profil `production`, « Google Service Account », « Manage your Google Service Account Key for Push Notifications (FCM V1) », puis désigner le fichier JSON de la clé, gardé hors du dépôt (par exemple dans `C:\Users\PC\cles-neomoov\`).
4. Nouveau build Android des deux applications ; contrôle : un téléphone Android connecté apparaît dans la table `devices` avec un jeton.

**Sentry (cartes de source)** : créer le projet (ou un projet par application) dans l'organisation Sentry, puis dans chaque projet EAS : `SENTRY_ORG` et `SENTRY_PROJECT` (visibilité texte brut), `SENTRY_AUTH_TOKEN` (jeton d'organisation limité à l'envoi des cartes, visibilité secrète) et `EXPO_PUBLIC_SENTRY_DSN` (texte brut). Serveur Sentry hors de `sentry.io` (région européenne par exemple) : ajouter `SENTRY_URL`.

**Liens universels** : publier les deux fichiers de `infra/well-known/` sur le site WordPress de neomoov.net (LWS), dans le dossier `.well-known` de la racine du site :

- `https://neomoov.net/.well-known/apple-app-site-association` (sans extension) et `https://neomoov.net/.well-known/assetlinks.json`, servis en HTTPS sans redirection, type `application/json` (pour le premier, dans le `.htaccess` du dossier `.well-known` : `<Files "apple-app-site-association">`, `ForceType application/json`, `</Files>`) ;
- `apple-app-site-association` porte l'identifiant d'équipe Apple `DNB64CQYH6` repris de `eas.json` (`submit.production.ios.appleTeamId`) : le confirmer dans developer.apple.com (Membership) ;
- `assetlinks.json` : remplacer les valeurs `A_COMPLETER_…` par les empreintes SHA-256 des certificats de signature de chaque application : celle du certificat d'EAS (`npx eas-cli@latest credentials -p android`, profil `production`, ligne « SHA256 Fingerprint ») et celle de la clé de signature de Google Play (Play Console, application, « Intégrité de l'application », « Signature d'application ») ; retirer la seconde tant que l'application n'est pas sur Google Play ;
- faire suivre `https://neomoov.net/c/<code>` et `/d/<code>` vers la page `/c/<code>` de My Hub (`https://hub.neomoov.net`) pour qui n'a pas l'application ;
- nouveau build des deux applications (domaines associés et filtres d'intention). Contrôle Android : `adb shell pm get-app-links com.neomoov.client` (domaine `verified`) ; iOS : ouvrir le lien depuis Notes ou Messages.
